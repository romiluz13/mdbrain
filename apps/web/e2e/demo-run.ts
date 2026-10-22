// The run the fixture serves: a stored manifest, in the shape the demo control
// database holds it, and the events its agent steps wrote, which the fixture
// API cites by id. The /demo e2e reads it through the real proxy handler, so
// the projection and the pinned-scope refusal run for real; only the database
// and the API behind them are stand-ins.
import { parseCitationMarker } from "@mdbrain/client"
import { AGENT_ROLE_LABELS } from "../lib/demo-data/run-record.js"
import type {
	DemoRunEnv,
	RunManifestSource,
	RunReadDeps,
} from "../lib/demo-data/proxy-run.js"
import {
	type createDemoUpstream,
	eventIdOf,
	FIXTURE_ENV,
} from "./demo-upstream.js"

/** Which part of a run's life the fixture is in.
 *  - "steps": finished, with its steps indexed (what the first slot with steps shows)
 *  - "no-steps": finished before steps were indexed (slot 9)
 *  - "none": seeded, its agents not started
 *  - "running" / "incomplete": the agents are at work / stopped early
 *  - "unconfigured": the server has no run env */
export type RunVariant =
	| "steps"
	| "no-steps"
	| "none"
	| "running"
	| "incomplete"
	| "unconfigured"

export type RunFixtureOptions = {
	variant?: RunVariant
	/** Step numbers whose event the API cannot resolve by id. */
	missedSteps?: number[]
	/** How many source files the run's record lists. */
	arrivals?: number
}

type Data = ReturnType<typeof createDemoUpstream>["data"]

// A run is named by the seeding driver, not by its scope, so the fixture's id
// differs from its scope reference too.
export const FIXTURE_RUN: DemoRunEnv = {
	controlUri: "mongodb://control.fixture.test/",
	runId: "fixture-run-2026-10-20T08-55-00.000Z",
}

/** The proposal the staged story leaves pending. */
export const PENDING_PROPOSAL = {
	title: "Silent ETA drift",
	slug: "syntheses/silent-eta-drift",
}

const ARRIVALS = 36
const PLANNED_EXTRA = 4
const STARTED_AT = "2026-10-20T09:35:00.000Z"
const ENDED_AT = "2026-10-20T09:39:12.000Z"
export const FIXTURE_USAGE = {
	uncachedInput: 41_250,
	cacheRead: 28_400,
	cacheWrite: 6_100,
	output: 5_950,
}

type StepPlan = {
	role: "support" | "account" | "product"
	name: string
	detail?: string
}

function stepPlan(reusedSlug: string): StepPlan[] {
	return [
		{ role: "support", name: "read the brain", detail: "ticket queue" },
		{ role: "support", name: "write page", detail: reusedSlug },
		{
			role: "support",
			name: "replay source events",
			detail: "mdbrain_write_event",
		},
		{ role: "account", name: "read page", detail: reusedSlug },
		{ role: "account", name: "write note" },
		{ role: "product", name: "read page", detail: reusedSlug },
		{ role: "product", name: "propose page", detail: PENDING_PROPOSAL.slug },
	]
}

const opening = (runId: string, step: StepPlan): string =>
	`[${runId}] ${AGENT_ROLE_LABELS[step.role]} — ${step.name}`
const bodyOf = (runId: string, step: StepPlan): string =>
	`${opening(runId, step)}${step.detail ? ` (${step.detail})` : ""}`
const stepEventId = (n: number): string => eventIdOf(`fixture-step-${n}`)

/** The run's source files in the order it wrote them: cited and uncited ones
 * interleaved, so a first page holds both. */
function arrivalsOf(data: Data, count: number) {
	const cited = new Set(
		data.pages.flatMap((page) =>
			page.claims.flatMap((claim) => claim.evidence.map((e) => e.sourceId)),
		),
	)
	const all = [...data.sourceOf.entries()].sort((a, b) =>
		a[1].localeCompare(b[1]),
	)
	const withClaim = all.filter(([eventId]) => cited.has(eventId))
	const without = all.filter(([eventId]) => !cited.has(eventId))
	const order: Array<[string, string]> = []
	let c = 0
	let u = 0
	while (order.length < count && (c < withClaim.length || u < without.length)) {
		const next =
			(order.length % 3 === 0 && c < withClaim.length) || u >= without.length
				? withClaim[c++]
				: without[u++]
		if (next) {
			order.push(next)
		}
	}
	return order.map(([eventId, sourceId]) => ({ sourceId, eventId }))
}

