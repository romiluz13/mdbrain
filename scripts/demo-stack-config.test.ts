import { describe, expect, it } from "vitest"
import { parseScopedApiKeyPolicies } from "../apps/api/src/principal.js"
import {
	DEMO_DATABASES,
	assertDemoDatabase,
	buildDemoStackEnv,
	parseSecretsFile,
} from "./demo-stack-config.js"

const secrets = {
	DEMO_ATLAS_URI: "mongodb+srv://user:pass@demo.example.net/",
	VOYAGE_API_KEY: "al-test",
	MDBRAIN_DEMO_API_KEY: "demo-local-api",
	MEMONGO_DEMO_API_KEY: "demo-local-memongo",
}

describe("demo databases", () => {
	it("are exactly the three demo databases", () => {
		expect(DEMO_DATABASES).toEqual([
			"mdbrain_demo_wiki",
			"mdbrain_demo_memory",
			"mdbrain_demo_control",
		])
	})

	it("refuses any other database name", () => {
		expect(() => assertDemoDatabase("mdbrain_wiki")).toThrow(
			/not a demo database/,
		)
		expect(() => assertDemoDatabase("admin")).toThrow(/not a demo database/)
		expect(() => assertDemoDatabase("mdbrain_demo_memory")).not.toThrow()
	})
})

describe("parseSecretsFile", () => {
	it("reads KEY=VALUE lines and skips comments and blanks", () => {
		expect(parseSecretsFile("# note\nA=1\n\nB=x=y\n  C = spaced \n")).toEqual({
			A: "1",
			B: "x=y",
			C: "spaced",
		})
	})
})

