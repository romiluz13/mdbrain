import path from "node:path"

export const DEMO_DATABASES = [
	"mdbrain_demo_wiki",
	"mdbrain_demo_memory",
	"mdbrain_demo_control",
] as const

export type DemoDatabase = (typeof DEMO_DATABASES)[number]

export const DEMO_API_PORT = 3857
export const DEMO_MEMONGO_PORT = 3858

export function assertDemoDatabase(name: string): DemoDatabase {
	if (!(DEMO_DATABASES as readonly string[]).includes(name)) {
		throw new Error(`${name} is not a demo database`)
	}
	return name as DemoDatabase
}

export function parseSecretsFile(text: string): Record<string, string> {
	const out: Record<string, string> = {}
	for (const raw of text.split("\n")) {
		const line = raw.trim()
		if (!line || line.startsWith("#")) continue
		const eq = line.indexOf("=")
		if (eq <= 0) continue
		out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
	}
	return out
}

function required(secrets: Record<string, string>, key: string): string {
	const value = secrets[key]?.trim()
	if (!value)
		throw new Error(`demo stack: ${key} is missing from the secrets file`)
	return value
}

/** Secrets-file key holding the JSON array of run-slot API tokens, in slot
 * order: index i-1 unlocks slot i (scopeRef `demo-run-<i>`). */
export const DEMO_SLOT_KEYS_SECRET = "MDBRAIN_DEMO_SLOT_KEYS"

/** Secrets-file key holding the JSON array of proposer API tokens, in slot
 * order: index i-1 may propose new pages into slot i (scopeRef `demo-run-<i>`)
 * and nothing else. */
export const DEMO_PROPOSER_KEYS_SECRET = "MDBRAIN_DEMO_PROPOSER_KEYS"

/** Secrets-file key holding the JSON array of ticket-10 role-agent API key
 * pairs ([support, account]), in slot order: pair i-1 serves slot i. The
 * product lead borrows the slot's proposer key instead of a third pair. */
export const DEMO_AGENT_KEYS_SECRET = "MDBRAIN_DEMO_AGENT_KEYS"

/** Secrets-file key holding the JSON array of /demo read-proxy API tokens, in
 * slot order: index i-1 reads slot i and nothing else. */
export const DEMO_READ_KEYS_SECRET = "MDBRAIN_DEMO_READ_KEYS"

/** Secrets-file key holding the per-IP request-start budget (per minute) for
 * the demo API. The default stack limit (100) is too low for corpus seeding. */
export const DEMO_API_RATE_LIMIT_SECRET = "MDBRAIN_DEMO_API_RATE_LIMIT"

/** Secrets-file key holding the presenter's review-queue API token: the same
 * value the web reads as MDBRAIN_DEMO_PRESENTER_API_KEY. */
export const DEMO_PRESENTER_KEY_SECRET = "MDBRAIN_DEMO_PRESENTER_API_KEY"

export type DemoSlotScopedKeyPolicy = {
	grants: Array<{ scope: "workspace"; scopeRef: string }>
}

/** Scoped-key policy (MDBRAIN_API_SCOPED_KEYS object form) granting each slot
 * token exactly one workspace pair. Slot numbering matches
 * apps/demo-agents/src/seeding/ids.ts: slot i (1-based) owns `demo-run-<i>`. */
export function buildDemoSlotScopedKeys(
	tokens: readonly string[],
): Record<string, DemoSlotScopedKeyPolicy> {
	const policies: Record<string, DemoSlotScopedKeyPolicy> = {}
	tokens.forEach((token, index) => {
		policies[token] = {
			grants: [{ scope: "workspace", scopeRef: `demo-run-${index + 1}` }],
		}
	})
	return policies
}

function parseTokenList(
	secrets: Record<string, string>,
	secretKey: string,
): string[] | undefined {
	const raw = secrets[secretKey]?.trim()
	if (!raw) return undefined
	let parsed: unknown
	try {
		parsed = JSON.parse(raw) as unknown
	} catch {
		throw new Error(`${secretKey} must be a JSON array of tokens`)
	}
	if (
		!Array.isArray(parsed) ||
		parsed.length === 0 ||
		!parsed.every((token) => typeof token === "string" && token.trim())
	) {
		throw new Error(
			`${secretKey} must be a non-empty array of non-empty, unique tokens`,
		)
	}
	const tokens = (parsed as string[]).map((token) => token.trim())
	if (new Set(tokens).size !== tokens.length) {
		throw new Error(`${secretKey} tokens must be unique`)
	}
	return tokens
}

export type DemoProposerScopedKeyPolicy = {
	subjectId: string
	displayName: string
	grants: Array<{ scope: "workspace"; scopeRef: string }>
	capabilities: ["read", "propose"]
}

