import { describe, expect, it } from "vitest"
import type { DemoProxyEnv } from "./proxy.js"
import { createReadKeyCheck } from "./proxy-principal.js"
import { json } from "./test-upstream.js"

const env: DemoProxyEnv = {
	apiBaseUrl: "http://127.0.0.1:3857",
	readKey: "test-read-key-123",
	scope: "workspace",
	scopeRef: "demo-run-2",
	agentId: "demo-run-2",
}

const reader = {
	subjectId: "demo-reader-2",
	trustTier: "standard",
	capabilities: ["read"],
	grants: [{ scope: "workspace", scopeRef: "demo-run-2" }],
}

type Call = { url: URL; headers: Headers }

function upstream(answer: () => Response | Promise<Response>): {
	fetch: typeof fetch
	calls: Call[]
} {
	const calls: Call[] = []
	const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({
			url: new URL(input instanceof Request ? input.url : String(input)),
			headers: new Headers(init?.headers),
		})
		return answer()
	}
	return { fetch: impl as typeof fetch, calls }
}

describe("the read key check", () => {
	it("accepts a key that reads exactly the configured scope and nothing else, asking with that key", async () => {
		const api = upstream(() => json(reader))
		expect(await createReadKeyCheck()(env, api.fetch)).toBe(true)
		expect(api.calls).toHaveLength(1)
		expect(api.calls[0].url.href).toBe(
			"http://127.0.0.1:3857/v1/principal/self",
		)
		expect(api.calls[0].headers.get("authorization")).toBe(
			"Bearer test-read-key-123",
		)
	})

	it.each([
		[
			"the admin key",
			{
				subjectId: "api-key:admin",
				trustTier: "admin",
				capabilities: ["read", "write", "administer"],
				grants: [{ scope: "*", scopeRef: "*" }],
			},
		],
		["the development principal", { ...reader, trustTier: "development" }],
		["an admin-tier reader", { ...reader, trustTier: "admin" }],
		["a tier it does not know", { ...reader, trustTier: "superuser" }],
		[
			"a slot key that can write",
			{ ...reader, capabilities: ["read", "write"] },
		],
		["a proposer", { ...reader, capabilities: ["propose"] }],
		["a key with no capability", { ...reader, capabilities: [] }],
		[
			"a key holding two grants",
			{
				...reader,
				grants: [
					{ scope: "workspace", scopeRef: "demo-run-2" },
					{ scope: "workspace", scopeRef: "demo-run-3" },
				],
			},
		],
		[
			"a key for another run",
			{ ...reader, grants: [{ scope: "workspace", scopeRef: "demo-run-3" }] },
		],
		[
			"a key for another scope",
			{ ...reader, grants: [{ scope: "tenant", scopeRef: "demo-run-2" }] },
		],
		[
			"a key with a wildcard scopeRef",
			{ ...reader, grants: [{ scope: "workspace", scopeRef: "*" }] },
		],
		["a key with no grant", { ...reader, grants: [] }],
		["an answer that is not a principal", { ok: true }],
		["an answer that is not an object", ["read"]],
	])("refuses %s", async (_label, principal) => {
		const api = upstream(() => json(principal))
		expect(await createReadKeyCheck()(env, api.fetch)).toBe(false)
	})

	it.each([
		[
			"the API refuses the key",
			() => json({ error: { code: "UNAUTHORIZED" } }, 401),
		],
		[
			"the API has no such route",
			() => json({ error: { code: "NOT_FOUND" } }, 404),
		],
		[
			"the answer is not JSON",
			() => new Response("<html>gateway</html>", { status: 200 }),
		],
		[
			"the API cannot be reached",
			() => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.7:3857")),
		],
	])("refuses when %s", async (_label, answer) => {
		const api = upstream(answer)
		expect(await createReadKeyCheck()(env, api.fetch)).toBe(false)
	})

	it("asks once per process for a settled verdict", async () => {
		const check = createReadKeyCheck()
		const accepted = upstream(() => json(reader))
		expect(await check(env, accepted.fetch)).toBe(true)
		expect(await check(env, accepted.fetch)).toBe(true)
		expect(accepted.calls).toHaveLength(1)

		const refusing = createReadKeyCheck()
		const admin = upstream(() => json({ ...reader, trustTier: "admin" }))
		expect(await refusing(env, admin.fetch)).toBe(false)
		expect(await refusing(env, admin.fetch)).toBe(false)
		expect(admin.calls).toHaveLength(1)
	})

	it("asks again after a check that could not finish, and never counts it as a pass", async () => {
		const check = createReadKeyCheck()
		let reachable = false
		const api = upstream(() =>
			reachable ? json(reader) : Promise.reject(new Error("socket hang up")),
		)
		expect(await check(env, api.fetch)).toBe(false)
		expect(await check(env, api.fetch)).toBe(false)
		reachable = true
		expect(await check(env, api.fetch)).toBe(true)
		expect(api.calls).toHaveLength(3)
	})

	it("does not reuse a verdict for a different key or scope", async () => {
		const check = createReadKeyCheck()
		const api = upstream(() => json(reader))
		expect(await check(env, api.fetch)).toBe(true)
		expect(await check({ ...env, readKey: "admin-secret" }, api.fetch)).toBe(
			true,
		)
		expect(await check({ ...env, scopeRef: "demo-run-3" }, api.fetch)).toBe(
			false,
		)
		expect(api.calls).toHaveLength(3)
		expect(api.calls[1].headers.get("authorization")).toBe(
			"Bearer admin-secret",
		)
	})
})
