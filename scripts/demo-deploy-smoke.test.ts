// Tests for the deployed-stack smoke (ticket 17, D23/D26/D28). Every check
// runs against a fake fetch, so no test touches the network. The fakes answer
// with the exact envelopes the demo proxy, the answer route and the API
// produce - shapes pinned by their own tests (proxy-errors.ts,
// answer-guards.ts, proposal-policy.test.ts, principal-self-routes.test.ts).

import { describe, expect, it } from "vitest"
import {
	checkAnswerGuards,
	checkEdgeRateLimit,
	checkOtherScopeRefused,
	checkPinnedScopeRead,
	checkPrincipalSelf,
	checkPublicEnvelope,
	checkRunRead,
	checkWriteRefused,
	parseDeploySmokeArgs,
	runDeploySmoke,
	type FetchLike,
} from "./demo-deploy-smoke.js"

const WEB = "https://demo.example.org"
const API = "https://api.example.org"
const KEY = "reader-key-secret"
const SCOPE_REF = "demo-run-12"

const jsonResponse = (status: number, body: unknown): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	})

const envelope = (status: number, code: string, message: string): Response =>
	jsonResponse(status, { error: { code, message } })

const READER_SELF = {
	subjectId: "demo-reader-12",
	trustTier: "standard",
	capabilities: ["read"],
	grants: [{ scope: "workspace", scopeRef: SCOPE_REF }],
}

/** Records every call and routes it to a handler by method and full path
 * (including the query string). */
function fakeStack(routes: Record<string, (init?: RequestInit) => Response>): {
	fetch: FetchLike
	calls: Array<{ url: string; init?: RequestInit }>
} {
	const calls: Array<{ url: string; init?: RequestInit }> = []
	const fetch: FetchLike = (url, init) => {
		calls.push({ url, init })
		const path = url.replace(/^[a-z]+:\/\/[^/]+/, "")
		const route = routes[`${init?.method ?? "GET"} ${path}`]
		if (!route) {
			throw new Error(
				`fake stack: no route for ${init?.method ?? "GET"} ${path}`,
			)
		}
		return Promise.resolve(route(init))
	}
	return { fetch, calls }
}

describe("parseDeploySmokeArgs", () => {
	it("reads the origins and the key, strips trailing slashes, and defaults the D28 limits", () => {
		expect(
			parseDeploySmokeArgs(
				[
					"--web",
					`${WEB}/`,
					"--api",
					`${API}/`,
					"--key",
					KEY,
					"--scope-ref",
					SCOPE_REF,
				],
				{},
			),
		).toEqual({
			web: WEB,
			api: API,
			readKey: KEY,
			scopeRef: SCOPE_REF,
			v1Limit: 120,
			answersLimit: 10,
			skipRate: false,
		})
	})

	it("takes the key from DEMO_DEPLOY_READ_KEY and honors the remaining flags", () => {
		expect(
			parseDeploySmokeArgs(
				[
					"--web",
					WEB,
					"--api",
					API,
					"--scope-ref",
					SCOPE_REF,
					"--v1-limit",
					"60",
					"--answers-limit",
					"5",
					"--skip-rate",
				],
				{ DEMO_DEPLOY_READ_KEY: KEY },
			),
		).toEqual({
			web: WEB,
			api: API,
			readKey: KEY,
			scopeRef: SCOPE_REF,
			v1Limit: 60,
			answersLimit: 5,
			skipRate: true,
		})
	})

	it("refuses a missing web origin, a missing api origin, a missing key, a non-http origin and a bad limit", () => {
		const base = ["--api", API, "--key", KEY]
		expect(parseDeploySmokeArgs(["--web", WEB], {})).toMatchObject({
			error: expect.stringContaining("api"),
		})
		expect(parseDeploySmokeArgs(base, {})).toMatchObject({
			error: expect.stringContaining("web"),
		})
		expect(
			parseDeploySmokeArgs(["--web", WEB, "--api", API], {}),
		).toMatchObject({ error: expect.stringContaining("key") })
		expect(
			parseDeploySmokeArgs(["--web", WEB, "--api", API, "--key", KEY], {}),
		).toMatchObject({ error: expect.stringContaining("scope-ref") })
		expect(
			parseDeploySmokeArgs(
				["--web", "ftp://demo.example.org", "--api", API, "--key", KEY],
				{},
			),
		).toMatchObject({ error: expect.stringContaining("web") })
		expect(
			parseDeploySmokeArgs(
				[
					"--web",
					WEB,
					"--api",
					API,
					"--key",
					KEY,
					"--scope-ref",
					SCOPE_REF,
					"--v1-limit",
					"many",
				],
				{},
			),
		).toMatchObject({ error: expect.stringContaining("v1-limit") })
	})
})

