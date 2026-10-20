// Entity overview assembly: recent revisions, authorized per revision snapshot
// before the limit is applied.
//
// The collections are an in-memory fake that EVALUATES the real governance
// filters and $in lookups (src/testing/fake-wiki-db.ts). It is not MongoDB: the
// live check on the demo stack covers real operator semantics.

import { describe, expect, it } from "vitest"
import {
	HIDDEN,
	SCOPE,
	exec,
	outsider,
	overviewOf,
	page,
	revision,
} from "./testing/overview-fixtures.js"

describe("revisions", () => {
	it("lists the newest revisions as summaries, without the snapshot", async () => {
		const revisions = [1, 2, 3].map((n) => revision("hub", n))

		const overview = await overviewOf([page("hub")], "hub", outsider, {
			revisions,
		}).result

		expect(overview?.revisions).toEqual({
			items: [3, 2, 1].map((n) => ({
				pageSlug: "hub",
				...SCOPE,
				revision: n,
				editKind: n === 1 ? "create" : "update",
				editor: { id: "agent-1", name: "Writer" },
				createdAt: new Date(Date.UTC(2026, 8, n)).toISOString(),
			})),
			hasMore: false,
		})
		expect(JSON.stringify(overview?.revisions)).not.toContain("Snapshot only")
	})

	it("ignores other pages and other scope refs", async () => {
		const revisions = [
			revision("hub", 1),
			revision("other", 2),
			revision("hub", 3, {}, { scopeRef: "ws-2" }),
		]

		const overview = await overviewOf([page("hub")], "hub", outsider, {
			revisions,
		}).result

		expect(overview?.revisions.items.map((r) => r.revision)).toEqual([1])
	})

	it("skips revisions whose own snapshot was restricted, before applying the limit", async () => {
		const revisions = [1, 2, 3, 4, 5, 6].map((n) =>
			revision("hub", n, n === 4 || n === 5 ? { permissions: HIDDEN } : {}),
		)

		const overview = await overviewOf([page("hub")], "hub", outsider, {
			revisions,
			limits: { revisions: 3 },
		}).result

		expect(overview?.revisions.items.map((r) => r.revision)).toEqual([6, 3, 2])
		expect(overview?.revisions.hasMore).toBe(true)
	})

	it("does not report hasMore for revisions the caller cannot see", async () => {
		const revisions = [1, 2, 3, 4].map((n) =>
			revision("hub", n, n <= 2 ? { permissions: HIDDEN } : {}),
		)

		const overview = await overviewOf([page("hub")], "hub", outsider, {
			revisions,
			limits: { revisions: 2 },
		}).result

		expect(overview?.revisions.items.map((r) => r.revision)).toEqual([4, 3])
		expect(overview?.revisions.hasMore).toBe(false)
	})

	it("shows restricted revisions to a caller the snapshot allows", async () => {
		const revisions = [1, 2].map((n) =>
			revision("hub", n, n === 2 ? { permissions: HIDDEN } : {}),
		)

		const overview = await overviewOf([page("hub")], "hub", exec, {
			revisions,
		}).result

		expect(overview?.revisions.items.map((r) => r.revision)).toEqual([2, 1])
	})

	it("authorizes against the revision's own snapshot, not the page's current permissions", async () => {
		const revisions = [revision("hub", 1), revision("hub", 2)]

		const overview = await overviewOf(
			[page("hub", { permissions: { privacyTier: "public" } })],
			"hub",
			outsider,
			{ revisions },
		).result

		expect(overview?.revisions.items.map((r) => r.revision)).toEqual([2, 1])
	})

	it("shows the same section however long the hidden history is", async () => {
		const withHidden = async (count: number) => {
			const hidden = Array.from({ length: count }, (_, i) =>
				revision("hub", i + 2, { permissions: HIDDEN }),
			)
			const overview = await overviewOf([page("hub")], "hub", outsider, {
				revisions: [revision("hub", 1), ...hidden],
			}).result
			return overview?.revisions
		}

		const short = await withHidden(3)
		expect(short).toEqual({
			items: [expect.objectContaining({ revision: 1 })],
			hasMore: false,
		})
		expect(await withHidden(199)).toEqual(short)
		expect(await withHidden(230)).toEqual(short)
	})

	it("says there is more only when another readable revision exists", async () => {
		const hidden = Array.from({ length: 230 }, (_, i) =>
			revision("hub", i + 3, { permissions: HIDDEN }),
		)
		const revisions = [revision("hub", 1), revision("hub", 2), ...hidden]

		const overview = await overviewOf([page("hub")], "hub", outsider, {
			revisions,
			limits: { revisions: 1 },
		}).result

		expect(overview?.revisions).toEqual({
			items: [expect.objectContaining({ revision: 2 })],
			hasMore: true,
		})
	})
})
