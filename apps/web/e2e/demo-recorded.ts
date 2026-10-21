// A recording of the proxy's answers to the reads /demo makes, so the e2e can
// replay a live run's shapes as its upstream. The recorder keeps the upstream
// path and query and the answer; it keeps no key, no origin and no principal.
import { readFileSync, writeFileSync } from "node:fs"

export const RECORDING_FORMAT = "mdbrain-demo-recording/1"

export type RecordedRead = {
	/** The upstream path, `/v1/wiki/lint`: the proxy's own prefix is dropped. */
	path: string
	/** What the page asked for. The principal is the proxy's, so it is not here. */
	query: Record<string, string>
	status: number
	body: unknown
}
export type Recording = {
	format: typeof RECORDING_FORMAT
	reads: RecordedRead[]
}

const PROXY_PREFIX = "/api/demo"
const PRINCIPAL_PARAMS = new Set([
	"scope",
	"scopeRef",
	"agentId",
	"containerTag",
])
// Keys whose value names who the run or a writer is. `scope` is only the kind
// of container ("workspace"), so it stays.
const IDENTITY_KEYS = new Set([
	"scopeRef",
	"agentId",
	"containerTag",
	"editor",
	"createdBy",
	"updatedBy",
	"actor",
	"principal",
	"principalId",
	"userId",
	"proposer",
	"subjectId",
	"displayName",
	"author",
	"email",
])
// Who may read a page: the demo reads none of it, and the lists name people,
// groups and roles. They are recorded empty.
const ACCESS_LISTS = new Set([
	"allowedSubjects",
	"allowedGroups",
	"allowedRoles",
])
const SCRUBBED = "[recorded]"
// The text of an authorization header, whatever the token.
const HEADER_TEXT = /\bBearer\s+\S{8,}/i
// A value shorter than this is a word, not an identity; scrubbing it from
// running text would corrupt the content.
const MIN_IDENTITY_LENGTH = 4

type Seen = { url: URL; status: number; body: unknown }

const keyOf = (path: string, query: Record<string, string>): string => {
	const search = new URLSearchParams(
		Object.entries(query).sort(([a], [b]) => a.localeCompare(b)),
	).toString()
	return search === "" ? path : `${path}?${search}`
}

/** The strings a recording must never hold, from the environment the live run
 * was started with: the read key and the API's origin and host. Nothing is
 * listed for a value that is not set. */
export function forbiddenFromEnv(
	env: Record<string, string | undefined> = process.env,
): string[] {
	const forbidden: string[] = []
	const key = env.MDBRAIN_DEMO_READ_KEY
	if (key) {
		forbidden.push(key)
	}
	const base = env.MDBRAIN_DEMO_API_BASE_URL
	if (base) {
		forbidden.push(base)
		try {
			forbidden.push(new URL(base).host)
		} catch {
			// not a URL; the whole string is already listed
		}
	}
	const control = env.MDBRAIN_DEMO_CONTROL_URI
	if (control) {
		forbidden.push(control)
		try {
			const parsed = new URL(control)
			for (const part of [parsed.host, parsed.username, parsed.password]) {
				if (part) {
					forbidden.push(decodeURIComponent(part))
				}
			}
		} catch {
			// not a URL the platform parses; the whole string is already listed
		}
	}
	return forbidden
}

/** The run's own identity from the environment the live run was started with:
 * the slot's scope reference and agent, scrubbed wherever they appear. */
export function identityFromEnv(
	env: Record<string, string | undefined> = process.env,
): string[] {
	return [
		env.MDBRAIN_DEMO_SCOPE_REF,
		env.MDBRAIN_DEMO_AGENT_ID,
		env.MDBRAIN_DEMO_RUN_ID,
	].filter((value): value is string => value !== undefined && value !== "")
}

function collectIdentity(value: unknown, into: Set<string>): void {
	if (Array.isArray(value)) {
		for (const item of value) {
			collectIdentity(item, into)
		}
	} else if (typeof value === "object" && value !== null) {
		for (const [key, item] of Object.entries(value)) {
			if (IDENTITY_KEYS.has(key) && typeof item === "string") {
				if (item.length >= MIN_IDENTITY_LENGTH) {
					into.add(item)
				}
			} else {
				collectIdentity(item, into)
			}
		}
	}
}

function scrub(value: unknown, identity: Set<string>): unknown {
	if (typeof value === "string") {
		let text = value
		for (const known of identity) {
			text = text.split(known).join(SCRUBBED)
		}
		return text
	}
	if (Array.isArray(value)) {
		return value.map((item) => scrub(item, identity))
	}
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				ACCESS_LISTS.has(key)
					? []
					: IDENTITY_KEYS.has(key)
						? SCRUBBED
						: scrub(item, identity),
			]),
		)
	}
	return value
}

function refuseForbidden(
	value: unknown,
	forbidden: string[],
	where: string,
): void {
	if (typeof value === "string") {
		const at = forbidden.findIndex(
			(entry) => entry !== "" && value.includes(entry),
		)
		if (at !== -1) {
			throw new Error(
				`recording refused: ${where} holds a forbidden value (#${at + 1} of ${forbidden.length})`,
			)
		}
		if (HEADER_TEXT.test(value)) {
			throw new Error(
				`recording refused: ${where} holds a forbidden authorization header`,
			)
		}
	} else if (Array.isArray(value)) {
		for (const item of value) {
			refuseForbidden(item, forbidden, where)
		}
	} else if (typeof value === "object" && value !== null) {
		for (const [key, item] of Object.entries(value)) {
			refuseForbidden(key, forbidden, where)
			refuseForbidden(item, forbidden, where)
		}
	}
}

