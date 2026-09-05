import { describe, expect, it } from "vitest"
import { MemongoHttpClient } from "./memongo-http-client.js"
import {
	MEMONGO_CONTRACT_SHA256,
	MEMONGO_CONTRACT_VERSION,
	resolveMemongoRuntimeConfig,
} from "./memongo-runtime.js"

describe("resolveMemongoRuntimeConfig", () => {
	it("resolves only Memongo HTTP settings against the pinned contract", () => {
		const config = resolveMemongoRuntimeConfig({
			MEMONGO_API_URL: "https://memongo.example.test",
			MEMONGO_API_KEY: " tenant-key ",
			MEMONGO_CONTROL_API_KEY: " control-key ",
			MEMONGO_TIMEOUT_MS: "2500",
			MEMONGO_COMPATIBILITY_TTL_MS: "30000",
			MDBRAIN_MONGODB_URI: "mongodb://must-not-be-used",
		})

		expect(config).toEqual({
			baseUrl: "https://memongo.example.test",
			tenantApiKey: "tenant-key",
			controlApiKey: "control-key",
			expectedVersion: MEMONGO_CONTRACT_VERSION,
			expectedContractSha256: MEMONGO_CONTRACT_SHA256,
			timeoutMs: 2500,
			compatibilityTtlMs: 30000,
			allowInsecureLocal: false,
			allowInsecureHttp: false,
			readinessControlLanes: [],
		})
		expect(MEMONGO_CONTRACT_VERSION).toBe("2.1.0")
		expect(MEMONGO_CONTRACT_SHA256).toBe(
			"bb1cb9fdd3eaa49699925980c775737d994fbba8774977c080ece7586a5d835f",
		)
	})

	it("fails closed when required endpoint or tenant credentials are absent", () => {
		expect(() =>
			resolveMemongoRuntimeConfig({ MEMONGO_API_KEY: "key" }),
		).toThrow("MEMONGO_API_URL is required")
		expect(() =>
			resolveMemongoRuntimeConfig({
				MEMONGO_API_URL: "https://memongo.example.test",
			}),
		).toThrow("MEMONGO_API_KEY is required")
	})

	it("accepts explicit loopback development and rejects invalid numeric settings", () => {
		expect(
			resolveMemongoRuntimeConfig({
				MEMONGO_API_URL: "http://127.0.0.1:3847",
				MEMONGO_API_KEY: "key",
				MEMONGO_ALLOW_INSECURE_LOCAL: "1",
			}).allowInsecureLocal,
		).toBe(true)
		expect(
			resolveMemongoRuntimeConfig({
				MEMONGO_API_URL: "http://memongo:3847",
				MEMONGO_API_KEY: "key",
				MEMONGO_ALLOW_INSECURE_HTTP: "1",
			}).allowInsecureHttp,
		).toBe(true)
		expect(
			resolveMemongoRuntimeConfig({
				MEMONGO_API_URL: "http://memongo:3847",
				MEMONGO_API_KEY: "key",
			}).allowInsecureHttp,
		).toBe(false)
		expect(() =>
			resolveMemongoRuntimeConfig({
				MEMONGO_API_URL: "https://memongo.example.test",
				MEMONGO_API_KEY: "key",
				MEMONGO_TIMEOUT_MS: "not-a-number",
			}),
		).toThrow("MEMONGO_TIMEOUT_MS")
	})

	it("permits plain HTTP to non-loopback hosts only with the explicit opt-in", () => {
		const options = {
			tenantApiKey: "key",
			expectedVersion: "2.0.1",
			expectedContractSha256:
				"01680e7ba03674ae06c899856d7521e95e66d5d1be465f172080907dc29cb8bc",
		}
		expect(
			() =>
				new MemongoHttpClient({
					...options,
					baseUrl: "http://memongo:3847",
					allowInsecureLocal: true,
				}),
		).toThrow("Memongo requires HTTPS")
		expect(
			() =>
				new MemongoHttpClient({
					...options,
					baseUrl: "http://memongo:3847",
					allowInsecureHttp: true,
				}),
		).not.toThrow()
	})

	it("configures only explicit server-local control readiness lanes", () => {
		expect(
			resolveMemongoRuntimeConfig({
				MEMONGO_API_URL: "https://memongo.example.test",
				MEMONGO_API_KEY: "tenant-key",
				MEMONGO_CONTROL_API_KEY: "control-key",
				MEMONGO_READINESS_CONTROL_LANES: "control,vector",
			}).readinessControlLanes,
		).toEqual(["control", "vector"])

		expect(() =>
			resolveMemongoRuntimeConfig({
				MEMONGO_API_URL: "https://memongo.example.test",
				MEMONGO_API_KEY: "tenant-key",
				MEMONGO_READINESS_CONTROL_LANES: "embedding",
			}),
		).toThrow("MEMONGO_CONTROL_API_KEY")
		expect(() =>
			resolveMemongoRuntimeConfig({
				MEMONGO_API_URL: "https://memongo.example.test",
				MEMONGO_API_KEY: "tenant-key",
				MEMONGO_CONTROL_API_KEY: "control-key",
				MEMONGO_READINESS_CONTROL_LANES: "embedding,unknown",
			}),
		).toThrow("MEMONGO_READINESS_CONTROL_LANES")
		expect(() =>
			resolveMemongoRuntimeConfig({
				MEMONGO_API_URL: "https://memongo.example.test",
				MEMONGO_API_KEY: "tenant-key",
				MEMONGO_CONTROL_API_KEY: "control-key",
				MEMONGO_READINESS_CONTROL_LANES: "vector,vector",
			}),
		).toThrow("MEMONGO_READINESS_CONTROL_LANES")
	})
})