describe("checkPinnedScopeRead", () => {
	it("passes when the proxy serves the pinned wiki list", async () => {
		const { fetch } = fakeStack({
			"GET /api/demo/v1/wiki": () => jsonResponse(200, { pages: [] }),
		})
		const result = await checkPinnedScopeRead(WEB, fetch)
		expect(result.ok).toBe(true)
	})

	it("fails on a non-200 answer and on an unreachable web origin", async () => {
		const down: FetchLike = () => Promise.reject(new Error("refused"))
		expect((await checkPinnedScopeRead(WEB, down)).ok).toBe(false)
		const { fetch } = fakeStack({
			"GET /api/demo/v1/wiki": () =>
				envelope(
					502,
					"UPSTREAM_ERROR",
					"The demo data service could not answer that read.",
				),
		})
		const result = await checkPinnedScopeRead(WEB, fetch)
		expect(result.ok).toBe(false)
		expect(result.detail).toContain("502")
	})
})

describe("checkRunRead", () => {
	it("passes when the pinned run record is served", async () => {
		const { fetch } = fakeStack({
			"GET /api/demo/v1/run": () => jsonResponse(200, { runId: "demo-f" }),
		})
		expect((await checkRunRead(WEB, fetch)).ok).toBe(true)
	})

	it("fails when no run record is stored", async () => {
		const { fetch } = fakeStack({
			"GET /api/demo/v1/run": () =>
				envelope(404, "RUN_NOT_FOUND", "The pinned run has no stored record."),
		})
		const result = await checkRunRead(WEB, fetch)
		expect(result.ok).toBe(false)
		expect(result.detail).toContain("RUN_NOT_FOUND")
	})
})

describe("checkPublicEnvelope", () => {
	const routes = (): Record<string, () => Response> => ({
		"GET /api/demo/v1/no-such-operation": () =>
			envelope(
				404,
				"UNKNOWN_OPERATION",
				"no demo read operation at /api/demo/v1/no-such-operation",
			),
		"GET /api/demo/v1/wiki?scope=workspace": () =>
			envelope(
				400,
				"UNKNOWN_PARAMETER",
				"scope is set by the server and cannot come from the caller",
			),
		"POST /api/demo/v1/wiki": () =>
			envelope(
				405,
				"METHOD_NOT_ALLOWED",
				"the demo proxy only forwards GET reads",
			),
	})

	it("passes when all three refusals answer the fixed envelope", async () => {
		const { fetch } = fakeStack(routes())
		expect((await checkPublicEnvelope(WEB, fetch)).ok).toBe(true)
	})

	it("fails when one fixed message differs, and names which probe", async () => {
		const mutated = routes()
		mutated["POST /api/demo/v1/wiki"] = () =>
			envelope(405, "METHOD_NOT_ALLOWED", "connect ECONNREFUSED 1.2.3.4:443")
		const result = await checkPublicEnvelope(WEB, fakeStack(mutated).fetch)
		expect(result.ok).toBe(false)
		expect(result.detail).toContain("method")
	})
})

