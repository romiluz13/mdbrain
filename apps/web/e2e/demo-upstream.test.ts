// The e2e fixture is a stand-in for the API, so it gets its own check: the real
// loaders, through the real proxy handler, must read the committed corpus out of
// it exactly as the corpus states it.
import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
	loadWikiChanges,
	loadWikiMap,
	type DemoDataUpstream,
} from "../lib/demo-data/loaders.js"
import {
	loadClaimSources,
	loadContradictionCase,
	loadWikiSearch,
} from "../lib/demo-data/loaders-chapters.js"
import { handleDemoRead } from "../lib/demo-data/proxy.js"
import { corpusDir, createDemoUpstream, FIXTURE_ENV } from "./demo-upstream.js"

const browserUpstream: DemoDataUpstream = {
	apiBaseUrl: "http://demo.local/api/demo",
	readKey: "",
}

type World = {
	pages: Array<{
		slug: string
		claims: Array<{ evidence: Array<{ sourceId: string }> }>
	}>
	sources: Array<{ id: string; date: string }>
	contradiction: { incoming: { slug: string } }
}

const world = JSON.parse(
	readFileSync(join(corpusDir(), "world.json"), "utf8"),
) as World

afterEach(() => {
	vi.unstubAllGlobals()
})

function throughProxy() {
	const upstream = createDemoUpstream()
	vi.stubGlobal(
		"fetch",
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const raw =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.href
						: input.url
			return handleDemoRead(new Request(raw, init), FIXTURE_ENV, upstream.fetch)
		},
	)
	return upstream
}

describe("demo upstream fixture", () => {
	const slugs = new Set(world.pages.map((p) => p.slug))
	const pages =
		world.pages.length + (slugs.has(world.contradiction.incoming.slug) ? 0 : 1)
	const claims =
		world.pages.reduce((n, p) => n + p.claims.length, 0) +
		(slugs.has(world.contradiction.incoming.slug) ? 0 : 1)

	it("serves every corpus page and claim through the real proxy and loaders", async () => {
		throughProxy()
		const map = await loadWikiMap(browserUpstream)
		expect(map.kind).toBe("ready")
		if (map.kind !== "ready") return
		expect(map.data.pageTotal).toBe(pages)
		expect(map.data.pages).toHaveLength(pages)
		expect(map.data.claimTotal).toBe(claims)
		const cited = new Set<string>()
		for (const page of world.pages) {
			for (const claim of page.claims)
				for (const e of claim.evidence) cited.add(e.sourceId)
		}
		expect(map.data.sourceTotal).toBeGreaterThanOrEqual(cited.size)
		expect(map.data.unresolvedContradictionCount).toBe(1)
	})

	it("holds the planted contradiction with both sources and their business times", async () => {
		throughProxy()
		const result = await loadContradictionCase(browserUpstream)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.claims).toHaveLength(2)
		for (const entry of result.data.claims) {
			expect(entry.claim.status).toBe("contradicted")
			expect(entry.sources.kind).toBe("ready")
			const source =
				entry.sources.kind === "ready"
					? entry.sources.data.sources[0]
					: undefined
			expect(source?.status).toBe("resolved")
			const dated = world.sources.find((s) => `evt-${s.id}` === source?.eventId)
			expect(source?.businessTime).toBe(dated?.date)
			expect(source?.text?.length ?? 0).toBeGreaterThan(20)
		}
	})

	it("answers a text-lane question with the page that holds the answer", async () => {
		throughProxy()
		const result = await loadWikiSearch(browserUpstream, "Halvorsen renewal")
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.hits.map((h) => h.slug)).toContain(
			"accounts/halvorsen-freight-group",
		)
	})

	it("reads the stored revisions from the first page's creation time", async () => {
		throughProxy()
		const result = await loadWikiChanges(
			browserUpstream,
			"2026-10-20T08:59:59.000Z",
		)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.changes).toHaveLength(pages)
		expect(result.data.complete).toBe(true)
	})

	it("opens any claim's sources through cite", async () => {
		throughProxy()
		const map = await loadWikiMap(browserUpstream)
		if (map.kind !== "ready") throw new Error("map not ready")
		const withEvidence = map.data.pages
			.flatMap((p) => p.claims)
			.find((c) => c.evidence.length > 0)
		if (!withEvidence) throw new Error("no claim with evidence")
		const sources = await loadClaimSources(browserUpstream, withEvidence)
		expect(sources.kind).toBe("ready")
	})

	it("refuses a read that carries no key or the wrong run, so the proxy has to inject both", async () => {
		const upstream = createDemoUpstream()
		const noKey = await upstream.fetch(
			"http://upstream.test/v1/wiki?scope=workspace&scopeRef=demo-run-e2e&limit=1",
		)
		expect(noKey.status).toBe(401)
		const wrongRun = await upstream.fetch(
			"http://upstream.test/v1/wiki?scope=workspace&scopeRef=other&limit=1",
			{
				headers: { authorization: `Bearer ${FIXTURE_ENV.readKey}` },
			},
		)
		expect(wrongRun.status).toBe(403)
	})
})