describe("buildDemoStackEnv", () => {
	const stackDir = "/tmp/demo-stack"
	const env = buildDemoStackEnv(secrets, { stackDir })

	it("points Memongo only at the demo memory database and ignores home config", () => {
		expect(env.memongo.MEMONGO_FORCE_MONGODB_URI).toBe(secrets.DEMO_ATLAS_URI)
		expect(env.memongo.MEMONGO_MONGODB_DATABASE).toBe("mdbrain_demo_memory")
		expect(env.memongo.HOME).toBe("/tmp/demo-stack/home")
		expect(env.memongo.MEMONGO_WORKSPACE_DIR).toBe(
			"/tmp/demo-stack/memongo-workspace",
		)
		expect(env.memongo.MEMONGO_API_KEY).toBe("demo-local-memongo")
		expect(env.memongo.MEMONGO_API_PORT).toBe("3858")
		expect(env.memongo.MEMONGO_API_HOST).toBe("127.0.0.1")
	})

	it("points the API only at the demo wiki database and the local Memongo", () => {
		expect(env.api.MDBRAIN_WIKI_MONGODB_URI).toBe(secrets.DEMO_ATLAS_URI)
		expect(env.api.MDBRAIN_WIKI_DATABASE).toBe("mdbrain_demo_wiki")
		expect(env.api.MEMONGO_API_URL).toBe("http://127.0.0.1:3858")
		expect(env.api.MEMONGO_API_KEY).toBe("demo-local-memongo")
		expect(env.api.MEMONGO_ALLOW_INSECURE_LOCAL).toBe("1")
		expect(env.api.MDBRAIN_API_KEY).toBe("demo-local-api")
		expect(env.api.MDBRAIN_API_PORT).toBe("3857")
		expect(env.api.HOME).toBe("/tmp/demo-stack/home")
		expect(env.api.MDBRAIN_CONFIG_PATH).toBe(
			"/tmp/demo-stack/home/.mdbrain/mdbrain.json",
		)
	})

	it("never inherits a Mongo URI from the parent environment", () => {
		const leaked = buildDemoStackEnv(secrets, {
			stackDir,
			parentEnv: {
				PATH: "/usr/bin",
				MDBRAIN_MONGODB_URI: "mongodb://elsewhere",
				MEMONGO_MONGODB_URI: "mongodb://elsewhere",
				MDBRAIN_WIKI_DATABASE: "mdbrain_wiki",
			},
		})
		expect(leaked.api.MDBRAIN_MONGODB_URI).toBeUndefined()
		expect(leaked.memongo.MEMONGO_MONGODB_URI).toBeUndefined()
		expect(leaked.api.MDBRAIN_WIKI_DATABASE).toBe("mdbrain_demo_wiki")
		expect(leaked.api.PATH).toBe("/usr/bin")
	})

	it("requires every secret it uses", () => {
		const { MEMONGO_DEMO_API_KEY: _omitted, ...missing } = secrets
		expect(() => buildDemoStackEnv(missing, { stackDir })).toThrow(
			/MEMONGO_DEMO_API_KEY/,
		)
	})
})
describe("demo run slots", () => {
	const stackDir = "/tmp/demo-stack"
	const slotSecrets = {
		...secrets,
		MDBRAIN_DEMO_SLOT_KEYS: '["slot-token-one", "slot-token-two"]',
		MDBRAIN_DEMO_API_RATE_LIMIT: "600",
	}

	it("grants each slot key exactly one workspace scopeRef pair", () => {
		const env = buildDemoStackEnv(slotSecrets, { stackDir })
		const policies = JSON.parse(env.api.MDBRAIN_API_SCOPED_KEYS ?? "")
		expect(policies).toEqual({
			"slot-token-one": {
				grants: [{ scope: "workspace", scopeRef: "demo-run-1" }],
			},
			"slot-token-two": {
				grants: [{ scope: "workspace", scopeRef: "demo-run-2" }],
			},
		})
	})

	it("raises the per-IP rate limit when configured", () => {
		const env = buildDemoStackEnv(slotSecrets, { stackDir })
		expect(env.api.MDBRAIN_API_RATE_LIMIT_MAX).toBe("600")
	})

	it("omits scoped keys and the rate limit when not configured", () => {
		const env = buildDemoStackEnv(secrets, { stackDir })
		expect(env.api.MDBRAIN_API_SCOPED_KEYS).toBeUndefined()
		expect(env.api.MDBRAIN_API_RATE_LIMIT_MAX).toBeUndefined()
	})

	it("rejects malformed, empty, or duplicate slot keys", () => {
		const bad = (value: string) =>
			buildDemoStackEnv(
				{ ...secrets, MDBRAIN_DEMO_SLOT_KEYS: value },
				{ stackDir },
			)
		expect(() => bad("not-json")).toThrow(/MDBRAIN_DEMO_SLOT_KEYS/)
		expect(() => bad("[]")).toThrow(/MDBRAIN_DEMO_SLOT_KEYS/)
		expect(() => bad('["ok", "ok"]')).toThrow(/MDBRAIN_DEMO_SLOT_KEYS/)
		expect(() => bad('["ok", 42]')).toThrow(/MDBRAIN_DEMO_SLOT_KEYS/)
	})

	it("rejects a non-integer or negative rate limit", () => {
		const bad = (value: string) =>
			buildDemoStackEnv(
				{ ...secrets, MDBRAIN_DEMO_API_RATE_LIMIT: value },
				{ stackDir },
			)
		expect(() => bad("many")).toThrow(/MDBRAIN_DEMO_API_RATE_LIMIT/)
		expect(() => bad("1.5")).toThrow(/MDBRAIN_DEMO_API_RATE_LIMIT/)
		expect(() => bad("-1")).toThrow(/MDBRAIN_DEMO_API_RATE_LIMIT/)
	})
})