describe("checkPrincipalSelf", () => {
	it("passes for an exact read-only reader of the pinned scope", async () => {
		const { fetch } = fakeStack({
			"GET /v1/principal/self": () => jsonResponse(200, READER_SELF),
		})
		expect((await checkPrincipalSelf(API, KEY, fetch, SCOPE_REF)).ok).toBe(true)
	})

	it("passes for a restricted-tier reader without a pinned expectation", async () => {
		const { fetch } = fakeStack({
			"GET /v1/principal/self": () =>
				jsonResponse(200, { ...READER_SELF, trustTier: "restricted" }),
		})
		expect((await checkPrincipalSelf(API, KEY, fetch)).ok).toBe(true)
	})

	it.each([
		["admin tier", { ...READER_SELF, trustTier: "admin" }],
		["write capability", { ...READER_SELF, capabilities: ["read", "write"] }],
		[
			"two grants",
			{
				...READER_SELF,
				grants: [
					{ scope: "workspace", scopeRef: SCOPE_REF },
					{ scope: "workspace", scopeRef: "demo-run-13" },
				],
			},
		],
		[
			"another scopeRef",
			{
				...READER_SELF,
				grants: [{ scope: "workspace", scopeRef: "demo-run-13" }],
			},
		],
	])("fails for a principal with a %s", async (_label, body) => {
		const { fetch } = fakeStack({
			"GET /v1/principal/self": () => jsonResponse(200, body),
		})
		expect((await checkPrincipalSelf(API, KEY, fetch, SCOPE_REF)).ok).toBe(
			false,
		)
	})

	it("fails on a non-200 answer", async () => {
		const { fetch } = fakeStack({
			"GET /v1/principal/self": () =>
				envelope(401, "UNAUTHORIZED", "unauthorized"),
		})
		expect((await checkPrincipalSelf(API, KEY, fetch)).ok).toBe(false)
	})

	it("sends the key as a bearer and fails without echoing it if the answer leaks it", async () => {
		const { fetch, calls } = fakeStack({
			"GET /v1/principal/self": () =>
				jsonResponse(200, { ...READER_SELF, echoed: KEY }),
		})
		const result = await checkPrincipalSelf(API, KEY, fetch, SCOPE_REF)
		expect(result.ok).toBe(false)
		expect(result.detail).not.toContain(KEY)
		const headers = calls[0]?.init?.headers as Record<string, string>
		expect(headers.authorization).toBe(`Bearer ${KEY}`)
	})
})

describe("checkWriteRefused", () => {
	it("passes when the write is refused with the capability denial", async () => {
		const { fetch, calls } = fakeStack({
			"POST /v1/wiki?scope=workspace&scopeRef=demo-run-12": () =>
				envelope(
					403,
					"FORBIDDEN",
					"capability is not allowed for this API key",
				),
		})
		const result = await checkWriteRefused(API, KEY, SCOPE_REF, fetch)
		expect(result.ok).toBe(true)
		const headers = calls[0]?.init?.headers as Record<string, string>
		expect(headers.authorization).toBe(`Bearer ${KEY}`)
	})

	it("fails when the write is accepted", async () => {
		const { fetch } = fakeStack({
			"POST /v1/wiki?scope=workspace&scopeRef=demo-run-12": () =>
				jsonResponse(200, { slug: "x" }),
		})
		expect((await checkWriteRefused(API, KEY, SCOPE_REF, fetch)).ok).toBe(false)
	})
})

describe("checkOtherScopeRefused", () => {
	it("passes when the other scope is refused, probing demo-run-0", async () => {
		const { fetch, calls } = fakeStack({
			"GET /v1/wiki?scope=workspace&scopeRef=demo-run-0": () =>
				envelope(
					403,
					"FORBIDDEN",
					"scope and scopeRef are not allowed for this API key",
				),
		})
		const result = await checkOtherScopeRefused(API, KEY, fetch)
		expect(result.ok).toBe(true)
		expect(calls[0]?.url).toContain("scopeRef=demo-run-0")
	})

	it("fails when the other scope is served", async () => {
		const { fetch } = fakeStack({
			"GET /v1/wiki?scope=workspace&scopeRef=demo-run-0": () =>
				jsonResponse(200, { pages: [] }),
		})
		expect((await checkOtherScopeRefused(API, KEY, fetch)).ok).toBe(false)
	})
})

