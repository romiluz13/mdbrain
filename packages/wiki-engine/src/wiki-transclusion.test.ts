import type { Collection, Db, Document } from "mongodb"
import { describe, expect, it, vi } from "vitest"
import {
	extractTransclusionTargets,
	resolveTransclusions,
} from "./wiki-transclusion.js"
import type { WikiDbHandle } from "./wiki-bridge.js"
import type { GovernanceContext } from "./wiki-governance.js"

const CTX: GovernanceContext = {
	scope: "workspace",
	scopeRef: "ws-1",
	trustTier: "standard",
}

describe("extractTransclusionTargets", () => {
	it("extracts unique slugs from {{page:slug}} markers", () => {
		const body = "See {{page:a}} and {{page:b}} and again {{page:a}}."
		expect(extractTransclusionTargets(body)).toEqual(["a", "b"])
	})

	it("extracts the slug (not the section) from {{page:slug#Section}} markers", () => {
		const body = "{{page:tables/accounts#Schema}}"
		expect(extractTransclusionTargets(body)).toEqual(["tables/accounts"])
	})

	it("returns an empty array when there are no markers", () => {
		expect(extractTransclusionTargets("plain body, no markers")).toEqual([])
	})
})

function mockHandle(pages: Record<string, { body: string }>): WikiDbHandle {
	const coll = {
		findOne: vi.fn(async (filter: Document) => {
			const slug = (filter.$and?.[0] as { slug?: string } | undefined)?.slug
			if (!slug || !pages[slug]) return null
			return {
				slug,
				body: pages[slug].body,
				scope: "workspace",
				scopeRef: "ws-1",
			}
		}),
	} as unknown as Collection
	const db = { collection: vi.fn(() => coll) } as unknown as Db
	return { db, prefix: "test_" }
}

describe("resolveTransclusions", () => {
	it("returns the body unchanged when there are no markers", async () => {
		const handle = mockHandle({})
		const out = await resolveTransclusions(handle, "no markers here", CTX)
		expect(out).toBe("no markers here")
	})

	it("inlines the full body of a referenced page", async () => {
		const handle = mockHandle({ source: { body: "Shared fact content." } })
		const out = await resolveTransclusions(
			handle,
			"Before. {{page:source}} After.",
			CTX,
		)
		expect(out).toBe("Before. Shared fact content. After.")
	})

	it("inlines only the named section of a referenced page", async () => {
		const handle = mockHandle({
			source: {
				body: "Intro text.\n\n## Schema\n\n- id: uuid\n\n## Notes\n\nOther stuff.",
			},
		})
		const out = await resolveTransclusions(
			handle,
			"{{page:source#Schema}}",
			CTX,
		)
		expect(out).toBe("- id: uuid")
		expect(out).not.toContain("Other stuff")
	})

	it("resolves multiple occurrences of the same marker independently", async () => {
		const handle = mockHandle({ source: { body: "X" } })
		const out = await resolveTransclusions(
			handle,
			"{{page:source}} and {{page:source}}",
			CTX,
		)
		expect(out).toBe("X and X")
	})

	it("degrades to an inline notice for a not-found/inaccessible page", async () => {
		const handle = mockHandle({})
		const out = await resolveTransclusions(handle, "{{page:missing}}", CTX)
		expect(out).toContain("not found or not accessible: missing")
	})

	it("degrades to an inline notice for a missing named section", async () => {
		const handle = mockHandle({ source: { body: "no headings here" } })
		const out = await resolveTransclusions(handle, "{{page:source#Nope}}", CTX)
		expect(out).toContain("section not found: source#Nope")
	})

	it("resolves nested transclusions recursively", async () => {
		const handle = mockHandle({
			a: { body: "A includes {{page:b}}." },
			b: { body: "B content." },
		})
		const out = await resolveTransclusions(handle, "{{page:a}}", CTX)
		expect(out).toBe("A includes B content..")
	})

	it("breaks a circular transclusion instead of infinite-looping", async () => {
		const handle = mockHandle({
			a: { body: "A -> {{page:b}}" },
			b: { body: "B -> {{page:a}}" },
		})
		const out = await resolveTransclusions(handle, "{{page:a}}", CTX)
		expect(out).toContain("circular transclusion: a")
	})

	it("stops at the max depth for a long non-circular chain", async () => {
		const handle = mockHandle({
			p1: { body: "{{page:p2}}" },
			p2: { body: "{{page:p3}}" },
			p3: { body: "{{page:p4}}" },
			p4: { body: "{{page:p5}}" },
			p5: { body: "{{page:p6}}" },
			p6: { body: "leaf" },
		})
		const out = await resolveTransclusions(handle, "{{page:p1}}", CTX)
		expect(out).toContain("depth limit exceeded")
	})

	it("never surfaces a page the governance context can't read (findOne receives the governance filter)", async () => {
		const coll = {
			findOne: vi.fn(async () => null),
		} as unknown as Collection
		const db = { collection: vi.fn(() => coll) } as unknown as Db
		const handle: WikiDbHandle = { db, prefix: "test_" }
		await resolveTransclusions(handle, "{{page:restricted}}", CTX)
		expect(coll.findOne).toHaveBeenCalledTimes(1)
		const [filter] = (coll.findOne as unknown as ReturnType<typeof vi.fn>).mock
			.calls[0]
		// buildGovernanceFilter's $and is present — proves the lookup is
		// governed, not a raw unscoped findOne({slug}).
		expect(filter.$and).toBeDefined()
	})
})
