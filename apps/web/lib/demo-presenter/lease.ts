// The presenter's lease on one run slot (ticket 14). A lease is one document
// per slot, `_id` = `slot:<i>`, kept in the demo control database so a
// restart or a second web instance sees it. The database decides who wins:
// `insertOne` fails on a taken `_id`, and an expired lease is replaced by a
// guarded `findOneAndUpdate` that matches only while it is still expired, so
// two presenters can never both hold a slot. A presenter holds at most one
// lease (a unique `presenterId`).
//
// Only a fully seeded slot is leasable: its run is `ready`, every planned
// event and page is written, and no agent run has started. The early partial
// seeds read `ready` too, so the counts are the test, not the state.

import { DuplicateKeyError, type ControlCollection } from "./collections.js"

export type LeaseDoc = {
	_id: string
	slotIndex: number
	runId: string
	presenterId: string
	name: string
	acquiredAt: Date
	expiresAt: Date
}

/** What the lease needs to know about a stored run manifest. */
export type LeaseManifest = {
	runId: string
	slotIndex: number
	scopeRef: string
	agentId: string
	state: string
	eventsPlanned: number
	pagesPlanned: number
	eventsWritten: number
	pagesWritten: number
	hasAgentRun: boolean
	/** "" until an agent run starts, then running, complete or incomplete. */
	agentRunState?: string
}

export type LeaseErrorCode =
	| "NO_SLOT_AVAILABLE"
	| "SLOT_NOT_LEASABLE"
	| "INVALID_NAME"

export class LeaseError extends Error {
	name = "LeaseError"
	constructor(
		readonly code: LeaseErrorCode,
		message: string,
	) {
		super(message)
	}
}

export const SLOT_NAME_MAX = 40
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/** Ready, every planned event and page written, and no agent run yet. */
export function isFullySeeded(manifest: LeaseManifest): boolean {
	return (
		manifest.state === "ready" &&
		!manifest.hasAgentRun &&
		manifest.eventsPlanned > 0 &&
		manifest.pagesPlanned > 0 &&
		manifest.eventsWritten === manifest.eventsPlanned &&
		manifest.pagesWritten === manifest.pagesPlanned
	)
}

type Doc = Record<string, unknown>
const isDoc = (value: unknown): value is Doc =>
	typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): string | undefined =>
	typeof value === "string" && value !== "" ? value : undefined
const count = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isInteger(value) && value >= 0
		? value
		: undefined

/** Reads a stored manifest into the lease view, or null when it is malformed
 * (such a run is never leasable). */
export function leaseManifestOf(doc: unknown): LeaseManifest | null {
	if (!isDoc(doc)) return null
	const corpus = isDoc(doc.corpus) ? doc.corpus : undefined
	const runId = text(doc.runId) ?? text(doc._id)
	const scopeRef = text(doc.scopeRef)
	const agentId = text(doc.agentId)
	const state = text(doc.state)
	const slotIndex = count(doc.slotIndex)
	const eventsPlanned = count(corpus?.eventsPlanned)
	const pagesPlanned = count(corpus?.pagesPlanned)
	if (
		!runId ||
		!scopeRef ||
		!agentId ||
		!state ||
		slotIndex === undefined ||
		eventsPlanned === undefined ||
		pagesPlanned === undefined ||
		!Array.isArray(doc.eventsWritten) ||
		!Array.isArray(doc.pagesWritten)
	) {
		return null
	}
	return {
		runId,
		slotIndex,
		scopeRef,
		agentId,
		state,
		eventsPlanned,
		pagesPlanned,
		eventsWritten: doc.eventsWritten.length,
		pagesWritten: doc.pagesWritten.length,
		hasAgentRun: isDoc(doc.agentRun) || text(doc.agentRunState) !== undefined,
		agentRunState:
			(isDoc(doc.agentRun) ? text(doc.agentRun.state) : undefined) ??
			text(doc.agentRunState) ??
			"",
	}
}

export interface ReadyManifestSource {
	listReady(): Promise<LeaseManifest[]>
}

export interface ManifestReader {
	get(runId: string): Promise<LeaseManifest | null>
}

export function manifestReader(
	manifests: ControlCollection<{ _id: string }>,
): ManifestReader {
	return {
		get: async (runId) =>
			leaseManifestOf(await manifests.findOne({ _id: runId })),
	}
}

export function readyManifestSource(
	manifests: ControlCollection<{ _id: string }>,
): ReadyManifestSource {
	return {
		listReady: async () =>
			(await manifests.find({ state: "ready" }))
				.map(leaseManifestOf)
				.filter((manifest): manifest is LeaseManifest => manifest !== null),
	}
}

