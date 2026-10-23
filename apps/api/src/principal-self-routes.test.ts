// GET /v1/principal/self — a key reads its own authority, and nothing else.
//
// The /demo read proxy asks this before it serves anonymous visitors, so a key
// with more than one exact read grant is refused there. These tests pin what
// the route shows and to whom.

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createApp } from "./app.js"

const prevEnv = { ...process.env }

const READER = {
	token: "reader-secret-2",
	subjectId: "demo-reader-2",
	grants: [{ scope: "workspace", scopeRef: "demo-run-2" }],
	capabilities: ["read"],
}
const SLOT = {
	token: "slot-secret-2",
	subjectId: "demo-slot-2",
	grants: [{ scope: "workspace", scopeRef: "demo-run-2" }],
	agentIds: ["demo-run-2"],
}

beforeEach(() => {
	process.env = { ...prevEnv }
	delete process.env.MDBRAIN_ALLOW_DEV_PRINCIPAL
	process.env.MDBRAIN_API_KEY = "admin-secret"
	process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([READER, SLOT])
})

afterEach(() => {
	process.env = { ...prevEnv }
})

const getSelf = (headers: Record<string, string> = {}, query = "") =>
	createApp().request(`/v1/principal/self${query}`, { headers })

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

describe("GET /v1/principal/self", () => {
	it("shows a read-only scoped key its own capabilities, its one exact grant and its tier, without a scope on the request", async () => {
		const res = await getSelf(bearer(READER.token))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			subjectId: "demo-reader-2",
			trustTier: "standard",
			capabilities: ["read"],
			grants: [{ scope: "workspace", scopeRef: "demo-run-2" }],
		})
	})

	it("shows the admin key its own full authority", async () => {
		const res = await getSelf(bearer("admin-secret"))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			subjectId: "api-key:admin",
			trustTier: "admin",
			capabilities: [
				"read",
				"write",
				"write-trusted",
				"administer",
				"change-permissions",
				"hard-delete",
				"export",
				"manage-connectors",
				"propose",
			],
			grants: [{ scope: "*", scopeRef: "*" }],
		})
	})

	it("refuses a request with no key or an unknown key", async () => {
		for (const headers of [{}, bearer("not-a-key")]) {
			const res = await getSelf(headers)
			expect(res.status).toBe(401)
			expect(await res.json()).toEqual({
				error: { code: "UNAUTHORIZED", message: "unauthorized" },
			})
		}
	})

	it("needs no agentId and no capability: an agent-pinned key without read sees itself", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "proposer-secret",
				subjectId: "demo-proposer-2",
				grants: [{ scope: "workspace", scopeRef: "demo-run-2" }],
				agentIds: ["demo-run-2"],
				capabilities: ["propose"],
			},
		])
		const res = await getSelf(bearer("proposer-secret"))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			subjectId: "demo-proposer-2",
			trustTier: "standard",
			capabilities: ["propose"],
			grants: [{ scope: "workspace", scopeRef: "demo-run-2" }],
		})
	})

	it("answers about the caller only, whatever scope the request names, and shows no token", async () => {
		const res = await getSelf(
			bearer(READER.token),
			"?scope=workspace&scopeRef=demo-run-9&agentId=demo-run-2",
		)
		expect(res.status).toBe(200)
		const text = await res.text()
		expect(JSON.parse(text)).toEqual({
			subjectId: "demo-reader-2",
			trustTier: "standard",
			capabilities: ["read"],
			grants: [{ scope: "workspace", scopeRef: "demo-run-2" }],
		})
		for (const secret of [READER.token, SLOT.token, "admin-secret"]) {
			expect(text).not.toContain(secret)
		}
		expect(text).not.toContain(SLOT.subjectId)
	})

	it("refuses a key whose identity is no longer active", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{ ...READER, active: false },
		])
		const res = await getSelf(bearer(READER.token))
		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({
			error: { code: "FORBIDDEN", message: "identity is not active" },
		})
	})

	it("keeps the scope check for any other method on the same path", async () => {
		const res = await createApp().request("/v1/principal/self", {
			method: "POST",
			headers: bearer(READER.token),
		})
		expect(res.status).toBe(403)
	})
})
