import { describe, expect, it, vi } from "vitest"
import { loadOverview } from "./overview.js"

describe("loadOverview", () => {
	it("builds the console overview from safe public metadata only", async () => {
		const fetcher = vi.fn(async (input: string | URL | Request) => {
			const url = String(input)
			if (url.endsWith("/health")) {
				return new Response(
					JSON.stringify({ ok: true, service: "mdbrain-api" }),
					{ status: 200 },
				)
			}
			if (url.endsWith("/openapi.json")) {
				return new Response(
					JSON.stringify({
						paths: {
							"/health": { get: {} },
							"/v1/search": { post: {} },
						},
					}),
					{ status: 200 },
				)
			}
			throw new Error(`unexpected request: ${url}`)
		})

		const overview = await loadOverview(
			"http://127.0.0.1:3847/",
			{ Authorization: "Bearer secret" },
			fetcher,
		)

		expect(fetcher).toHaveBeenCalledTimes(2)
		expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
			"http://127.0.0.1:3847/health",
			"http://127.0.0.1:3847/openapi.json",
		])
		expect(overview).toMatchObject({
			health: { ok: true, service: "mdbrain-api" },
			openApiPathCount: 2,
			openApiOperationCount: 2,
		})
	})
})
