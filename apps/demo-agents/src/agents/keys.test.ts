import { describe, expect, it } from "vitest"
import { readAgentKeyPairs, readAgentRoleKeys } from "./keys.js"

const secrets = {
	MDBRAIN_DEMO_AGENT_KEYS: JSON.stringify([
		["agent-support-one", "agent-account-one"],
		["agent-support-two", "agent-account-two"],
	]),
	MDBRAIN_DEMO_PROPOSER_KEYS: JSON.stringify(["proposer-one", "proposer-two"]),
}

describe("readAgentKeyPairs", () => {
	it("reads one [support, account] pair per slot", () => {
		expect(readAgentKeyPairs(secrets)).toEqual([
			["agent-support-one", "agent-account-one"],
			["agent-support-two", "agent-account-two"],
		])
	})

	it("refuses malformed, empty, or duplicated input", () => {
		for (const bad of [
			"not-json",
			"[]",
			'["a", "b"]',
			'[["a"]]',
			'[["a", "b", "c"]]',
			'[["a", "a"]]',
			'[["a", "b"], ["c", "b"]]',
			'[["a", 1]]',
		]) {
			expect(() => readAgentKeyPairs({ MDBRAIN_DEMO_AGENT_KEYS: bad })).toThrow(
				/MDBRAIN_DEMO_AGENT_KEYS/,
			)
		}
	})

	it("refuses an absent secret", () => {
		expect(() => readAgentKeyPairs({})).toThrow(/MDBRAIN_DEMO_AGENT_KEYS/)
	})
})

describe("readAgentRoleKeys", () => {
	it("maps slot i to its own support and account keys plus proposer i as the product key", () => {
		expect(readAgentRoleKeys(secrets, 2)).toEqual({
			support: "agent-support-two",
			account: "agent-account-two",
			product: "proposer-two",
		})
		expect(readAgentRoleKeys(secrets, 1)).toEqual({
			support: "agent-support-one",
			account: "agent-account-one",
			product: "proposer-one",
		})
	})

	it("refuses a slot with no pair, a missing proposer list, or a clashing product key", () => {
		expect(() => readAgentRoleKeys(secrets, 3)).toThrow(/slot 3/)
		expect(() =>
			readAgentRoleKeys(
				{ MDBRAIN_DEMO_AGENT_KEYS: secrets.MDBRAIN_DEMO_AGENT_KEYS },
				1,
			),
		).toThrow(/MDBRAIN_DEMO_PROPOSER_KEYS/)
		const clash = {
			MDBRAIN_DEMO_AGENT_KEYS: JSON.stringify([
				["proposer-one", "agent-account-one"],
			]),
			MDBRAIN_DEMO_PROPOSER_KEYS: secrets.MDBRAIN_DEMO_PROPOSER_KEYS,
		}
		expect(() => readAgentRoleKeys(clash, 1)).toThrow(/must not reuse/)
	})
})
