import { describe, expect, it } from "vitest"
import { parseWikiSearch } from "./wiki-search-view.js"

describe("parseWikiSearch", () => {
	it("reads reported hit fields and leaves absent ones undefined", () => {
		const view = parseWikiSearch({
			results: [
				{
					page: { slug: "a", title: "A", revision: 2, scope: "workspace" },
					score: 0.5,
					source: "text",
				},
				{ page: { slug: "b" } },
			],
			total: 2,
			recipe: "fast",
			mode: "text",
		})
		expect(view?.total).toBe(2)
		expect(view?.hits[0]).toMatchObject({
			slug: "a",
			score: 0.5,
			source: "text",
		})
		expect(view?.hits[1]).toEqual({
			slug: "b",
			title: "b",
			kind: undefined,
			summary: undefined,
			revision: undefined,
			state: undefined,
			scope: undefined,
			scopeRef: undefined,
			score: undefined,
			source: undefined,
		})
	})

	it("returns null for bodies that are not search responses", () => {
		expect(parseWikiSearch(null)).toBeNull()
		expect(parseWikiSearch({ pages: [] })).toBeNull()
		expect(parseWikiSearch({ results: [{ page: {} }] })).toBeNull()
	})

	it("treats an empty result list as a real zero-result response", () => {
		expect(parseWikiSearch({ results: [], total: 0 })?.hits).toEqual([])
	})
})
