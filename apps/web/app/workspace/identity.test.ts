import { describe, expect, it } from "vitest"
import { validateDraft } from "./identity.js"

const valid = {
	baseUrl: "http://127.0.0.1:3847/",
	apiKey: "  key  ",
	agentId: " agent-a ",
	scope: "workspace",
	scopeRef: " ref-a ",
}

describe("validateDraft", () => {
	it("trims fields, strips the trailing slash and keeps the connection id", () => {
		const result = validateDraft(valid, 7)
		expect(result).toEqual({
			ok: true,
			connection: {
				id: 7,
				baseUrl: "http://127.0.0.1:3847",
				apiKey: "key",
				agentId: "agent-a",
				scope: "workspace",
				scopeRef: "ref-a",
			},
		})
	})

	it("requires both halves of the scope tuple", () => {
		const result = validateDraft({ ...valid, scopeRef: " " }, 1)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(Object.keys(result.errors)).toEqual(["scopeRef"])
		}
		const noScope = validateDraft({ ...valid, scope: "" }, 1)
		expect(noScope.ok).toBe(false)
		if (!noScope.ok) {
			expect(noScope.errors.scope).toBeTruthy()
		}
	})

	it("rejects unknown scopes, non-http URLs and embedded credentials", () => {
		for (const draft of [
			{ ...valid, scope: "galaxy" },
			{ ...valid, baseUrl: "ftp://example.com" },
			{ ...valid, baseUrl: "javascript:alert(1)" },
			{ ...valid, baseUrl: "not a url" },
			{ ...valid, baseUrl: "https://user:pw@example.com" },
			{ ...valid, baseUrl: "" },
			{ ...valid, agentId: "" },
		]) {
			expect(validateDraft(draft, 1).ok).toBe(false)
		}
	})

	it("accepts an empty key for keyless local stacks", () => {
		expect(validateDraft({ ...valid, apiKey: "" }, 1).ok).toBe(true)
	})

	it("requires https for remote servers and allows http only on exact loopback hosts", () => {
		for (const baseUrl of [
			"https://api.example.com",
			"https://localhost:3847",
			"http://localhost:3847",
			"http://127.0.0.1:3847",
			"http://[::1]:3847",
		]) {
			expect(validateDraft({ ...valid, baseUrl }, 1).ok).toBe(true)
		}
		for (const baseUrl of [
			"http://api.example.com",
			"http://localhost.example.test:3847",
			"http://127.0.0.1.example.test",
			"http://evil-localhost",
			"http://10.0.0.5:3847",
		]) {
			const result = validateDraft({ ...valid, baseUrl }, 1)
			expect(result.ok).toBe(false)
			if (!result.ok) {
				expect(result.errors.baseUrl).toContain("https")
			}
		}
	})
})