/** Scoped-key policy for proposer tokens: each may read, append memory events
 * and propose new pages into exactly one slot, and holds no `write`, so every
 * direct wiki mutation is refused and its promotions wait for an admin.
 *
 * The grant is the exact pair (workspace, `demo-run-<i>`), the same one slot
 * i's own key holds, rather than a wildcard: the API's grant model has no
 * prefix match, and a leaked proposer key must reach one slot only. */
export function buildDemoProposerScopedKeys(
	tokens: readonly string[],
): Record<string, DemoProposerScopedKeyPolicy> {
	const policies: Record<string, DemoProposerScopedKeyPolicy> = {}
	tokens.forEach((token, index) => {
		policies[token] = {
			subjectId: `demo-proposer-${index + 1}`,
			displayName: `Demo proposer ${index + 1}`,
			grants: [{ scope: "workspace", scopeRef: `demo-run-${index + 1}` }],
			capabilities: ["read", "propose"],
		}
	})
	return policies
}

export type DemoAgentScopedKeyPolicy = {
	subjectId: string
	displayName: string
	grants: Array<{ scope: "workspace"; scopeRef: string }>
	agentIds: string[]
}

/** Scoped-key policies for the ticket-10 role-agent keys. Support and
 * account hold an exact workspace grant on one slot with read+write (the
 * default capabilities), and the API pins their writes to the run's shared
 * agentId, so a role key cannot pose as any other principal. */
export function buildDemoAgentScopedKeys(
	pairs: ReadonlyArray<readonly [support: string, account: string]>,
): Record<string, DemoAgentScopedKeyPolicy> {
	const policies: Record<string, DemoAgentScopedKeyPolicy> = {}
	pairs.forEach(([support, account], index) => {
		const slot = index + 1
		const grants: Array<{ scope: "workspace"; scopeRef: string }> = [
			{ scope: "workspace", scopeRef: `demo-run-${slot}` },
		]
		policies[support] = {
			subjectId: `demo-agent-support-${slot}`,
			displayName: `Demo support agent ${slot}`,
			grants,
			agentIds: [`demo-run-${slot}`],
		}
		policies[account] = {
			subjectId: `demo-agent-account-${slot}`,
			displayName: `Demo account agent ${slot}`,
			grants,
			agentIds: [`demo-run-${slot}`],
		}
	})
	return policies
}

export type DemoReadScopedKeyPolicy = {
	subjectId: string
	displayName: string
	grants: Array<{ scope: "workspace"; scopeRef: string }>
	capabilities: ["read"]
}

/** Scoped-key policies for the /demo read proxy: read only, one exact slot
 * grant. No agentId pin: a pinned key must send its agentId on every request,
 * and the proxy sends one on citation reads only. */
export function buildDemoReadScopedKeys(
	tokens: readonly string[],
): Record<string, DemoReadScopedKeyPolicy> {
	const policies: Record<string, DemoReadScopedKeyPolicy> = {}
	tokens.forEach((token, index) => {
		const slot = index + 1
		policies[token] = {
			subjectId: `demo-reader-${slot}`,
			displayName: `Demo reader ${slot}`,
			grants: [{ scope: "workspace", scopeRef: `demo-run-${slot}` }],
			capabilities: ["read"],
		}
	})
	return policies
}

export type DemoPresenterScopedKeyPolicy = {
	subjectId: string
	displayName: string
	grants: Array<{ scope: "workspace"; scopeRef: string }>
	capabilities: ["administer"]
}

/** Scoped-key policy for the presenter's review-queue key: administer only,
 * one exact grant per slot and never a wildcard (decision D29), so it can
 * list and decide proposals in the slots, and nothing outside them. */
export function buildDemoPresenterScopedKey(
	token: string,
	slotCount: number,
): Record<string, DemoPresenterScopedKeyPolicy> {
	return {
		[token]: {
			subjectId: "demo-presenter",
			displayName: "Demo presenter",
			grants: Array.from({ length: slotCount }, (_, index) => ({
				scope: "workspace" as const,
				scopeRef: `demo-run-${index + 1}`,
			})),
			capabilities: ["administer"],
		},
	}
}

