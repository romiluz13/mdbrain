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