describe("demo proposers", () => {
	const stackDir = "/tmp/demo-stack"
	const withProposers = {
		...secrets,
		MDBRAIN_DEMO_PROPOSER_KEYS: '["proposer-token-one", "proposer-token-two"]',
	}
	const policiesOf = (all: Record<string, string>) =>
		JSON.parse(
			buildDemoStackEnv(all, { stackDir }).api.MDBRAIN_API_SCOPED_KEYS ?? "",
		)

	it("gives proposer i propose-only access to slot i's scopeRef and nothing else", () => {
		expect(policiesOf(withProposers)).toEqual({
			"proposer-token-one": {
				subjectId: "demo-proposer-1",
				displayName: "Demo proposer 1",
				grants: [{ scope: "workspace", scopeRef: "demo-run-1" }],
				capabilities: ["read", "propose"],
			},
			"proposer-token-two": {
				subjectId: "demo-proposer-2",
				displayName: "Demo proposer 2",
				grants: [{ scope: "workspace", scopeRef: "demo-run-2" }],
				capabilities: ["read", "propose"],
			},
		})
	})

	it("produces keys the API accepts as proposal-only principals", () => {
		const credentials = parseScopedApiKeyPolicies(
			buildDemoStackEnv(withProposers, { stackDir }).api
				.MDBRAIN_API_SCOPED_KEYS,
		)

		expect(credentials.map((c) => c.principal.subjectId)).toEqual([
			"demo-proposer-1",
			"demo-proposer-2",
		])
		for (const credential of credentials) {
			expect(credential.principal.capabilities).toEqual(["read", "propose"])
			expect(credential.principal.trustTier).toBe("standard")
		}
		expect(credentials[1]?.principal.allowedScopes).toEqual([
			{ scope: "workspace", scopeRef: "demo-run-2" },
		])
	})

	it("sits beside the slot keys without changing them", () => {
		const both = policiesOf({
			...withProposers,
			MDBRAIN_DEMO_SLOT_KEYS: '["slot-token-one", "slot-token-two"]',
		})

		expect(Object.keys(both)).toEqual([
			"slot-token-one",
			"slot-token-two",
			"proposer-token-one",
			"proposer-token-two",
		])
		expect(both["slot-token-one"]).toEqual({
			grants: [{ scope: "workspace", scopeRef: "demo-run-1" }],
		})
	})

	it("adds no scoped keys when none are configured", () => {
		expect(
			buildDemoStackEnv(secrets, { stackDir }).api.MDBRAIN_API_SCOPED_KEYS,
		).toBeUndefined()
	})

	it("rejects malformed, empty or duplicate proposer keys", () => {
		const bad = (value: string) =>
			buildDemoStackEnv(
				{ ...secrets, MDBRAIN_DEMO_PROPOSER_KEYS: value },
				{ stackDir },
			)
		expect(() => bad("not-json")).toThrow(/MDBRAIN_DEMO_PROPOSER_KEYS/)
		expect(() => bad("[]")).toThrow(/MDBRAIN_DEMO_PROPOSER_KEYS/)
		expect(() => bad('["ok", "ok"]')).toThrow(/MDBRAIN_DEMO_PROPOSER_KEYS/)
		expect(() => bad('["ok", 42]')).toThrow(/MDBRAIN_DEMO_PROPOSER_KEYS/)
	})

	it("refuses a token that is also a slot key or the admin key", () => {
		const clash = (token: string) =>
			buildDemoStackEnv(
				{
					...secrets,
					MDBRAIN_DEMO_SLOT_KEYS: '["slot-token-one"]',
					MDBRAIN_DEMO_PROPOSER_KEYS: JSON.stringify([token]),
				},
				{ stackDir },
			)
		expect(() => clash("slot-token-one")).toThrow(
			/MDBRAIN_DEMO_PROPOSER_KEYS.*slot/,
		)
		expect(() => clash("demo-local-api")).toThrow(
			/MDBRAIN_DEMO_PROPOSER_KEYS.*admin/,
		)
	})
})