function parseAgentKeyPairs(
	secrets: Record<string, string>,
): Array<[string, string]> | undefined {
	const raw = secrets[DEMO_AGENT_KEYS_SECRET]?.trim()
	if (!raw) return undefined
	let parsed: unknown
	try {
		parsed = JSON.parse(raw) as unknown
	} catch {
		throw new Error(
			`${DEMO_AGENT_KEYS_SECRET} must be a JSON array of [support, account] key pairs`,
		)
	}
	const invalid = () =>
		new Error(
			`${DEMO_AGENT_KEYS_SECRET} must be a non-empty array of unique [support, account] key pairs`,
		)
	if (!Array.isArray(parsed) || parsed.length === 0) throw invalid()
	const pairs: Array<[string, string]> = []
	const seen = new Set<string>()
	for (const entry of parsed) {
		if (
			!Array.isArray(entry) ||
			entry.length !== 2 ||
			!entry.every((key) => typeof key === "string" && key.trim())
		) {
			throw invalid()
		}
		const pair: [string, string] = [
			String(entry[0]).trim(),
			String(entry[1]).trim(),
		]
		for (const key of pair) {
			if (seen.has(key)) throw invalid()
			seen.add(key)
		}
		pairs.push(pair)
	}
	return pairs
}

function parseRateLimitMax(
	secrets: Record<string, string>,
): number | undefined {
	const raw = secrets[DEMO_API_RATE_LIMIT_SECRET]?.trim()
	if (!raw) return undefined
	const value = Number(raw)
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(
			`${DEMO_API_RATE_LIMIT_SECRET} must be a non-negative integer`,
		)
	}
	return value
}

// Only these parent variables pass through, so a developer's own Mongo URIs or
// database overrides can never redirect the demo stack.
const PASSTHROUGH = ["PATH", "TMPDIR", "LANG", "TERM", "NODE_OPTIONS"]

export type DemoStackEnv = {
	memongo: Record<string, string>
	api: Record<string, string>
}

