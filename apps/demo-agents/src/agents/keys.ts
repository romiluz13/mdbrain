import type { AgentRole } from "./config.js"

/** Secrets-file key holding the JSON array of [support, account] API key
 * pairs, one per run slot, in slot order. */
export const AGENT_KEYS_SECRET = "MDBRAIN_DEMO_AGENT_KEYS"

/** Secrets-file key holding the ticket-09 proposer keys; the product lead
 * borrows its slot's proposer key rather than holding a write key. */
export const PROPOSER_KEYS_SECRET = "MDBRAIN_DEMO_PROPOSER_KEYS"

export type AgentKeyPair = readonly [support: string, account: string]

export type AgentRoleKeys = Record<AgentRole, string>

function invalidPairs(): Error {
	return new Error(
		`${AGENT_KEYS_SECRET} must be a non-empty JSON array of unique [support, account] key pairs`,
	)
}

/** Reads and validates the per-slot [support, account] key pairs. */
export function readAgentKeyPairs(
	secrets: Record<string, string | undefined>,
): AgentKeyPair[] {
	const raw = secrets[AGENT_KEYS_SECRET]?.trim()
	if (!raw) {
		throw new Error(`${AGENT_KEYS_SECRET} is missing from the secrets file`)
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(raw) as unknown
	} catch {
		throw invalidPairs()
	}
	if (!Array.isArray(parsed) || parsed.length === 0) {
		throw invalidPairs()
	}
	const pairs: AgentKeyPair[] = []
	const seen = new Set<string>()
	for (const entry of parsed) {
		if (
			!Array.isArray(entry) ||
			entry.length !== 2 ||
			!entry.every((key) => typeof key === "string" && key.trim())
		) {
			throw invalidPairs()
		}
		const pair: [string, string] = [
			String(entry[0]).trim(),
			String(entry[1]).trim(),
		]
		for (const key of pair) {
			if (seen.has(key)) throw invalidPairs()
			seen.add(key)
		}
		pairs.push(pair)
	}
	return pairs
}

function invalidProposers(): Error {
	return new Error(
		`${PROPOSER_KEYS_SECRET} must be a non-empty JSON array of unique non-empty keys`,
	)
}

function readProposerKeys(
	secrets: Record<string, string | undefined>,
): string[] {
	const raw = secrets[PROPOSER_KEYS_SECRET]?.trim()
	if (!raw) {
		throw new Error(`${PROPOSER_KEYS_SECRET} is missing from the secrets file`)
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(raw) as unknown
	} catch {
		throw invalidProposers()
	}
	if (
		!Array.isArray(parsed) ||
		parsed.length === 0 ||
		!parsed.every((key) => typeof key === "string" && key.trim())
	) {
		throw invalidProposers()
	}
	const keys = (parsed as string[]).map((key) => key.trim())
	if (new Set(keys).size !== keys.length) throw invalidProposers()
	return keys
}

/** Maps slot i to the keys its three roles hold: the slot's own support and
 * account keys, and proposer key i as the product lead's key. The product
 * key must not be one of the slot's writer keys. */
export function readAgentRoleKeys(
	secrets: Record<string, string | undefined>,
	slotIndex: number,
): AgentRoleKeys {
	const pairs = readAgentKeyPairs(secrets)
	const proposers = readProposerKeys(secrets)
	if (
		!Number.isInteger(slotIndex) ||
		slotIndex < 1 ||
		slotIndex > pairs.length
	) {
		throw new Error(
			`no agent key pair for slot ${slotIndex} in ${AGENT_KEYS_SECRET}`,
		)
	}
	const [support, account] = pairs[slotIndex - 1]!
	const product = proposers[slotIndex - 1]
	if (product === undefined) {
		throw new Error(
			`${PROPOSER_KEYS_SECRET} has no proposer key for slot ${slotIndex}`,
		)
	}
	if (product === support || product === account) {
		throw new Error(
			`the product key for slot ${slotIndex} must not reuse a support or account key from ${AGENT_KEYS_SECRET}`,
		)
	}
	return { support, account, product }
}