export function normalizeSlotName(raw: string): string {
	const name = raw.trim()
	if (
		name.length === 0 ||
		name.length > SLOT_NAME_MAX ||
		CONTROL_CHARACTERS.test(name)
	) {
		throw new LeaseError(
			"INVALID_NAME",
			`a slot name is 1 to ${SLOT_NAME_MAX} characters with no control characters`,
		)
	}
	return name
}

export const DEFAULT_LEASE_TTL_MS = 30 * 60_000

export type LeaseDeps = {
	leases: ControlCollection<LeaseDoc>
	manifests: ReadyManifestSource
	/** The run pinned for public mode, which is never leased. */
	pinnedRunId: () => Promise<string | undefined>
	now: () => Date
	ttlMs?: number
}

export function createLeaseService(deps: LeaseDeps) {
	const ttlMs = deps.ttlMs ?? DEFAULT_LEASE_TTL_MS
	const expiry = (from: Date) => new Date(from.getTime() + ttlMs)

	async function held(
		presenterId: string,
		now: Date,
	): Promise<LeaseDoc | null> {
		return deps.leases.findOne({ presenterId, expiresAt: { $gt: now } })
	}

	async function take(
		manifest: LeaseManifest,
		presenterId: string,
		name: string | undefined,
		now: Date,
	): Promise<LeaseDoc | null> {
		const fields = {
			slotIndex: manifest.slotIndex,
			runId: manifest.runId,
			presenterId,
			name: name ?? `Slot ${manifest.slotIndex}`,
			acquiredAt: now,
			expiresAt: expiry(now),
		}
		const id = `slot:${manifest.slotIndex}`
		try {
			await deps.leases.insertOne({ _id: id, ...fields })
			return { _id: id, ...fields }
		} catch (error) {
			if (!(error instanceof DuplicateKeyError)) throw error
		}
		try {
			// A lease that is still live stays with its holder: the filter matches
			// only an expired one.
			return await deps.leases.findOneAndUpdate(
				{ _id: id, expiresAt: { $lte: now } },
				{ $set: fields },
				{ returnDocument: "after" },
			)
		} catch (error) {
			if (!(error instanceof DuplicateKeyError)) throw error
			return held(presenterId, now)
		}
	}

	async function acquire(input: {
		presenterId: string
		slotIndex?: number
		name?: string
	}): Promise<LeaseDoc> {
		const name =
			input.name === undefined ? undefined : normalizeSlotName(input.name)
		const now = deps.now()
		await deps.leases.deleteMany({
			presenterId: input.presenterId,
			expiresAt: { $lte: now },
		})
		const already = await held(input.presenterId, now)
		if (already) {
			if (
				input.slotIndex !== undefined &&
				input.slotIndex !== already.slotIndex
			) {
				throw new LeaseError(
					"SLOT_NOT_LEASABLE",
					"release the current lease before taking another slot",
				)
			}
			return already
		}
		const pinned = await deps.pinnedRunId()
		const candidates = (await deps.manifests.listReady())
			.filter(isFullySeeded)
			.filter((manifest) => manifest.runId !== pinned)
			.filter(
				(manifest) =>
					input.slotIndex === undefined ||
					manifest.slotIndex === input.slotIndex,
			)
			.sort((a, b) => a.slotIndex - b.slotIndex)
		if (input.slotIndex !== undefined && candidates.length === 0) {
			throw new LeaseError(
				"SLOT_NOT_LEASABLE",
				`slot ${input.slotIndex} is not a fully seeded free slot`,
			)
		}
		for (const manifest of candidates) {
			const lease = await take(manifest, input.presenterId, name, now)
			if (lease) return lease
		}
		if (input.slotIndex !== undefined) {
			throw new LeaseError(
				"SLOT_NOT_LEASABLE",
				`slot ${input.slotIndex} is held by another presenter`,
			)
		}
		throw new LeaseError(
			"NO_SLOT_AVAILABLE",
			"no fully seeded slot is free; the operator has to prepare one",
		)
	}

	return {
		acquire,
		current: (presenterId: string) => held(presenterId, deps.now()),
		renew: async (presenterId: string) => {
			const now = deps.now()
			return deps.leases.findOneAndUpdate(
				{ presenterId, expiresAt: { $gt: now } },
				{ $set: { expiresAt: expiry(now) } },
				{ returnDocument: "after" },
			)
		},
		release: async (presenterId: string) =>
			(await deps.leases.deleteOne({ presenterId })) > 0,
		rename: async (presenterId: string, raw: string) => {
			const name = normalizeSlotName(raw)
			return deps.leases.findOneAndUpdate(
				{ presenterId, expiresAt: { $gt: deps.now() } },
				{ $set: { name } },
				{ returnDocument: "after" },
			)
		},
	}
}

export type LeaseService = ReturnType<typeof createLeaseService>
