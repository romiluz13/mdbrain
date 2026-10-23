import type { MdbrainWikiChange } from "@mdbrain/client"
import { describe, expect, it } from "vitest"
import type { ChangesView, WikiMapPage, WikiMapView } from "./loaders.js"
import type { ContradictionCase } from "./loaders-chapters.js"
import { buildTimeline, stateAt } from "./playback.js"
import { viewAt } from "./playback-view.js"
import type { DataState } from "./states.js"

const T = (minute: number) =>
	new Date(Date.UTC(2026, 9, 20, 9, minute)).toISOString()

const change = (
	pageSlug: string,
	revision: number,
	at: string,
	added: number,
): MdbrainWikiChange =>
	({
		pageSlug,
		title: pageSlug,
		revision,
		editKind: "update",
		createdAt: at,
		baseline: "none",
		baselineRevision: null,
		claims: {
			added: [],
			changed: [],
			removed: [],
			counts: { added, changed: 0, removed: 0 },
			truncated: false,
		},
	}) as MdbrainWikiChange

const page = (slug: string, claimCount: number) =>
	({
		slug,
		title: slug,
		revision: 1,
		claimCount,
		linkCount: 0,
		links: [],
		sourceIds: [],
	}) as unknown as WikiMapPage

const map: WikiMapView = {
	pages: [page("a", 2), page("b", 1)],
	pageTotal: 2,
	claimTotal: 3,
	sourceTotal: 0,
	unresolvedContradictionCount: 1,
}
const changes: ChangesView = {
	changes: [change("a", 1, T(1), 2), change("b", 1, T(5), 1)],
	window: { since: T(0), until: T(9), settled: true },
	hasMore: false,
	complete: true,
}
const contradiction = (detectedAt: string): DataState<ContradictionCase> => ({
	kind: "ready",
	data: {
		id: "c1",
		detectedAt,
		resolution: "unresolved",
		claims: [],
		unresolvedCount: 1,
	},
})

function built() {
	const result = buildTimeline(map, changes)
	if (!result.ok) throw new Error(result.reason)
	return result.timeline
}

describe("viewAt", () => {
	it("shows the pages, revisions and contradiction as they stood at the cursor", () => {
		const timeline = built()
		const data = {
			map: { kind: "ready", data: map } as const,
			changes: { kind: "ready", data: changes } as const,
			contradiction: contradiction(T(7)),
			run: { kind: "loading" } as const,
		}
		const early = viewAt(data, stateAt(timeline, 1), timeline)
		expect(early.map.kind === "ready" && early.map.data.pageTotal).toBe(1)
		expect(
			early.changes.kind === "ready" && early.changes.data.changes,
		).toHaveLength(1)
		expect(early.contradiction).toEqual({ kind: "empty" })
		expect(early.run).toBe(data.run)

		// Recorded after the last revision stored before it, so the cursor that
		// has applied that revision shows it.
		const late = viewAt(data, stateAt(timeline, 2), timeline)
		expect(late.map.kind === "ready" && late.map.data.pageTotal).toBe(2)
		expect(late.contradiction.kind).toBe("ready")
	})

	it("keeps the contradiction once its detection time has passed", () => {
		const timeline = built()
		const data = {
			map: { kind: "ready", data: map } as const,
			changes: { kind: "ready", data: changes } as const,
			contradiction: contradiction(T(5)),
		}
		const view = viewAt(data, stateAt(timeline, 2), timeline)
		expect(view.contradiction.kind).toBe("ready")
		expect(
			view.map.kind === "ready" && view.map.data.unresolvedContradictionCount,
		).toBe(1)
	})

	it("leaves a read that is not ready as it is", () => {
		const timeline = built()
		const data = {
			map: { kind: "loading" } as const,
			changes: { kind: "loading" } as const,
			contradiction: { kind: "loading" } as DataState<ContradictionCase>,
		}
		expect(viewAt(data, stateAt(timeline, 1), timeline)).toEqual(data)
	})
})
