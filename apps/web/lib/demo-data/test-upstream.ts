import type { MdbrainWikiClaim, MdbrainWikiPageView } from "@mdbrain/client"
import { vi } from "vitest"

/** Shared test helper: a JSON Response with a content type. */
export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	})
}

/** Stubs the global fetch MdbrainClient uses, keyed by exact upstream path. */
export function stubUpstream(
	routes: Record<string, (url: URL, init?: RequestInit) => Response>,
): URL[] {
	const calls: URL[] = []
	vi.stubGlobal(
		"fetch",
		async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const raw =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.href
						: input.url
			const url = new URL(raw)
			calls.push(url)
			const handler = routes[url.pathname]
			if (!handler) {
				return json(
					{
						error: { code: "NO_STUB", message: `no stub for ${url.pathname}` },
					},
					500,
				)
			}
			return handler(url, init)
		},
	)
	return calls
}

/** Shared test helper: one stored claim. */
export function claimView(): MdbrainWikiClaim {
	return {
		id: "claim-1",
		text: "Havnor renews the Halvorsen facility in 2027.",
		status: "active",
		confidence: 0.92,
		evidence: [{ kind: "event", sourceId: "evt-1" }],
		derivedFrom: [],
	}
}

/** Shared test helper: one stored page. */
export function pageView(
	overrides: Partial<MdbrainWikiPageView> = {},
): MdbrainWikiPageView {
	return {
		_id: "page-1",
		kind: "person",
		title: "Halvorsen Renewal",
		slug: "halvorsen-renewal",
		aliases: [],
		summary: "What changed",
		body: "",
		frontmatter: { type: "person" },
		claims: [claimView()],
		contradictions: [],
		questions: [],
		relationships: [
			{ targetPageSlug: "havnor", targetTitle: "Havnor", kind: "related" },
		],
		personCard: null,
		scope: "workspace",
		scopeRef: "demo-run-2",
		trustTier: "standard",
		permissions: {},
		state: "active",
		revision: 3,
		validFrom: "2026-11-16T10:00:00.000Z",
		freshness: "fresh",
		createdAt: "2026-11-16T10:00:00.000Z",
		updatedAt: "2026-11-16T10:30:00.000Z",
		backlinks: [],
		transcludes: [],
		...overrides,
	}
}
