import type { MdbrainWikiPageView } from "@mdbrain/client"
import type { RunManifestDoc } from "./manifest.js"
import { withRetries, type RetryOptions } from "./retries.js"

/** Reader port: wikiGet as the real client implements it. */
export type EqualityReader = {
	wikiGet(
		input: { slug: string; scope: string; scopeRef: string; format?: "json" },
		requestOptions?: { timeoutMs?: number },
	): Promise<MdbrainWikiPageView>
}

export type RunSlotRef = { scopeRef: string; manifest: RunManifestDoc }

export type EqualityDifference = {
	path: string
	slotA: unknown
	slotB: unknown
}

export type RunEqualityReport = {
	equal: boolean
	pagesCompared: number
	differences: EqualityDifference[]
}

/** Fields the server stamps per-slot (302 §0.4/§6): ids, wall-clock
 * timestamps. Everything else must match byte-for-byte after the evidence
 * event ids are mapped back to logical corpus source ids. */
const UNSTABLE_PAGE_KEYS = [
	"_id",
	"createdAt",
	"updatedAt",
	"validFrom",
	"validTo",
	"lastMaintainedAt",
] as const

const ABSENT = "<absent>"

/** Compares two run slots end-to-end: manifest boundaries and write
 * sequences first, then every common page read back through the API and
 * deep-compared after normalization. Any difference is reported with its
 * path; the caller decides whether to fail closed. */
export async function compareRunSlots(options: {
	reader: EqualityReader
	slots: [RunSlotRef, RunSlotRef]
	retry?: RetryOptions
	requestTimeoutMs?: number
}): Promise<RunEqualityReport> {
	const [slotA, slotB] = options.slots
	const differences: EqualityDifference[] = []
	collectManifestDifferences(slotA.manifest, slotB.manifest, differences)

	const request = options.requestTimeoutMs
		? { timeoutMs: options.requestTimeoutMs }
		: undefined
	const mapA = eventIdIndex(slotA.manifest)
	const mapB = eventIdIndex(slotB.manifest)
	const slugsB = new Set(slotB.manifest.pagesWritten)
	let pagesCompared = 0
	for (const slug of slotA.manifest.pagesWritten) {
		if (!slugsB.has(slug)) continue
		// A failed read is a reportable difference, not a crash: the live
		// check must always produce a full report.
		const readA = await readSlotPage(options, slotA, slug, request)
		const readB = await readSlotPage(options, slotB, slug, request)
		if (!readA.ok || !readB.ok) {
			differences.push({
				path: `${slug}.read`,
				slotA: readA.ok ? "read ok" : String(readA.error),
				slotB: readB.ok ? "read ok" : String(readB.error),
			})
			continue
		}
		collectDifferences(
			normalizePage(readA.view, mapA),
			normalizePage(readB.view, mapB),
			slug,
			differences,
		)
		pagesCompared++
	}
	return { equal: differences.length === 0, pagesCompared, differences }
}

async function readSlotPage(
	options: { reader: EqualityReader; retry?: RetryOptions },
	slot: RunSlotRef,
	slug: string,
	request: { timeoutMs?: number } | undefined,
): Promise<
	{ ok: true; view: MdbrainWikiPageView } | { ok: false; error: unknown }
> {
	try {
		const view = await withRetries(
			() =>
				options.reader.wikiGet(
					{ slug, scope: "workspace", scopeRef: slot.scopeRef, format: "json" },
					request,
				),
			options.retry,
		)
		return { ok: true, view }
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : error }
	}
}
/** Event id -> logical corpus source id, from the run manifest. */
function eventIdIndex(manifest: RunManifestDoc): Map<string, string> {
	return new Map(
		manifest.eventsWritten.map((ref) => [ref.eventId, ref.sourceId]),
	)
}

/** Drops the unstable server-stamped fields, drops the evidence `marker`
 * (it embeds the unstable event id), and maps evidence source ids back to
 * corpus source ids. An unmapped id normalizes to a sentinel so it
 * surfaces as a difference instead of passing silently. */
function normalizePage(
	view: MdbrainWikiPageView,
	eventIdToSourceId: Map<string, string>,
): Record<string, unknown> {
	const unstable = new Set<string>(UNSTABLE_PAGE_KEYS)
	const stable: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(view)) {
		if (!unstable.has(key)) stable[key] = value
	}
	stable.claims = view.claims.map((claim) => ({
		...claim,
		evidence: claim.evidence.map((ev) => {
			const { marker, sourceId, ...rest } = ev
			return {
				...rest,
				sourceId: eventIdToSourceId.get(sourceId) ?? `<unmapped:${sourceId}>`,
			}
		}),
	}))
	return stable
}

function collectManifestDifferences(
	a: RunManifestDoc,
	b: RunManifestDoc,
	out: EqualityDifference[],
): void {
	const push = (path: string, slotA: unknown, slotB: unknown) =>
		out.push({ path: `manifest.${path}`, slotA, slotB })
	if (a.state !== b.state) push("state", a.state, b.state)
	if (a.corpus.sha256 !== b.corpus.sha256)
		push("corpus.sha256", a.corpus.sha256, b.corpus.sha256)
	if (a.corpus.records !== b.corpus.records)
		push("corpus.records", a.corpus.records, b.corpus.records)
	if (a.corpus.eventsPlanned !== b.corpus.eventsPlanned)
		push("corpus.eventsPlanned", a.corpus.eventsPlanned, b.corpus.eventsPlanned)
	if (a.corpus.pagesPlanned !== b.corpus.pagesPlanned)
		push("corpus.pagesPlanned", a.corpus.pagesPlanned, b.corpus.pagesPlanned)
	if (a.limitSources !== b.limitSources)
		push("limitSources", a.limitSources, b.limitSources)
	const replayA = a.corpus.replaySourceIds
	const replayB = b.corpus.replaySourceIds
	if (replayA.join("|") !== replayB.join("|")) {
		push("corpus.replaySourceIds", replayA, replayB)
	}
	const sourcesA = a.eventsWritten.map((ref) => ref.sourceId).join("|")
	const sourcesB = b.eventsWritten.map((ref) => ref.sourceId).join("|")
	if (sourcesA !== sourcesB) {
		push(
			"eventsWritten",
			a.eventsWritten.map((r) => r.sourceId),
			b.eventsWritten.map((r) => r.sourceId),
		)
	}
	if (a.pagesWritten.join("|") !== b.pagesWritten.join("|")) {
		push("pagesWritten", a.pagesWritten, b.pagesWritten)
	}
}

function collectDifferences(
	a: unknown,
	b: unknown,
	path: string,
	out: EqualityDifference[],
): void {
	if (a === b) return
	if (isPlainObject(a) && isPlainObject(b)) {
		const keys = new Set([...Object.keys(a), ...Object.keys(b)])
		for (const key of keys) {
			const childPath = `${path}.${key}`
			if (!(key in a) || !(key in b)) {
				out.push({
					path: childPath,
					slotA: key in a ? a[key] : ABSENT,
					slotB: key in b ? b[key] : ABSENT,
				})
				continue
			}
			collectDifferences(a[key], b[key], childPath, out)
		}
		return
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) {
			out.push({ path, slotA: a.length, slotB: b.length })
			return
		}
		for (let i = 0; i < a.length; i++) {
			collectDifferences(a[i], b[i], `${path}[${i}]`, out)
		}
		return
	}
	if (a !== b) out.push({ path, slotA: a, slotB: b })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}