/** What the page saw, as a recording. `forbidden` strings (the key, the API
 * origin) make it throw: they are a leak to fix, not text to edit out. The run's
 * own identity (`identity`, plus every value under an identity key) is scrubbed. */
export function toRecording(
	seen: Seen[],
	forbidden: string[],
	identity: string[] = [],
): Recording {
	const reads = new Map<string, RecordedRead>()
	for (const entry of seen) {
		if (!entry.url.pathname.startsWith(`${PROXY_PREFIX}/`)) {
			continue
		}
		const path = entry.url.pathname.slice(PROXY_PREFIX.length)
		const query = Object.fromEntries(
			[...entry.url.searchParams].filter(
				([name]) => !PRINCIPAL_PARAMS.has(name),
			),
		)
		reads.set(keyOf(path, query), {
			path,
			query,
			status: entry.status,
			body: entry.body,
		})
	}
	const known = new Set(
		identity.filter((id) => id.length >= MIN_IDENTITY_LENGTH),
	)
	for (const read of reads.values()) {
		collectIdentity(read.body, known)
	}
	const scrubbed = [...reads.values()]
		.map((read) => ({ ...read, body: scrub(read.body, known) }))
		.sort((a, b) =>
			keyOf(a.path, a.query).localeCompare(keyOf(b.path, b.query)),
		)
	for (const read of scrubbed) {
		refuseForbidden(read, forbidden, keyOf(read.path, read.query))
	}
	return { format: RECORDING_FORMAT, reads: scrubbed }
}

export function writeRecording(file: string, recording: Recording): void {
	writeFileSync(file, `${JSON.stringify(recording, null, "\t")}\n`)
}

export function readRecording(file: string): Recording {
	const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Recording>
	if (parsed.format !== RECORDING_FORMAT || !Array.isArray(parsed.reads)) {
		throw new Error(`${file} is not a demo recording (${RECORDING_FORMAT})`)
	}
	return parsed as Recording
}

/** The proxy's upstream, answering from a recording. The proxy sends the
 * principal and, for the governed question, a POST; both are mapped back to
 * what the page asked, which is what was recorded. */
export function createRecordedUpstream(recording: Recording): typeof fetch {
	const byKey = new Map(
		recording.reads.map((read) => [keyOf(read.path, read.query), read]),
	)
	const missing = (key: string): Response => {
		console.error(`[demo-replay] no recorded read for ${key}`)
		return new Response(
			JSON.stringify({ error: { code: "NOT_RECORDED", message: key } }),
			{ status: 404, headers: { "content-type": "application/json" } },
		)
	}
	const answer = (read: RecordedRead): Response =>
		new Response(JSON.stringify(read.body), {
			status: read.status,
			headers: { "content-type": "application/json" },
		})
	const replay = async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const url = new URL(
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url,
		)
		const query: Record<string, string> = {}
		if ((init?.method ?? "GET").toUpperCase() === "POST") {
			const sent = JSON.parse(String(init?.body ?? "{}")) as Record<
				string,
				unknown
			>
			for (const name of ["query", "maxResults"]) {
				if (sent[name] !== undefined) {
					query[name] = String(sent[name])
				}
			}
			const path = url.pathname.replace(
				/^\/v1\/wiki\/search$/,
				"/v1/wiki/search",
			)
			const read =
				byKey.get(keyOf(path, query)) ??
				byKey.get(keyOf(path, { query: query.query ?? "" }))
			return read ? answer(read) : missing(keyOf(path, query))
		}
		for (const [name, value] of url.searchParams) {
			if (!PRINCIPAL_PARAMS.has(name)) {
				query[name] = value
			}
		}
		const key = keyOf(url.pathname, query)
		const read = byKey.get(key)
		return read ? answer(read) : missing(key)
	}
	return replay as typeof fetch
}

const RUN_READ = "/v1/run"
const RUN_STEP_READ = "/v1/run/step"

/** The run reads of a recording, as the page asked them. The run's record is
 * the proxy's own answer, not an upstream read, so a replay serves it as
 * recorded instead of running it through the proxy again. A recording made
 * before the run read existed has none, and replays as a server with no run
 * configured, which is what it was. */
export function createRecordedRun(
	recording: Recording,
): (url: URL) => Response | undefined {
	const answer = (status: number, body: unknown): Response =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		})
	return (url) => {
		if (url.pathname === `${PROXY_PREFIX}${RUN_READ}`) {
			const read = recording.reads.find((entry) => entry.path === RUN_READ)
			return read
				? answer(read.status, read.body)
				: answer(503, {
						error: {
							code: "RUN_NOT_CONFIGURED",
							message:
								"The pinned run's record is not configured on this server.",
						},
					})
		}
		if (url.pathname === `${PROXY_PREFIX}${RUN_STEP_READ}`) {
			const n = url.searchParams.get("n")
			const read = recording.reads.find(
				(entry) => entry.path === RUN_STEP_READ && entry.query.n === n,
			)
			return read
				? answer(read.status, read.body)
				: answer(404, {
						error: {
							code: "NOT_RECORDED",
							message: `no recorded step ${n}`,
						},
					})
		}
		return undefined
	}
}