describe("checkAnswerGuards", () => {
	const routes = (): Record<string, (init?: RequestInit) => Response> => ({
		"POST /api/demo/answers": (init) => {
			const headers = init?.headers as Record<string, string>
			const contentType = headers["content-type"] ?? ""
			if (!contentType.startsWith("application/json")) {
				return envelope(
					415,
					"ANSWER_UNSUPPORTED_MEDIA",
					"the answer route reads one JSON body: a question as text",
				)
			}
			if (headers["sec-fetch-site"] !== undefined) {
				return envelope(
					403,
					"ANSWER_CROSS_SITE",
					"the answer route only serves its own site",
				)
			}
			return jsonResponse(200, { state: "off" })
		},
	})

	it("passes for the 415, the 403 and the off state", async () => {
		const { fetch } = fakeStack(routes())
		expect((await checkAnswerGuards(WEB, fetch)).ok).toBe(true)
	})

	it("fails when the route is not configured", async () => {
		const mutated = routes()
		mutated["POST /api/demo/answers"] = (init) => {
			const headers = init?.headers as Record<string, string>
			if (
				!headers["sec-fetch-site"] &&
				headers["content-type"]?.startsWith("application/json")
			) {
				return envelope(
					503,
					"ANSWERS_NOT_CONFIGURED",
					"the demo answer service is missing its server configuration",
				)
			}
			return routes()["POST /api/demo/answers"](init)
		}
		const result = await checkAnswerGuards(WEB, fakeStack(mutated).fetch)
		expect(result.ok).toBe(false)
		expect(result.detail).toContain("ANSWERS_NOT_CONFIGURED")
	})

	it("fails when the answer lane is live instead of off", async () => {
		const mutated = routes()
		mutated["POST /api/demo/answers"] = (init) => {
			const headers = init?.headers as Record<string, string>
			if (
				!headers["sec-fetch-site"] &&
				headers["content-type"]?.startsWith("application/json")
			) {
				return jsonResponse(200, { state: "answered", text: "x" })
			}
			return routes()["POST /api/demo/answers"](init)
		}
		const result = await checkAnswerGuards(WEB, fakeStack(mutated).fetch)
		expect(result.ok).toBe(false)
		expect(result.detail).toContain("off")
	})
})

describe("checkEdgeRateLimit", () => {
	it("passes when the edge answers 429 past the limit", async () => {
		let seen = 0
		const { fetch } = fakeStack({
			"GET /api/demo/v1/no-such-operation": () => {
				seen += 1
				return seen > 5
					? jsonResponse(429, { blocked: true })
					: envelope(
							404,
							"UNKNOWN_OPERATION",
							"no demo read operation at /api/demo/v1/no-such-operation",
						)
			},
		})
		const result = await checkEdgeRateLimit(WEB, fetch, {
			name: "v1 reads rate limit",
			path: "/api/demo/v1/no-such-operation",
			method: "GET",
			limit: 5,
			headroom: 10,
		})
		expect(result.ok).toBe(true)
		expect(result.detail).toContain("6")
	})

	it("fails when no 429 arrives within the headroom", async () => {
		const { fetch } = fakeStack({
			"GET /api/demo/v1/no-such-operation": () =>
				envelope(
					404,
					"UNKNOWN_OPERATION",
					"no demo read operation at /api/demo/v1/no-such-operation",
				),
		})
		const result = await checkEdgeRateLimit(WEB, fetch, {
			name: "v1 reads rate limit",
			path: "/api/demo/v1/no-such-operation",
			method: "GET",
			limit: 3,
			headroom: 4,
		})
		expect(result.ok).toBe(false)
		expect(result.detail).toContain("404")
	})

	it("passes for the answers probe with a text/plain body", async () => {
		let seen = 0
		const { fetch } = fakeStack({
			"POST /api/demo/answers": () => {
				seen += 1
				return seen > 2
					? jsonResponse(429, { blocked: true })
					: envelope(
							415,
							"ANSWER_UNSUPPORTED_MEDIA",
							"the answer route reads one JSON body: a question as text",
						)
			},
		})
		const result = await checkEdgeRateLimit(WEB, fetch, {
			name: "answers rate limit",
			path: "/api/demo/answers",
			method: "POST",
			contentType: "text/plain",
			body: "question",
			limit: 2,
			headroom: 6,
		})
		expect(result.ok).toBe(true)
		expect(seen).toBe(3)
	})
})

