// The server side of /demo's two modes, in the test process. The real presenter
// dispatcher, the real target resolver and the real read proxy run over memory
// control stores and the fixture upstream, so a visitor, a presenter, a second
// presenter and a restart are all exercised for real; only the database, the
// API behind it and the runner worker are stand-ins. The runner is driven by
// the test (claim, start, finish, fail), so a run's progress is deterministic.
import { expect, type BrowserContext, type Page } from "@playwright/test"
import { chapterIndex } from "../app/demo/chapters"
import { handleDemoRead } from "../lib/demo-data/proxy.js"
import type { PresenterConfig } from "../lib/demo-presenter/config.js"
import type { LeaseDoc } from "../lib/demo-presenter/lease.js"
import type { PinDoc } from "../lib/demo-presenter/pin.js"
import { handlePresenterRequest } from "../lib/demo-presenter/presenter-api.js"
import type { ProposalsClient } from "../lib/demo-presenter/proposals.js"
import type { RunRequestDoc } from "../lib/demo-presenter/run-requests.js"
import {
	type ControlStores,
	createPresenterRuntime,
} from "../lib/demo-presenter/runtime.js"
import type { SessionDoc } from "../lib/demo-presenter/session.js"
import { MemoryCollection } from "../lib/demo-presenter/testing/memory-collection.js"
import { createRunFixture, FIXTURE_RUN, PENDING_PROPOSAL } from "./demo-run.js"
import { chapterTitle } from "./demo-helpers"
import { createDemoUpstream, FIXTURE_ENV } from "./demo-upstream.js"

const approvedClaims = [1, 2].map((n) => ({
	id: `approved-${n}`,
	text: `Silent ETA drift, finding ${n}`,
	status: "active",
	confidence: 0.8,
	marker: `[[wiki:${PENDING_PROPOSAL.slug}#approved-${n}@r1]]`,
	evidence: [],
}))

/** Once a reviewer approves, the proposed page is a stored page like the
 * others: the page list holds it and the change feed's last page records its
 * first revision, after the agents had ended. */
export function withApprovedPage(url: URL, body: unknown): unknown {
	const approvedAt = "2026-10-20T09:50:00.000Z"
	const record = body as Record<string, unknown>
	if (url.pathname === "/api/demo/v1/wiki" && Array.isArray(record.pages)) {
		const [template] = record.pages as Array<Record<string, unknown>>
		const skip = Number(url.searchParams.get("skip") ?? 0)
		const lastPage = skip + record.pages.length >= Number(record.total)
		return {
			...record,
			total: Number(record.total) + 1,
			pages: [
				...record.pages,
				...(lastPage
					? [
							{
								...template,
								_id: "page-approved",
								slug: PENDING_PROPOSAL.slug,
								title: PENDING_PROPOSAL.title,
								revision: 1,
								claims: approvedClaims,
								relationships: [],
								createdAt: approvedAt,
								updatedAt: approvedAt,
							},
						]
					: []),
			],
		}
	}
	if (
		url.pathname === "/api/demo/v1/wiki/changes" &&
		Array.isArray(record.changes) &&
		record.hasMore === false
	) {
		const [template] = record.changes as Array<Record<string, unknown>>
		return {
			...record,
			changes: [
				...record.changes,
				{
					...template,
					pageSlug: PENDING_PROPOSAL.slug,
					title: PENDING_PROPOSAL.title,
					revision: 1,
					editKind: "create",
					createdAt: approvedAt,
					baseline: "none",
					baselineRevision: null,
					claims: {
						added: approvedClaims,
						changed: [],
						removed: [],
						counts: { added: approvedClaims.length, changed: 0, removed: 0 },
						truncated: false,
					},
				},
			],
		}
	}
	return body
}

export const PRESENTER_TOKEN = "e2e-presenter-token-0123456789"
export const RUN_DEADLINE_MS = 335_000
const SLOT_COUNT = 15

type Manifest = Record<string, unknown> & { _id: string }
type ProposalState = "none" | "pending" | "promoted" | "rejected"

export type WorldOptions = {
	/** Fully seeded slots, in slot order. */
	seeded?: number[]
	/** Slots that read "ready" but are only part way seeded. */
	partial?: number[]
}

