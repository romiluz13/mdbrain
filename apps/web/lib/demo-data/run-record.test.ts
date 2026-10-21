import { describe, expect, it } from "vitest"
import { projectRunRecord } from "./run-record.js"

const PINNED = { scopeRef: "demo-run-9", agentId: "demo-run-9" }

function manifest(overrides: Record<string, unknown> = {}) {
	return {
		_id: "demo-run-9",
		runId: "demo-run-9",
		slotIndex: 9,
		scopeRef: "demo-run-9",
		agentId: "demo-run-9",
		state: "used",
		corpus: {
			sha256: "f".repeat(64),
			records: 700,
			eventsPlanned: 4,
			pagesPlanned: 3,
			replaySourceIds: ["src-replay-1"],
		},
		limitSources: null,
		eventsWritten: [
			{ sourceId: "src-2", eventId: "evt-b" },
			{ sourceId: "src-1", eventId: "evt-a" },
			{ sourceId: "src-3", eventId: "evt-c" },
		],
		pagesWritten: ["accounts/lantern-bay", "products/track"],
		createdAt: "2026-10-20T09:35:00.000Z",
		updatedAt: "2026-10-20T10:00:00.000Z",
		readyAt: "2026-10-20T09:50:00.000Z",
		usedAt: "2026-10-20T10:00:00.000Z",
		agentRunState: "complete",
		agentRun: {
			state: "complete",
			startedAt: "2026-10-20T09:55:00.000Z",
			endedAt: "2026-10-20T09:59:12.000Z",
			usage: {
				uncachedInput: 40_000,
				cacheRead: 30_000,
				cacheWrite: 5_000,
				output: 6_000,
			},
			stepsRecorded: 2,
			reusedPage: {
				slug: "accounts/halvorsen-freight-group",
				writtenBy: "support",
				readBy: "account",
			},
			pendingProposal: {
				title: "Silent ETA drift",
				slug: "syntheses/silent-eta-drift",
			},
		},
		...overrides,
	}
}

function projected(doc: unknown) {
	const result = projectRunRecord(doc, PINNED)
	if (!result.ok) {
		throw new Error(`expected a record, got ${result.code}`)
	}
	return result.record
}