describe("runDeploySmoke", () => {
	const goodRoutes = (): Record<string, (init?: RequestInit) => Response> => ({
		"GET /api/demo/v1/wiki": () => jsonResponse(200, { pages: [] }),
		"GET /api/demo/v1/run": () => jsonResponse(200, { runId: "demo-f" }),
		"GET /api/demo/v1/no-such-operation": () =>
			envelope(
				404,
				"UNKNOWN_OPERATION",
				"no demo read operation at /api/demo/v1/no-such-operation",
			),
		"GET /api/demo/v1/wiki?scope=workspace": () =>
			envelope(
				400,
				"UNKNOWN_PARAMETER",
				"scope is set by the server and cannot come from the caller",
			),
		"POST /api/demo/v1/wiki": () =>
			envelope(
				405,
				"METHOD_NOT_ALLOWED",
				"the demo proxy only forwards GET reads",
			),
		"GET /v1/principal/self": () => jsonResponse(200, READER_SELF),
		"POST /v1/wiki?scope=workspace&scopeRef=demo-run-12": () =>
			envelope(403, "FORBIDDEN", "capability is not allowed for this API key"),
		"GET /v1/wiki?scope=workspace&scopeRef=demo-run-0": () =>
			envelope(
				403,
				"FORBIDDEN",
				"scope and scopeRef are not allowed for this API key",
			),
		"POST /api/demo/answers": (init) => {
			const headers = init?.headers as Record<string, string>
			if (!headers["content-type"]?.startsWith("application/json")) {
				return envelope(
					415,
					"ANSWER_UNSUPPORTED_MEDIA",
					"the answer route reads one JSON body: a question as text",
				)
			}
			if (headers["sec-fetch-site"] !== undefined) {
				return envelope(
					403,
					"ANSWER_CROSS_SITE",
					"the answer route only serves its own site",
				)
			}
			return jsonResponse(200, { state: "off" })
		},
	})

	it("runs every check in order and all pass", async () => {
		const routes = goodRoutes()
		let v1Seen = 0
		let answersSeen = 0
		routes["GET /api/demo/v1/no-such-operation"] = () => {
			v1Seen += 1
			return v1Seen > 2
				? jsonResponse(429, {})
				: envelope(
						404,
						"UNKNOWN_OPERATION",
						"no demo read operation at /api/demo/v1/no-such-operation",
					)
		}
		const base = routes["POST /api/demo/answers"]
		routes["POST /api/demo/answers"] = (init) => {
			const headers = init?.headers as Record<string, string>
			if (!headers["content-type"]?.startsWith("application/json")) {
				answersSeen += 1
				if (answersSeen > 1) return jsonResponse(429, {})
			}
			return base(init)
		}
		const results = await runDeploySmoke(
			{
				web: WEB,
				api: API,
				readKey: KEY,
				scopeRef: SCOPE_REF,
				v1Limit: 2,
				answersLimit: 1,
				skipRate: false,
			},
			fakeStack(routes).fetch,
		)
		expect(results.map((r) => r.name)).toEqual([
			"pinned-scope read",
			"run record read",
			"public error envelope",
			"read-key gate",
			"write refused",
			"other scope refused",
			"answer route guards",
			"answers rate limit",
			"v1 reads rate limit",
		])
		expect(results.every((r) => r.ok)).toBe(true)
	})

	it("skips the rate checks with skipRate and reports a failing check", async () => {
		const routes = goodRoutes()
		routes["GET /v1/principal/self"] = () =>
			jsonResponse(200, { ...READER_SELF, trustTier: "admin" })
		const results = await runDeploySmoke(
			{
				web: WEB,
				api: API,
				readKey: KEY,
				scopeRef: SCOPE_REF,
				v1Limit: 2,
				answersLimit: 1,
				skipRate: true,
			},
			fakeStack(routes).fetch,
		)
		expect(results.map((r) => r.name)).not.toContain("answers rate limit")
		expect(results.map((r) => r.name)).not.toContain("v1 reads rate limit")
		const gate = results.find((r) => r.name === "read-key gate")
		expect(gate?.ok).toBe(false)
		expect(JSON.stringify(results)).not.toContain(KEY)
	})
})