describe("demo role agents", () => {
	const stackDir = "/tmp/demo-stack"
	const base = {
		...secrets,
		MDBRAIN_DEMO_SLOT_KEYS: '["slot-token-one", "slot-token-two"]',
		MDBRAIN_DEMO_PROPOSER_KEYS: '["proposer-token-one", "proposer-token-two"]',
	}
	const withAgents = {
		...base,
		MDBRAIN_DEMO_AGENT_KEYS: JSON.stringify([
			["agent-support-one", "agent-account-one"],
			["agent-support-two", "agent-account-two"],
		]),
	}
	const policiesOf = (all: Record<string, string>) =>
		JSON.parse(
			buildDemoStackEnv(all, { stackDir }).api.MDBRAIN_API_SCOPED_KEYS ?? "",
		)

	it("pins each role key to the run agentId and exactly one slot scope", () => {
		const policies = policiesOf(withAgents)
		expect(Object.keys(policies)).toEqual([
			"slot-token-one",
			"slot-token-two",
			"proposer-token-one",
			"proposer-token-two",
			"agent-support-one",
			"agent-account-one",
			"agent-support-two",
			"agent-account-two",
		])
		expect(policies["agent-support-one"]).toEqual({
			subjectId: "demo-agent-support-1",
			displayName: "Demo support agent 1",
			grants: [{ scope: "workspace", scopeRef: "demo-run-1" }],
			agentIds: ["demo-run-1"],
		})
		expect(policies["agent-account-two"]).toEqual({
			subjectId: "demo-agent-account-2",
			displayName: "Demo account agent 2",
			grants: [{ scope: "workspace", scopeRef: "demo-run-2" }],
			agentIds: ["demo-run-2"],
		})
	})

	it("produces principals the API pins to one agentId with read+write", () => {
		const credentials = parseScopedApiKeyPolicies(
			buildDemoStackEnv(withAgents, { stackDir }).api.MDBRAIN_API_SCOPED_KEYS,
		)
		const support = credentials.find(
			(credential) => credential.principal.subjectId === "demo-agent-support-1",
		)
		expect(support?.principal.allowedAgentIds).toEqual(["demo-run-1"])
		expect(support?.principal.allowedScopes).toEqual([
			{ scope: "workspace", scopeRef: "demo-run-1" },
		])
		expect(support?.principal.capabilities).toEqual(["read", "write"])
	})

	it("adds nothing when no agent keys are configured", () => {
		const policies = policiesOf(base)
		expect(Object.keys(policies)).toHaveLength(4)
	})

	it("rejects malformed, empty or duplicate pairs", () => {
		const bad = (value: string) =>
			buildDemoStackEnv(
				{ ...base, MDBRAIN_DEMO_AGENT_KEYS: value },
				{ stackDir },
			)
		expect(() => bad("not-json")).toThrow(/MDBRAIN_DEMO_AGENT_KEYS/)
		expect(() => bad("[]")).toThrow(/MDBRAIN_DEMO_AGENT_KEYS/)
		expect(() => bad('["a"]')).toThrow(/MDBRAIN_DEMO_AGENT_KEYS/)
		expect(() => bad('[["a"]]')).toThrow(/MDBRAIN_DEMO_AGENT_KEYS/)
		expect(() => bad('[["a", "b", "c"]]')).toThrow(/MDBRAIN_DEMO_AGENT_KEYS/)
		expect(() => bad('[["a", "a"]]')).toThrow(/MDBRAIN_DEMO_AGENT_KEYS/)
		expect(() => bad('[["a", "b"], ["c", "b"]]')).toThrow(
			/MDBRAIN_DEMO_AGENT_KEYS/,
		)
		expect(() => bad('[["a", 1]]')).toThrow(/MDBRAIN_DEMO_AGENT_KEYS/)
	})

	it("requires one pair per slot and the proposer list", () => {
		const short = {
			...base,
			MDBRAIN_DEMO_AGENT_KEYS: JSON.stringify([
				["agent-support-one", "agent-account-one"],
			]),
		}
		expect(() => buildDemoStackEnv(short, { stackDir })).toThrow(
			/MDBRAIN_DEMO_AGENT_KEYS.*pair per slot/,
		)
		const noProposers = {
			...secrets,
			MDBRAIN_DEMO_SLOT_KEYS: '["slot-token-one"]',
			MDBRAIN_DEMO_AGENT_KEYS: JSON.stringify([
				["agent-support-one", "agent-account-one"],
			]),
		}
		expect(() => buildDemoStackEnv(noProposers, { stackDir })).toThrow(
			/MDBRAIN_DEMO_PROPOSER_KEYS/,
		)
		const noSlots = {
			...secrets,
			MDBRAIN_DEMO_PROPOSER_KEYS: '["proposer-token-one"]',
			MDBRAIN_DEMO_AGENT_KEYS: JSON.stringify([
				["agent-support-one", "agent-account-one"],
			]),
		}
		expect(() => buildDemoStackEnv(noSlots, { stackDir })).toThrow(
			/MDBRAIN_DEMO_SLOT_KEYS/,
		)
	})

	it("refuses a role key that is also a slot, proposer or admin key", () => {
		const clash = (support: string, account: string) =>
			buildDemoStackEnv(
				{
					...secrets,
					MDBRAIN_DEMO_SLOT_KEYS: '["slot-token-one"]',
					MDBRAIN_DEMO_PROPOSER_KEYS: '["proposer-token-one"]',
					MDBRAIN_DEMO_AGENT_KEYS: JSON.stringify([[support, account]]),
				},
				{ stackDir },
			)
		expect(() => clash("slot-token-one", "agent-account-one")).toThrow(
			/MDBRAIN_DEMO_AGENT_KEYS.*slot/,
		)
		expect(() => clash("agent-support-one", "proposer-token-one")).toThrow(
			/MDBRAIN_DEMO_AGENT_KEYS.*proposer/,
		)
		expect(() => clash("demo-local-api", "agent-account-one")).toThrow(
			/MDBRAIN_DEMO_AGENT_KEYS.*admin/,
		)
	})
})
