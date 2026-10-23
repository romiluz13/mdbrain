import { describe, expect, it } from "vitest"
import { createAdminKeyCheck } from "./admin-key.js"

const target = { apiBaseUrl: "http://api.test", adminKey: "review-key" }

function upstream(answer: () => Response | Promise<Response>) {
	const calls: Array<{ url: URL; authorization: string | null }> = []
	const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({
			url: new URL(input instanceof Request ? input.url : String(input)),
			authorization: new Headers(init?.headers).get("authorization"),
		})
		return answer()
	}) as typeof fetch
	return { fetch: impl, calls }
}
const principal = (capabilities: unknown) =>
	new Response(
		JSON.stringify({
			subjectId: "review",
			trustTier: "admin",
			capabilities,
			grants: [],
		}),
		{ headers: { "content-type": "application/json" } },
	)

describe("the presenter key check", () => {
	it("accepts a key whose capabilities are exactly administer, asking with that key", async () => {
		const api = upstream(() => principal(["administer"]))
		expect(await createAdminKeyCheck()(target, api.fetch)).toBe(true)
		expect(api.calls).toEqual([
			{
				url: new URL("http://api.test/v1/principal/self"),
				authorization: "Bearer review-key",
			},
		])
	})

	it.each([
		["the whole admin set", ["read", "write", "administer"]],
		["administer with read", ["read", "administer"]],
		["administer with write", ["administer", "write"]],
		["read only", ["read"]],
		["none", []],
		["a string", "administer"],
		["missing", undefined],
	])("refuses a key with %s", async (_name, capabilities) => {
		const api = upstream(() => principal(capabilities))
		expect(await createAdminKeyCheck()(target, api.fetch)).toBe(false)
	})

	it("refuses an answer that is not a principal", async () => {
		const api = upstream(() => new Response('"administer"'))
		expect(await createAdminKeyCheck()(target, api.fetch)).toBe(false)
	})

	it("asks once for a settled verdict, and again after a check that could not finish", async () => {
		const check = createAdminKeyCheck()
		let reachable = false
		const api = upstream(() =>
			reachable
				? principal(["administer"])
				: Promise.reject(new Error("socket hang up")),
		)
		expect(await check(target, api.fetch)).toBe(false)
		reachable = true
		expect(await check(target, api.fetch)).toBe(true)
		expect(await check(target, api.fetch)).toBe(true)
		expect(api.calls).toHaveLength(2)
	})

	it("treats an unauthorized answer as not a pass and asks again next time", async () => {
		const check = createAdminKeyCheck()
		const api = upstream(() => new Response("{}", { status: 401 }))
		expect(await check(target, api.fetch)).toBe(false)
		expect(await check(target, api.fetch)).toBe(false)
		expect(api.calls).toHaveLength(2)
	})

	it("gives up on an API that does not answer in time", async () => {
		const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(init.signal?.reason),
				)
			})) as typeof fetch
		expect(await createAdminKeyCheck({ timeoutMs: 20 })(target, hanging)).toBe(
			false,
		)
	})
})
