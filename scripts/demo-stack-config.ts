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

/** Secrets-file key holding the per-IP request-start budget (per minute) for
 * the demo API. The default stack limit (100) is too low for corpus seeding. */
export const DEMO_API_RATE_LIMIT_SECRET = "MDBRAIN_DEMO_API_RATE_LIMIT"

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
			...(slotTokens || proposerTokens
				? {
						MDBRAIN_API_SCOPED_KEYS: JSON.stringify({
							...(slotTokens ? buildDemoSlotScopedKeys(slotTokens) : {}),
							...(proposerTokens
								? buildDemoProposerScopedKeys(proposerTokens)
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