export function createWorld(options: WorldOptions = {}) {
	const generated = createDemoUpstream()
	const finished = createRunFixture(generated.data, { variant: "steps" })
	const seededBase = createRunFixture(generated.data, { variant: "none" })
	const upstream = finished.withStepEvents(generated.fetch)

	let offsetMs = 0
	const now = () => new Date(Date.now() + offsetMs)

	const manifests = new MemoryCollection<Manifest>()
	const stores = {
		manifests,
		leases: new MemoryCollection<LeaseDoc>(["presenterId"]),
		sessions: new MemoryCollection<SessionDoc>(),
		runRequests: new MemoryCollection<RunRequestDoc>(),
		publicRun: new MemoryCollection<PinDoc>(),
	} satisfies ControlStores
	const runIdOf = (slot: number) => `e2e-slot-${slot}`
	const slotDoc = (slot: number, full: boolean): Manifest => {
		const base = seededBase.manifest
		const written = full ? base.eventsWritten : base.eventsWritten.slice(0, 5)
		return {
			...base,
			_id: runIdOf(slot),
			runId: runIdOf(slot),
			slotIndex: slot,
			state: "ready",
			corpus: {
				...base.corpus,
				eventsPlanned: base.eventsWritten.length,
				pagesPlanned: base.pagesWritten.length,
			},
			eventsWritten: written,
		}
	}
	for (const slot of options.seeded ?? [13, 14, 15]) {
		manifests.docs.set(runIdOf(slot), slotDoc(slot, true))
	}
	for (const slot of options.partial ?? [5]) {
		manifests.docs.set(runIdOf(slot), slotDoc(slot, false))
	}

	const config: PresenterConfig = {
		controlUri: "mongodb://control.fixture.test/",
		apiBaseUrl: FIXTURE_ENV.apiBaseUrl,
		token: PRESENTER_TOKEN,
		adminKey: "e2e-admin-key",
		readKeys: Array.from({ length: SLOT_COUNT }, () => FIXTURE_ENV.readKey),
		runDeadlineMs: RUN_DEADLINE_MS,
	}

	const decisions: Array<{ operationId: string; decision: string }> = []
	const world = {
		proposal: "none" as ProposalState,
		decisions,
		/** Every read the proxy answered, parsed, for checks against the API. */
		responses: [] as Array<{ url: URL; status: number; body: unknown }>,
		/** Rewrites a served body, to model a feed the playback cannot trust. */
		tamper: undefined as ((url: URL, body: unknown) => unknown) | undefined,
		/** Every read target the resolver chose, for what the browser asked. */
		resolutions: [] as Array<{
			mode: string
			runId: string | undefined
			cookie: boolean
		}>,
		stores,
		now,
		/** Moves the server's clock; the browser's own clock is not moved. */
		skip(ms: number) {
			offsetMs += ms
		},
		runIdOf,
		upstream,
		runtime: undefined as unknown as ReturnType<typeof createPresenterRuntime>,
		/** A web server restart: the services are rebuilt, the stores stay. */
		restart() {
			world.runtime = build()
		},
		runner: {
			async claim(runId: string): Promise<void> {
				await stores.runRequests.findOneAndUpdate(
					{ _id: runId, state: "queued" },
					{
						$set: {
							state: "claimed",
							claimedAt: now().toISOString(),
							workerId: "e2e-runner",
						},
					},
				)
			},
			async start(runId: string): Promise<void> {
				await setAgentRun(runId, {
					state: "running",
					startedAt: now().toISOString(),
				})
			},
			async finish(runId: string): Promise<void> {
				const done = finished.manifest.agentRun
				await setAgentRun(runId, done, { usedAt: done?.endedAt })
				world.proposal = "pending"
				await stores.runRequests.findOneAndUpdate(
					{ _id: runId },
					{ $set: { state: "done", finishedAt: now().toISOString() } },
				)
			},
			async fail(runId: string): Promise<void> {
				await setAgentRun(runId, {
					state: "incomplete",
					startedAt: now().toISOString(),
					endedAt: now().toISOString(),
					failureReason:
						"task deadline at mongodb+srv://secret@cluster.invalid",
				})
				await stores.runRequests.findOneAndUpdate(
					{ _id: runId },
					{
						$set: {
							state: "failed",
							failureReason: "mongodb+srv://secret@cluster.invalid",
						},
					},
				)
			},
			/** What the worker does with a request nobody picked up in time. */
			async expire(runId: string): Promise<void> {
				await stores.runRequests.findOneAndUpdate(
					{ _id: runId, state: "queued" },
					{
						$set: {
							state: "failed",
							failureReason: "no runner picked the request up in time",
						},
					},
				)
			},
		},
	}

	async function setAgentRun(
		runId: string,
		agentRun: unknown,
		extra: Record<string, unknown> = {},
	): Promise<void> {
		await stores.manifests.findOneAndUpdate(
			{ _id: runId },
			{
				$set: {
					agentRun,
					...(extra.usedAt ? { state: "used", usedAt: extra.usedAt } : {}),
				},
			},
		)
	}

	const proposals: ProposalsClient = {
		listProposals: async (input: { scopeRef?: string }) => ({
			proposals:
				world.proposal === "pending"
					? [
							{
								operationId: "e2e-op-1",
								state: "pending",
								proposer: {
									subjectId: "demo-proposer",
									displayName: "Demo proposer",
									agentId: FIXTURE_ENV.agentId,
								},
								scope: "workspace",
								scopeRef: input.scopeRef ?? FIXTURE_ENV.scopeRef,
								proposedAt: "2026-10-20T09:38:00.000Z",
								page: {
									slug: PENDING_PROPOSAL.slug,
									title: PENDING_PROPOSAL.title,
									kind: "synthesis",
									summary: "ETAs slip with no notice",
									body: "body",
									claims: [{ id: "c1", text: "one" }],
								},
							},
						]
					: [],
		}),
		approveProposal: async ({ operationId }: { operationId: string }) => {
			decisions.push({ operationId, decision: "approve" })
			world.proposal = "promoted"
			return {
				ok: true,
				operationId,
				state: "promoted",
				pageSlug: PENDING_PROPOSAL.slug,
			}
		},
		rejectProposal: async ({ operationId }: { operationId: string }) => {
			decisions.push({ operationId, decision: "reject" })
			world.proposal = "rejected"
			return { ok: true, operationId, state: "rejected" }
		},
	} as unknown as ProposalsClient

	function build() {
		return createPresenterRuntime({
			config,
			baselineEnv: FIXTURE_ENV,
			baselineRun: FIXTURE_RUN,
			stores,
			proposalsClient: proposals,
			now,
		})
	}
	world.runtime = build()

	/** The stored manifest of a run: a slot's, else the baseline's. */
	const manifestOf = async (runId: string): Promise<unknown | null> =>
		(await stores.manifests.findOne({ _id: runId })) ??
		(runId === FIXTURE_RUN.runId ? finished.manifest : null)

	return Object.assign(world, { manifestOf })
}

