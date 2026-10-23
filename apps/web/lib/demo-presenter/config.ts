// The presenter's server-only configuration. Every value comes from the web
// server's environment and none reaches the browser. When any part is missing
// or malformed the config is null and presenter mode stays off: the presenter
// routes answer "not configured" and public mode is untouched.

export const DEFAULT_RUN_DEADLINE_MS = 335_000
const TOKEN_MIN_LENGTH = 24

export type PresenterConfig = {
	/** The demo control database. */
	controlUri: string
	apiBaseUrl: string
	/** The presenter token the operator hands the presenter. */
	token: string
	/** An administer-capable API key, used for the review queue only. */
	adminKey: string
	/** One read key per slot, in slot order: index i-1 reads slot i. */
	readKeys: string[]
	runDeadlineMs: number
}

/** The read key the server holds for a slot, or undefined when it has none. */
export function readKeyOf(
	config: Pick<PresenterConfig, "readKeys">,
	slotIndex: number,
): string | undefined {
	return config.readKeys[slotIndex - 1]
}

const MONGO_URI = /^mongodb(\+srv)?:\/\/\S+$/

/** The whole-run limit the run record is held to; it applies to public reads
 * too, so it does not need the presenter config. */
export function readRunDeadlineMs(
	env: Record<string, string | undefined>,
): number {
	const raw = env.MDBRAIN_DEMO_RUN_DEADLINE_MS?.trim() ?? ""
	return /^[1-9]\d*$/.test(raw) ? Number(raw) : DEFAULT_RUN_DEADLINE_MS
}

function keyList(raw: string | undefined): string[] | null {
	if (!raw) return null
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	return Array.isArray(parsed) &&
		parsed.length > 0 &&
		parsed.every((key) => typeof key === "string" && key.trim() !== "")
		? (parsed as string[]).map((key) => key.trim())
		: null
}

export function readPresenterConfig(
	env: Record<string, string | undefined>,
): PresenterConfig | null {
	const controlUri = (env.MDBRAIN_DEMO_CONTROL_URI ?? "").trim()
	const apiBaseUrl = (env.MDBRAIN_DEMO_API_BASE_URL ?? "").trim()
	const token = (env.MDBRAIN_DEMO_PRESENTER_TOKEN ?? "").trim()
	const adminKey = (env.MDBRAIN_DEMO_PRESENTER_API_KEY ?? "").trim()
	const readKeys = keyList(env.MDBRAIN_DEMO_READ_KEYS)
	if (
		!MONGO_URI.test(controlUri) ||
		token.length < TOKEN_MIN_LENGTH ||
		adminKey === "" ||
		readKeys === null
	) {
		return null
	}
	let base: URL
	try {
		base = new URL(apiBaseUrl)
	} catch {
		return null
	}
	if (base.protocol !== "http:" && base.protocol !== "https:") return null
	return {
		controlUri,
		apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
		token,
		adminKey,
		readKeys,
		runDeadlineMs: readRunDeadlineMs(env),
	}
}
