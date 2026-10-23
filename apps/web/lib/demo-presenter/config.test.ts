import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_RUN_DEADLINE_MS,
	readPresenterConfig,
	readRunDeadlineMs,
} from "./config.js"

const ENV = {
	MDBRAIN_DEMO_CONTROL_URI: "mongodb://control.test/",
	MDBRAIN_DEMO_API_BASE_URL: "http://127.0.0.1:3857/",
	MDBRAIN_DEMO_PRESENTER_TOKEN: "presenter-token-0123456789abcdef",
	MDBRAIN_DEMO_PRESENTER_API_KEY: "admin-key-0123456789",
	MDBRAIN_DEMO_READ_KEYS: JSON.stringify(["read-1", "read-2", "read-3"]),
}

describe("readPresenterConfig", () => {
	it("reads the presenter env and trims the API base URL", () => {
		expect(readPresenterConfig(ENV)).toEqual({
			controlUri: "mongodb://control.test/",
			apiBaseUrl: "http://127.0.0.1:3857",
			token: "presenter-token-0123456789abcdef",
			adminKey: "admin-key-0123456789",
			readKeys: ["read-1", "read-2", "read-3"],
			runDeadlineMs: DEFAULT_RUN_DEADLINE_MS,
		})
	})

	it("is null when any part is missing or malformed, so presenter mode stays off", () => {
		for (const [name, value] of [
			["MDBRAIN_DEMO_CONTROL_URI", ""],
			["MDBRAIN_DEMO_CONTROL_URI", "https://not-mongo.test/"],
			["MDBRAIN_DEMO_API_BASE_URL", "ftp://x"],
			["MDBRAIN_DEMO_PRESENTER_TOKEN", ""],
			["MDBRAIN_DEMO_PRESENTER_TOKEN", "short"],
			["MDBRAIN_DEMO_PRESENTER_API_KEY", ""],
			["MDBRAIN_DEMO_READ_KEYS", "not json"],
			["MDBRAIN_DEMO_READ_KEYS", "[]"],
			["MDBRAIN_DEMO_READ_KEYS", '["ok", 3]'],
		] as const) {
			expect(readPresenterConfig({ ...ENV, [name]: value })).toBeNull()
		}
	})

	it.each([
		["a short token", "Ab1-Ab1-Ab1-Ab1-Ab1-Ab1-"],
		["31 characters", "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7xC0v"],
		["one repeated character", "a".repeat(40)],
		["two characters repeated", "ab".repeat(20)],
		["digits only", "1234567890".repeat(4)],
		["one class, few distinct characters", "abcabcabcabcabcabcabcabcabcabcabc"],
		["a three-character pattern repeated", "Ab1".repeat(12)],
	])("refuses a presenter token that is %s", (_name, token) => {
		expect(
			readPresenterConfig({ ...ENV, MDBRAIN_DEMO_PRESENTER_TOKEN: token }),
		).toBeNull()
	})

	it.each([
		[
			"32 random bytes in base64url",
			"k3J9xQ2mP7vR1tY6uI0oL4aS8dF5gH_zXcVbN-wEqMe",
		],
		["16 random bytes in hex", "9f86d081884c7d659a2feaa0c55ad015"],
		["a long mixed token", "Zx9-Qm4_Rt7+Lp2.Wn8~Vb5/Hc3=Jd6!Ke1@Fa0"],
	])("accepts a presenter token that is %s", (_name, token) => {
		expect(
			readPresenterConfig({ ...ENV, MDBRAIN_DEMO_PRESENTER_TOKEN: token })
				?.token,
		).toBe(token)
	})

	it("is null when the review key is also a read key, so one leaked key never holds both powers", () => {
		expect(
			readPresenterConfig({
				...ENV,
				MDBRAIN_DEMO_PRESENTER_API_KEY: "read-2",
			}),
		).toBeNull()
		expect(
			readPresenterConfig({
				...ENV,
				MDBRAIN_DEMO_READ_KEY: "admin-key-0123456789",
			}),
		).toBeNull()
	})

	it("honors a run deadline override and ignores an invalid one", () => {
		expect(
			readPresenterConfig({ ...ENV, MDBRAIN_DEMO_RUN_DEADLINE_MS: "120000" })
				?.runDeadlineMs,
		).toBe(120_000)
		expect(readRunDeadlineMs({ MDBRAIN_DEMO_RUN_DEADLINE_MS: "0" })).toBe(
			DEFAULT_RUN_DEADLINE_MS,
		)
		expect(readRunDeadlineMs({ MDBRAIN_DEMO_RUN_DEADLINE_MS: "soon" })).toBe(
			DEFAULT_RUN_DEADLINE_MS,
		)
	})
})

describe("the run deadline default", () => {
	it("equals the runner's own default: three tasks plus the staging wait and the confirm", () => {
		const worker = readFileSync(
			join(__dirname, "../../../demo-agents/src/agents/config.ts"),
			"utf8",
		)
		const num = (name: string) =>
			Number(
				new RegExp(`${name} = ([\\d_]+)`).exec(worker)?.[1]?.replace(/_/g, ""),
			)
		const taskDeadline = Number(
			/taskDeadlineMs: ([\d_]+)/.exec(worker)?.[1]?.replace(/_/g, ""),
		)
		expect(DEFAULT_RUN_DEADLINE_MS).toBe(
			3 * taskDeadline +
				num("STAGING_ALLOWANCE_MS") +
				num("CONFIRM_ALLOWANCE_MS"),
		)
	})
})
