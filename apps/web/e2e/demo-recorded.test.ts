// The recording format: what the recorder keeps of the proxy's answers, what it
// refuses to keep, and how the e2e replays it as the upstream.
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { handleDemoRead } from "../lib/demo-data/proxy.js"
import {
	createRecordedUpstream,
	forbiddenFromEnv,
	identityFromEnv,
	readRecording,
	toRecording,
	writeRecording,
} from "./demo-recorded.js"
import { FIXTURE_ENV } from "./demo-upstream.js"

const seen = (
	path: string,
	body: unknown,
	status = 200,
): { url: URL; status: number; body: unknown } => ({
	url: new URL(`http://127.0.0.1:3040/api/demo${path}`),
	status,
	body,
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe("toRecording", () => {
	it("keeps the upstream path and query, never the origin, and the last answer to a repeated read", () => {
		const recording = toRecording(
			[
				seen("/v1/wiki?skip=0&limit=100", { pages: [1] }),
				seen("/v1/wiki?limit=100&skip=0", { pages: [2] }),
				seen("/v1/wiki/lint?limit=100", { unresolvedContradictions: [] }),
			],
			[],
		)
		expect(recording.reads).toEqual([
			{
				path: "/v1/wiki",
				query: { limit: "100", skip: "0" },
				status: 200,
				body: { pages: [2] },
			},
			{
				path: "/v1/wiki/lint",
				query: { limit: "100" },
				status: 200,
				body: { unresolvedContradictions: [] },
			},
		])
		expect(JSON.stringify(recording)).not.toContain("127.0.0.1")
	})

	it("scrubs the run's identity wherever the answer carries it", () => {
		const recording = toRecording(
			[
				seen("/v1/wiki/page-a", {
					scope: "workspace",
					scopeRef: "demo-run-8",
					agentId: "demo-run-8",
					editor: { id: "user-77", name: "Someone" },
					summary: "Seeded for demo-run-8 on a Monday.",
				}),
			],
			[],
			["demo-run-8"],
		)
		const text = JSON.stringify(recording)
		expect(text).not.toContain("demo-run-8")
		expect(text).not.toContain("user-77")
		expect(recording.reads[0]?.body).toMatchObject({
			scope: "workspace",
			scopeRef: "[recorded]",
			agentId: "[recorded]",
			editor: "[recorded]",
			summary: "Seeded for [recorded] on a Monday.",
		})
	})

	it("refuses to record an answer that holds the read key or an origin, without printing it", () => {
		const key = "sekret-read-key-0123456789"
		const origin = "http://127.0.0.1:3857"
		for (const leaked of [key, origin]) {
			let message = ""
			try {
				toRecording(
					[seen("/v1/wiki", { note: `see ${leaked}/v1` })],
					[key, origin],
				)
			} catch (error) {
				message = String(error)
			}
			expect(message).toMatch(/forbidden/)
			expect(message).not.toContain(key)
			expect(message).not.toContain(origin)
		}
	})

	it("refuses an answer that carries an authorization header's text", () => {
		expect(() =>
			toRecording([seen("/v1/wiki", { raw: "Bearer abcdef0123456789" })], []),
		).toThrow(/forbidden/)
	})
})

describe("forbiddenFromEnv", () => {
	it("lists the read key, the API origin and its host, and nothing that is unset", () => {
		expect(
			forbiddenFromEnv({
				MDBRAIN_DEMO_READ_KEY: "k-123456",
				MDBRAIN_DEMO_API_BASE_URL: "http://127.0.0.1:3857",
			}),
		).toEqual(["k-123456", "http://127.0.0.1:3857", "127.0.0.1:3857"])
		expect(forbiddenFromEnv({})).toEqual([])
	})
})

describe("identityFromEnv", () => {
	it("lists the slot's scope reference and agent, and nothing that is unset or empty", () => {
		expect(
			identityFromEnv({
				MDBRAIN_DEMO_SCOPE_REF: "demo-run-8",
				MDBRAIN_DEMO_AGENT_ID: "demo-run-8",
			}),
		).toEqual(["demo-run-8", "demo-run-8"])
		expect(identityFromEnv({ MDBRAIN_DEMO_SCOPE_REF: "" })).toEqual([])
	})
})

describe("a recording on disk", () => {
	it("round trips, and refuses a file that is not a recording", () => {
		const dir = mkdtempSync(join(tmpdir(), "demo-recording-"))
		try {
			const file = join(dir, "recording.json")
			const recording = toRecording([seen("/v1/wiki", { pages: [] })], [])
			writeRecording(file, recording)
			expect(readRecording(file)).toEqual(recording)
			writeRecording(file, { format: "other/1", reads: [] } as never)
			expect(() => readRecording(file)).toThrow(/not a demo recording/)
			expect(readFileSync(file, "utf8")).toContain("other/1")
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe("createRecordedUpstream", () => {
	const cited = (marker: string) =>
		`/v1/cite?${new URLSearchParams({ marker, citedBy: "[[wiki:accounts/a#claim-1@r1]]" })}`
	const known = "[[event:2586db50-1111-4222-8333-444455556666]]"
	const gone = "[[event:2586db50-1111-4222-8333-777788889999]]"
	const recording = toRecording(
		[
			seen("/v1/wiki?limit=100&skip=0", { pages: [{ slug: "a" }], total: 1 }),
			seen(cited(known), { status: "resolved" }),
			seen("/v1/wiki/search?query=renewal&maxResults=6", {
				results: [],
				total: 0,
			}),
			seen(
				cited(gone),
				{ error: { code: "CITATION_UNRESOLVED", message: "fixed" } },
				404,
			),
		],
		[],
	)

	async function viaProxy(path: string) {
		const upstream = createRecordedUpstream(recording)
		return handleDemoRead(
			new Request(`http://demo.local/api/demo${path}`),
			FIXTURE_ENV,
			upstream,
		)
	}

	it("answers a read the proxy forwards, whatever principal the proxy added", async () => {
		const response = await viaProxy("/v1/wiki?limit=100&skip=0")
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ pages: [{ slug: "a" }], total: 1 })
		const cite = await viaProxy(cited(known))
		expect(await cite.json()).toEqual({ status: "resolved" })
	})

	it("answers the governed question, which the proxy sends upstream as a POST", async () => {
		const response = await viaProxy(
			"/v1/wiki/search?query=renewal&maxResults=6",
		)
		expect(await response.json()).toEqual({ results: [], total: 0 })
	})

	it("replays a recorded failure with its status", async () => {
		const response = await viaProxy(cited(gone))
		expect(response.status).toBe(404)
	})

	it("fails loudly on a read that was not recorded, and says which", async () => {
		const warn = vi.spyOn(console, "error").mockImplementation(() => {})
		const response = await viaProxy("/v1/wiki/lint?limit=100")
		expect(response.status).toBe(502)
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("no recorded read for /v1/wiki/lint?limit=100"),
		)
	})
})