describe("projectRunRecord", () => {
	it("keeps the arrivals in the order the manifest holds them, with their logical source ids", () => {
		expect(projected(manifest()).arrivals).toEqual([
			{ sourceId: "src-2", eventId: "evt-b" },
			{ sourceId: "src-1", eventId: "evt-a" },
			{ sourceId: "src-3", eventId: "evt-c" },
		])
	})

	it("carries the state, the timestamps, the plan counts and the pages written", () => {
		const record = projected(manifest())
		expect(record).toMatchObject({
			state: "used",
			createdAt: "2026-10-20T09:35:00.000Z",
			readyAt: "2026-10-20T09:50:00.000Z",
			usedAt: "2026-10-20T10:00:00.000Z",
			eventsPlanned: 4,
			pagesPlanned: 3,
			pagesWritten: ["accounts/lantern-bay", "products/track"],
		})
	})

	it("carries the agent run summary and no step list when the run predates steps", () => {
		const { agentRun } = projected(manifest())
		expect(agentRun).toMatchObject({
			state: "complete",
			startedAt: "2026-10-20T09:55:00.000Z",
			endedAt: "2026-10-20T09:59:12.000Z",
			stepsRecorded: 2,
			usage: {
				uncachedInput: 40_000,
				cacheRead: 30_000,
				cacheWrite: 5_000,
				output: 6_000,
			},
			reusedPage: {
				slug: "accounts/halvorsen-freight-group",
				writtenBy: "support",
				readBy: "account",
			},
			pendingProposal: {
				title: "Silent ETA drift",
				slug: "syntheses/silent-eta-drift",
			},
		})
		expect(agentRun?.steps).toBeUndefined()
	})

	it("carries each step with its number, role, labels and event id, in record order", () => {
		const steps = [
			{
				n: 1,
				role: "support",
				name: "write event",
				detail: "src-9",
				eventId: "evt-s1",
			},
			{ n: 2, role: "account", name: "read page", eventId: "evt-s2" },
		]
		const { agentRun } = projected(
			manifest({
				agentRun: {
					...manifest().agentRun,
					steps: [steps[1], steps[0]],
				},
			}),
		)
		expect(agentRun?.steps).toEqual([steps[1], steps[0]])
	})

	it("drops a step that does not have the stated shape instead of inventing one", () => {
		const { agentRun } = projected(
			manifest({
				agentRun: {
					...manifest().agentRun,
					steps: [
						{ n: 1, role: "support", name: "write event", eventId: "evt-s1" },
						{ n: 2, role: "janitor", name: "sweep", eventId: "evt-s2" },
						{ n: 3, role: "account", name: "read page" },
						{ role: "account", name: "read page", eventId: "evt-s4" },
					],
				},
			}),
		)
		expect(agentRun?.steps).toEqual([
			{ n: 1, role: "support", name: "write event", eventId: "evt-s1" },
		])
	})

	it("never carries the run id, the scope, the agent, the corpus digest or a replay list", () => {
		const text = JSON.stringify(projected(manifest()))
		for (const private_ of ["demo-run-9", "f".repeat(64), "src-replay-1"]) {
			expect(text).not.toContain(private_)
		}
		expect(Object.keys(projected(manifest())).sort()).not.toContain("scopeRef")
	})

	it("replaces an incomplete run's stored reason with a fixed label", () => {
		const record = projected(
			manifest({
				agentRunState: "incomplete",
				agentRun: {
					state: "incomplete",
					startedAt: "2026-10-20T09:55:00.000Z",
					endedAt: "2026-10-20T09:56:00.000Z",
					failureReason:
						"task deadline: Support Lead exceeded 90000ms at mongodb+srv://u:p@cluster0.example.net",
				},
			}),
		)
		expect(record.agentRun?.state).toBe("incomplete")
		expect(record.agentRun?.incompleteLabel).toBe(
			"The agent run stopped before it finished.",
		)
		expect(JSON.stringify(record)).not.toContain("mongodb+srv")
		expect(JSON.stringify(record)).not.toContain("deadline")
	})

	it("replaces a failed seeding's stored reason with a fixed label", () => {
		const record = projected(
			manifest({
				state: "failed",
				failedAt: "2026-10-20T09:40:00.000Z",
				failureReason: "write refused for host db.internal",
				agentRun: undefined,
			}),
		)
		expect(record.state).toBe("failed")
		expect(record.failedLabel).toBe("Seeding stopped before the run was ready.")
		expect(JSON.stringify(record)).not.toContain("db.internal")
	})

	it("has no agent run for a run that has not started one", () => {
		const record = projected(
			manifest({ agentRun: undefined, agentRunState: "" }),
		)
		expect(record.agentRun).toBeUndefined()
	})

	it("carries a running agent run with no end", () => {
		const record = projected(
			manifest({
				agentRun: { state: "running", startedAt: "2026-10-20T09:55:00.000Z" },
				agentRunState: "running",
			}),
		)
		expect(record.agentRun).toEqual({
			state: "running",
			startedAt: "2026-10-20T09:55:00.000Z",
		})
	})

	it("refuses a manifest whose scope differs from the pinned scope", () => {
		expect(
			projectRunRecord(manifest({ scopeRef: "demo-run-8" }), PINNED),
		).toEqual({
			ok: false,
			code: "RUN_RECORD_MISMATCH",
		})
	})

	it("refuses a manifest whose agent differs from the pinned agent", () => {
		expect(
			projectRunRecord(manifest({ agentId: "demo-run-8" }), PINNED),
		).toEqual({
			ok: false,
			code: "RUN_RECORD_MISMATCH",
		})
	})

	it("refuses a document that is not a manifest", () => {
		for (const doc of [
			null,
			"text",
			[],
			manifest({ state: "exploded" }),
			manifest({ eventsWritten: "none" }),
			manifest({ corpus: undefined }),
		]) {
			expect(projectRunRecord(doc, PINNED)).toEqual({
				ok: false,
				code: "RUN_RECORD_MALFORMED",
			})
		}
	})

	it("skips an arrival that has no event id instead of inventing one", () => {
		const record = projected(
			manifest({
				eventsWritten: [
					{ sourceId: "src-1", eventId: "evt-a" },
					{ sourceId: "src-2" },
					{ eventId: "evt-c" },
				],
			}),
		)
		expect(record.arrivals).toEqual([{ sourceId: "src-1", eventId: "evt-a" }])
	})
})
