// The run the fixture serves: a stored manifest, in the shape the demo control
// database holds it, and the governed recall that confirms an agent step. The
// /demo e2e reads it through the real proxy handler, so the projection, the
// pinned-scope refusal and the step confirmation rule run for real; only the
// database and the API behind them are stand-ins.
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
	/** Step numbers whose event governed recall does not return. */
	missedSteps?: number[]
	/** How many source files the run's record lists. */
	arrivals?: number
}

type Data = ReturnType<typeof createDemoUpstream>["data"]

export const FIXTURE_RUN: DemoRunEnv = {
	controlUri: "mongodb://control.fixture.test/",
	runId: FIXTURE_ENV.scopeRef,
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
const ROLE_LABEL = {
	support: "Support Lead",
	account: "Account Manager",
	product: "Product Lead",
} as const

function stepPlan(reusedSlug: string): StepPlan[] {
	return [
		{ role: "support", name: "read the brain", detail: "ticket queue" },
		{ role: "support", name: "write page", detail: reusedSlug },
		{ role: "support", name: "replay source events" },
		{ role: "account", name: "read page", detail: reusedSlug },
		{ role: "account", name: "write note" },
		{ role: "product", name: "read page", detail: reusedSlug },
		{ role: "product", name: "propose page", detail: PENDING_PROPOSAL.slug },
	]
}

const opening = (runId: string, step: StepPlan): string =>
	`[${runId}] ${ROLE_LABEL[step.role]} — ${step.name}`
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
		state: agentRun ? "used" : "ready",
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
		...(agentRun ? { usedAt: ENDED_AT, agentRun } : {}),
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

	/** Puts governed recall's step search in front of the fixture API. A missed
	 * step is answered with an unrelated event only, so only the exact-id rule
	 * keeps it from being confirmed. */
	const withRecall = (upstream: typeof fetch): typeof fetch =>
		(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(
				typeof input === "string"
					? input
					: input instanceof URL
						? input.href
						: input.url,
			)
			if (
				url.pathname !== "/v1/search" ||
				(init?.method ?? "GET").toUpperCase() !== "POST"
			) {
				return upstream(input, init)
			}
			if (
				new Headers(init?.headers).get("authorization") !==
				`Bearer ${FIXTURE_ENV.readKey}`
			) {
				return reply(
					{ error: { code: "UNAUTHORIZED", message: "a key is required" } },
					401,
				)
			}
			const sent = JSON.parse(String(init?.body ?? "{}")) as Record<
				string,
				unknown
			>
			if (
				sent.scope !== FIXTURE_ENV.scope ||
				sent.scopeRef !== FIXTURE_ENV.scopeRef ||
				sent.agentId !== FIXTURE_ENV.agentId
			) {
				return reply(
					{
						error: {
							code: "FORBIDDEN_SCOPE",
							message: "the key cannot read that scope",
						},
					},
					403,
				)
			}
			const at = plan.findIndex((step) => opening(runId, step) === sent.query)
			const hit = (eventId: string, text: string) => ({
				canonicalId: `event:${eventId}`,
				snippet: text,
				timestamp: "2026-10-20T09:36:00.000Z",
				scope: FIXTURE_ENV.scope,
				scopeRef: FIXTURE_ENV.scopeRef,
			})
			const decoy = hit(
				eventIdOf("fixture-decoy"),
				"[other] Support Lead — write page",
			)
			const results =
				at === -1 || missed.has(at + 1)
					? [decoy]
					: [
							decoy,
							hit(stepEventId(at + 1), bodyOf(runId, plan[at] as StepPlan)),
						]
			return reply({ results })
		}) as typeof fetch

	return { deps, withRecall, manifest, plan, arrivals }
}