export function createRunFixture(data: Data, options: RunFixtureOptions = {}) {
	const variant = options.variant ?? "steps"
	const runId = FIXTURE_RUN.runId
	const reusedSlug = data.targetPageSlug
	const plan = stepPlan(reusedSlug)
	const missed = new Set(options.missedSteps ?? [])
	const arrivals = arrivalsOf(data, options.arrivals ?? ARRIVALS)

	const agentRun = (() => {
		switch (variant) {
			case "none":
			case "unconfigured":
				return undefined
			case "running":
				return { state: "running", startedAt: STARTED_AT }
			case "incomplete":
				return {
					state: "incomplete",
					startedAt: STARTED_AT,
					endedAt: "2026-10-20T09:37:30.000Z",
					failureReason:
						"task deadline: Support Lead exceeded 90000ms at mongodb+srv://secret@cluster.invalid",
				}
			case "steps":
			case "no-steps":
				return {
					state: "complete",
					startedAt: STARTED_AT,
					endedAt: ENDED_AT,
					usage: FIXTURE_USAGE,
					stepsRecorded: plan.length,
					reusedPage: {
						slug: reusedSlug,
						writtenBy: "support",
						readBy: "account",
					},
					pendingProposal: PENDING_PROPOSAL,
					...(variant === "steps"
						? {
								steps: plan.map((step, at) => ({
									n: at + 1,
									role: step.role,
									name: step.name,
									...(step.detail ? { detail: step.detail } : {}),
									eventId: stepEventId(at + 1),
								})),
							}
						: {}),
				}
		}
	})()

	const manifest = {
		_id: runId,
		runId,
		slotIndex: 9,
		scopeRef: FIXTURE_ENV.scopeRef,
		agentId: FIXTURE_ENV.agentId,
		state: agentRun?.state === "complete" ? "used" : "ready",
		corpus: {
			sha256: "f".repeat(64),
			records: data.sourceOf.size,
			eventsPlanned: arrivals.length + PLANNED_EXTRA,
			pagesPlanned: data.pages.length,
			replaySourceIds: [],
		},
		eventsWritten: arrivals,
		pagesWritten: data.pages.map((page) => page.slug),
		createdAt: "2026-10-20T08:55:00.000Z",
		readyAt: "2026-10-20T09:30:00.000Z",
		// The driver marks a run used only when its agents finish.
		...(agentRun?.state === "complete" ? { usedAt: ENDED_AT } : {}),
		...(agentRun ? { agentRun } : {}),
	}

	const source: RunManifestSource = async (id) =>
		id === runId ? manifest : null
	const deps: RunReadDeps = {
		run: variant === "unconfigured" ? null : FIXTURE_RUN,
		manifest: source,
	}

	const reply = (body: unknown, status = 200) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		})

	const stepAt = new Map(
		plan.map((step, at) => [stepEventId(at + 1), { n: at + 1, step }]),
	)

	/** Puts the agent steps' events in front of the fixture API's cite by id,
	 * which knows only the corpus. A missed step is answered as an event the
	 * API cannot resolve in the run's scope. */
	const withStepEvents = (upstream: typeof fetch): typeof fetch =>
		(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(
				typeof input === "string"
					? input
					: input instanceof URL
						? input.href
						: input.url,
			)
			const parsed = parseCitationMarker(url.searchParams.get("marker") ?? "")
			const wanted =
				url.pathname === "/v1/cite" &&
				(init?.method ?? "GET").toUpperCase() === "GET" &&
				parsed.ok &&
				parsed.marker.kind === "event"
					? stepAt.get(parsed.marker.eventId)
					: undefined
			if (
				wanted === undefined ||
				!parsed.ok ||
				parsed.marker.kind !== "event"
			) {
				return upstream(input, init)
			}
			if (
				new Headers(init?.headers).get("authorization") !==
				`Bearer ${FIXTURE_ENV.readKey}`
			) {
				return reply(
					{
						error: { code: "UNAUTHORIZED", message: "a read key is required" },
					},
					401,
				)
			}
			// No stored claim lists a step's event, so citing it through one, or as
			// another agent, finds nothing.
			if (
				missed.has(wanted.n) ||
				url.searchParams.has("citedBy") ||
				url.searchParams.get("agentId") !== FIXTURE_ENV.agentId
			) {
				return reply(
					{
						error: {
							code: "CITATION_UNRESOLVED",
							message: "the source could not be confirmed in this scope",
						},
					},
					404,
				)
			}
			return reply({
				status: "resolved",
				kind: "event",
				marker: url.searchParams.get("marker"),
				event: {
					eventId: parsed.marker.eventId,
					canonicalId: `event:${parsed.marker.eventId}`,
					text: bodyOf(runId, wanted.step),
					timestamp: new Date(
						Date.parse(STARTED_AT) + wanted.n * 30_000,
					).toISOString(),
					scope: FIXTURE_ENV.scope,
					scopeRef: FIXTURE_ENV.scopeRef,
				},
			})
		}) as typeof fetch

	return { deps, withStepEvents, manifest, plan, arrivals }
}