export function buildDemoStackEnv(
	secrets: Record<string, string>,
	options: { stackDir: string; parentEnv?: NodeJS.ProcessEnv },
): DemoStackEnv {
	const uri = required(secrets, "DEMO_ATLAS_URI")
	const voyageKey = required(secrets, "VOYAGE_API_KEY")
	const apiKey = required(secrets, "MDBRAIN_DEMO_API_KEY")
	const memongoKey = required(secrets, "MEMONGO_DEMO_API_KEY")
	const parentEnv = options.parentEnv ?? process.env
	const home = path.join(options.stackDir, "home")
	const slotTokens = parseTokenList(secrets, DEMO_SLOT_KEYS_SECRET)
	const proposerTokens = parseTokenList(secrets, DEMO_PROPOSER_KEYS_SECRET)
	const agentPairs = parseAgentKeyPairs(secrets)
	const readTokens = parseTokenList(secrets, DEMO_READ_KEYS_SECRET)
	if (agentPairs) {
		if (!slotTokens) {
			throw new Error(
				`${DEMO_AGENT_KEYS_SECRET} requires the slot tokens from ${DEMO_SLOT_KEYS_SECRET}: one pair per slot`,
			)
		}
		if (!proposerTokens) {
			throw new Error(
				`${DEMO_AGENT_KEYS_SECRET} requires the proposer keys from ${DEMO_PROPOSER_KEYS_SECRET}: the product lead proposes through them`,
			)
		}
		if (agentPairs.length !== slotTokens.length) {
			throw new Error(
				`${DEMO_AGENT_KEYS_SECRET} must hold exactly one pair per slot (${agentPairs.length} pairs, ${slotTokens.length} slots)`,
			)
		}
		for (const key of agentPairs.flat()) {
			if (slotTokens.includes(key)) {
				throw new Error(
					`${DEMO_AGENT_KEYS_SECRET} must not reuse a slot token from ${DEMO_SLOT_KEYS_SECRET}`,
				)
			}
			if (proposerTokens.includes(key)) {
				throw new Error(
					`${DEMO_AGENT_KEYS_SECRET} must not reuse a proposer token from ${DEMO_PROPOSER_KEYS_SECRET}`,
				)
			}
			if (key === apiKey) {
				throw new Error(
					`${DEMO_AGENT_KEYS_SECRET} must not reuse the admin API key`,
				)
			}
		}
	}
	// The object form keys policies by token, so a repeated token would silently
	// replace the earlier policy, and the API refuses its own admin token as a
	// scoped one.
	for (const token of proposerTokens ?? []) {
		if (slotTokens?.includes(token)) {
			throw new Error(
				`${DEMO_PROPOSER_KEYS_SECRET} must not reuse a slot token from ${DEMO_SLOT_KEYS_SECRET}`,
			)
		}
		if (token === apiKey) {
			throw new Error(
				`${DEMO_PROPOSER_KEYS_SECRET} must not reuse the admin API key`,
			)
		}
	}
	if (readTokens) {
		if (!slotTokens) {
			throw new Error(
				`${DEMO_READ_KEYS_SECRET} requires the slot tokens from ${DEMO_SLOT_KEYS_SECRET}: one read key per slot`,
			)
		}
		if (readTokens.length !== slotTokens.length) {
			throw new Error(
				`${DEMO_READ_KEYS_SECRET} must hold exactly one read key per slot (${readTokens.length} keys, ${slotTokens.length} slots)`,
			)
		}
		for (const token of readTokens) {
			if (slotTokens.includes(token)) {
				throw new Error(
					`${DEMO_READ_KEYS_SECRET} must not reuse a slot token from ${DEMO_SLOT_KEYS_SECRET}`,
				)
			}
			if (proposerTokens?.includes(token)) {
				throw new Error(
					`${DEMO_READ_KEYS_SECRET} must not reuse a proposer token from ${DEMO_PROPOSER_KEYS_SECRET}`,
				)
			}
			if (agentPairs?.some((pair) => pair.includes(token))) {
				throw new Error(
					`${DEMO_READ_KEYS_SECRET} must not reuse an agent key from ${DEMO_AGENT_KEYS_SECRET}`,
				)
			}
			if (token === apiKey) {
				throw new Error(
					`${DEMO_READ_KEYS_SECRET} must not reuse the admin API key`,
				)
			}
		}
	}
	const presenterToken = secrets[DEMO_PRESENTER_KEY_SECRET]?.trim() || undefined
	if (presenterToken) {
		if (!slotTokens) {
			throw new Error(
				`${DEMO_PRESENTER_KEY_SECRET} requires the slot tokens from ${DEMO_SLOT_KEYS_SECRET}: it is granted every slot`,
			)
		}
		if (
			presenterToken === apiKey ||
			slotTokens.includes(presenterToken) ||
			proposerTokens?.includes(presenterToken) ||
			agentPairs?.some((pair) => pair.includes(presenterToken)) ||
			readTokens?.includes(presenterToken)
		) {
			throw new Error(
				`${DEMO_PRESENTER_KEY_SECRET} must not reuse the admin, slot, proposer, agent or read keys`,
			)
		}
	}
	const rateLimitMax = parseRateLimitMax(secrets)

	const base: Record<string, string> = { HOME: home }
	for (const key of PASSTHROUGH) {
		const value = parentEnv[key]
		if (value) base[key] = value
	}

	return {
		memongo: {
			...base,
			MEMONGO_FORCE_MONGODB_URI: uri,
			MEMONGO_MONGODB_DATABASE: assertDemoDatabase("mdbrain_demo_memory"),
			MEMONGO_WORKSPACE_DIR: path.join(options.stackDir, "memongo-workspace"),
			MEMONGO_API_KEY: memongoKey,
			MEMONGO_API_HOST: "127.0.0.1",
			MEMONGO_API_PORT: String(DEMO_MEMONGO_PORT),
			VOYAGE_API_KEY: voyageKey,
		},
		api: {
			...base,
			MDBRAIN_WIKI_MONGODB_URI: uri,
			MDBRAIN_WIKI_DATABASE: assertDemoDatabase("mdbrain_demo_wiki"),
			MDBRAIN_CONFIG_PATH: path.join(home, ".mdbrain", "mdbrain.json"),
			MDBRAIN_WORKSPACE_DIR: path.join(options.stackDir, "mdbrain-workspace"),
			MEMONGO_API_URL: `http://127.0.0.1:${DEMO_MEMONGO_PORT}`,
			MEMONGO_API_KEY: memongoKey,
			MEMONGO_ALLOW_INSECURE_LOCAL: "1",
			MEMONGO_TIMEOUT_MS: "120000",
			MDBRAIN_API_KEY: apiKey,
			MDBRAIN_API_HOST: "127.0.0.1",
			MDBRAIN_API_PORT: String(DEMO_API_PORT),
			...(slotTokens || proposerTokens || agentPairs || readTokens
				? {
						MDBRAIN_API_SCOPED_KEYS: JSON.stringify({
							...(slotTokens ? buildDemoSlotScopedKeys(slotTokens) : {}),
							...(proposerTokens
								? buildDemoProposerScopedKeys(proposerTokens)
								: {}),
							...(agentPairs ? buildDemoAgentScopedKeys(agentPairs) : {}),
							...(readTokens ? buildDemoReadScopedKeys(readTokens) : {}),
							...(presenterToken && slotTokens
								? buildDemoPresenterScopedKey(presenterToken, slotTokens.length)
								: {}),
						}),
					}
				: {}),
			...(rateLimitMax !== undefined
				? { MDBRAIN_API_RATE_LIMIT_MAX: String(rateLimitMax) }
				: {}),
		},
	}
}
