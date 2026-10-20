import { describe, expect, it } from "vitest"
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
