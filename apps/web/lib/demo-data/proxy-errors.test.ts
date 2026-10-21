import { describe, expect, it, vi } from "vitest"
import { handleDemoRead, type DemoProxyEnv } from "./proxy.js"

const env: DemoProxyEnv = {
	apiBaseUrl: "http://internal.example:3857",
	readKey: "test-read-key-123",
	scope: "workspace",
	scopeRef: "demo-run-8",
	agentId: "demo-run-8",
}

const LIST = "/api/demo/v1/wiki?limit=5"

function upstream(status: number, body: unknown, raw = false): typeof fetch {
	return (async () =>
		new Response(raw ? String(body) : JSON.stringify(body), {
			status,
			headers: { "content-type": raw ? "text/html" : "application/json" },
		})) as typeof fetch
}

async function read(
	fetchImpl: typeof fetch,
	path = LIST,
): Promise<{ status: number; text: string; json: unknown }> {
	const response = await handleDemoRead(
		new Request(`http://demo.local${path}`),
		env,
		fetchImpl,
	)
	const text = await response.text()
	let json: unknown = null
	try {
		json = JSON.parse(text)
	} catch {
		json = null
	}
	return { status: response.status, text, json }
}

describe("a transport failure", () => {
	it("answers a fixed envelope and leaks neither the error text, the origin nor the key", async () => {
		const spies = [
			vi.spyOn(console, "log"),
			vi.spyOn(console, "error"),
			vi.spyOn(console, "warn"),
		].map((spy) => spy.mockImplementation(() => {}))
		const failing = (async () => {
			throw new Error(
				"connect ECONNREFUSED 10.0.0.5:3857 at http://internal.example:3857/v1/wiki for test-read-key-123",
			)
		}) as typeof fetch
		const result = await read(failing)
		expect(result.status).toBe(502)
		expect(result.json).toEqual({
			error: {
				code: "UPSTREAM_UNREACHABLE",
				message: "The demo data service could not be reached.",
			},
		})
		for (const leaked of [
			"ECONNREFUSED",
			"10.0.0.5",
			"internal.example",
			"test-read-key-123",
		]) {
			expect(result.text).not.toContain(leaked)
		}
		for (const spy of spies) {
			expect(spy).not.toHaveBeenCalled()
			spy.mockRestore()
		}
	})
})

describe("an upstream error the page can act on", () => {
	// Literals, not the proxy's own table: each row is what the browser may see.
	const cases: Array<[code: string, status: number, message: string]> = [
		["WIKI_NOT_FOUND", 404, "That page is not stored in this run."],
		["CITATION_NOT_FOUND", 404, "That citation is not stored in this run."],
		[
			"CITATION_UNRESOLVED",
			404,
			"The source could not be confirmed through governed recall.",
		],
		[
			"CITATION_RECALL_DEGRADED",
			503,
			"Recall is busy, so the source could not be checked yet. Try again shortly.",
		],
		[
			"SEARCH_UNAVAILABLE",
			503,
			"Search is unavailable right now. Try again shortly.",
		],
		["RATE_LIMITED", 429, "Too many reads in a short time. Try again shortly."],
	]

	it.each(
		cases,
	)("%s keeps its status and code and gets a fixed message", async (code, status, message) => {
		const result = await read(
			upstream(status, {
				error: {
					code,
					message: "page products/secret-plan in team-x: mongo node db-3 down",
					stack: "Error: at /srv/api/dist/routes/v1.js:2652",
					details: { host: "db-3.internal" },
				},
			}),
		)
		expect(result.status).toBe(status)
		expect(result.json).toEqual({ error: { code, message } })
		for (const leaked of ["secret-plan", "team-x", "db-3", "/srv/api"]) {
			expect(result.text).not.toContain(leaked)
		}
	})

	it("keeps retryAfterMs for a throttled citation only, bounded", async () => {
		const degraded = (retryAfterMs: unknown) =>
			read(
				upstream(503, {
					error: {
						code: "CITATION_RECALL_DEGRADED",
						message: "recall was throttled",
						retryable: true,
						retryAfterMs,
					},
				}),
			)
		expect((await degraded(1500)).json).toMatchObject({
			error: { code: "CITATION_RECALL_DEGRADED", retryAfterMs: 1500 },
		})
		expect((await degraded(900_000_000)).json).toMatchObject({
			error: { retryAfterMs: 600_000 },
		})
		for (const bad of ["soon", -5, null, Number.NaN, undefined]) {
			const result = await degraded(bad)
			expect(result.json, String(bad)).toEqual({
				error: {
					code: "CITATION_RECALL_DEGRADED",
					message:
						"Recall is busy, so the source could not be checked yet. Try again shortly.",
				},
			})
		}
		const other = await read(
			upstream(404, {
				error: { code: "WIKI_NOT_FOUND", message: "x", retryAfterMs: 1500 },
			}),
		)
		expect(JSON.stringify(other.json)).not.toContain("retryAfterMs")
	})
})

describe("any other upstream failure", () => {
	const generic = {
		error: {
			code: "UPSTREAM_ERROR",
			message: "The demo data service could not answer that read.",
		},
	}

	it.each([
		[500, "WIKI_LIST_FAILED", "MongoServerError: not authorized on mdbrain"],
		[401, "UNAUTHORIZED", "a read key is required"],
		[403, "FORBIDDEN", "the key cannot read scope workspace/demo-run-8"],
		[400, "VALIDATION_ERROR", "scope and scopeRef query params are required"],
		[502, "UPSTREAM_ERROR", "the API is down"],
	])("%i %s becomes the generic envelope", async (status, code, message) => {
		const result = await read(upstream(status, { error: { code, message } }))
		expect(result.status).toBe(502)
		expect(result.json).toEqual(generic)
		expect(result.text).not.toContain(message)
	})

	it("treats a body that is not an error envelope the same way", async () => {
		for (const body of [
			upstream(
				500,
				"<html>nginx 502 Bad Gateway internal.example</html>",
				true,
			),
			upstream(500, "", true),
			upstream(500, { message: "boom" }),
			upstream(500, ["a"]),
			upstream(500, { error: "boom at /srv" }),
			upstream(500, { error: { code: 42, message: "x" } }),
		]) {
			const result = await read(body)
			expect(result.status).toBe(502)
			expect(result.json).toEqual(generic)
		}
	})

	it("never lets the read key through, even when an error echoes it", async () => {
		const result = await read(
			upstream(500, {
				error: { code: "X", message: "bad key test-read-key-123" },
			}),
		)
		expect(result.text).not.toContain("test-read-key-123")
	})
})

describe("a successful read", () => {
	it("is passed through, with the read key still redacted", async () => {
		const result = await read(
			upstream(200, { pages: [], total: 0, note: "echo test-read-key-123" }),
		)
		expect(result.status).toBe(200)
		expect(result.json).toEqual({
			pages: [],
			total: 0,
			note: "echo [redacted]",
		})
	})
})