export type World = ReturnType<typeof createWorld>

/** Serves /api/demo/presenter/** and /api/demo/v1/** for every page in the
 * context from the world, the way the two Route Handlers would. */
export async function installWorld(
	context: BrowserContext,
	world: World,
): Promise<void> {
	await context.route("**/api/demo/presenter/**", async (route) => {
		const request = route.request()
		const url = new URL(request.url())
		const path = url.pathname
			.replace(/^\/api\/demo\/presenter\//, "")
			.split("/")
			.filter(Boolean)
		const method = request.method()
		const body = request.postData()
		const response = await handlePresenterRequest(
			new Request(request.url(), {
				method,
				headers: await request.allHeaders(),
				...(method !== "GET" && body !== null ? { body } : {}),
			}),
			path,
			world.runtime.services,
		)
		await route.fulfill({
			status: response.status,
			headers: Object.fromEntries(response.headers),
			body: await response.text(),
		})
	})

	await context.route("**/api/demo/v1/**", async (route) => {
		const request = route.request()
		const headers = await request.allHeaders()
		const web = new Request(request.url(), {
			method: request.method(),
			headers,
		})
		const resolved = await world.runtime.resolver.resolve(web)
		if (!resolved.ok) {
			await route.fulfill({
				status: resolved.status,
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					error: { code: resolved.code, message: resolved.message },
				}),
			})
			return
		}
		const { env, run, mode } = resolved.target
		world.resolutions.push({
			mode,
			runId: run?.runId,
			cookie: Boolean(headers.cookie),
		})
		const served = await handleDemoRead(web, env, world.upstream, {
			run,
			manifest: world.manifestOf,
			deadline: { now: world.now, ms: RUN_DEADLINE_MS },
		})
		const text = await served.text()
		let body: unknown = null
		try {
			body = JSON.parse(text)
		} catch {
			body = null
		}
		const approved =
			world.proposal === "promoted" && served.ok
				? withApprovedPage(new URL(request.url()), body)
				: body
		const tampered =
			world.tamper && served.ok
				? world.tamper(new URL(request.url()), approved)
				: approved
		world.responses.push({
			url: new URL(request.url()),
			status: served.status,
			body: tampered,
		})
		await route.fulfill({
			status: served.status,
			headers: { "content-type": "application/json" },
			body: tampered === body ? text : JSON.stringify(tampered),
		})
	})
}

/** Opens a chapter: by address on the first visit, then from the rail, because
 * a changed hash alone does not reload the page. */
export async function openChapter(page: Page, id: string): Promise<void> {
	if (page.url().includes("/demo")) {
		await page
			.getByRole("button", {
				name: chapterTitle(chapterIndex(id)),
				exact: true,
			})
			.click()
	} else {
		await page.goto(`/demo#${id}`)
	}
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		chapterTitle(chapterIndex(id)),
	)
}
