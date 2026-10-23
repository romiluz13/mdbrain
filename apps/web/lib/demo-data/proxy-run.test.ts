import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { handleDemoRead, type DemoProxyEnv } from "./proxy.js"
import {
	readDemoRunEnv,
	type DemoRunEnv,
	type RunReadDeps,
} from "./proxy-run.js"
import { AGENT_ROLE_LABELS } from "./run-record.js"

const ENV: DemoProxyEnv = {
	apiBaseUrl: "http://upstream.test",
	readKey: "read-key-xyz-123",
	scope: "workspace",
	scopeRef: "demo-run-9",
	agentId: "demo-run-9",
}
const URI = "mongodb+srv://ctl-user:ctl-secret@cluster0.example.net/"
// The manifest's own id, which is not the scope reference or the agent id.
const RUN_ID = "live-check-b-2026-10-20T11-29-54.742Z"
const RUN: DemoRunEnv = { controlUri: URI, runId: RUN_ID }

function manifest(overrides: Record<string, unknown> = {}) {
	return {
		_id: RUN_ID,
		runId: RUN_ID,
		slotIndex: 9,
		scopeRef: "demo-run-9",
		agentId: "demo-run-9",
		state: "used",
		corpus: {
			sha256: "a".repeat(64),
			records: 9,
			eventsPlanned: 2,
			pagesPlanned: 1,
		},
		eventsWritten: [
			{ sourceId: "src-1", eventId: "evt-a" },
			{ sourceId: "src-2", eventId: "evt-b" },
		],
		pagesWritten: ["accounts/lantern-bay"],
		createdAt: "2026-10-20T09:35:00.000Z",
		agentRun: {
			state: "complete",
			startedAt: "2026-10-20T09:55:00.000Z",
			endedAt: "2026-10-20T09:59:00.000Z",
			stepsRecorded: 2,
			steps: [
				{
					n: 1,
					role: "support",
					name: "write event",
					detail: "src-9",
					eventId: "evt-s1",
				},
				{ n: 2, role: "account", name: "read page", eventId: "evt-s2" },
			],
		},
		...overrides,
	}
}

function deps(
	read: (runId: string) => Promise<unknown | null>,
	run: DemoRunEnv | null = RUN,
): RunReadDeps {
	return { run, manifest: read }
}

function request(path: string, init: RequestInit = {}): Request {
	return new Request(`http://demo.test${path}`, init)
}

const noUpstream = vi.fn(async () => new Response("{}", { status: 500 }))

async function bodyOf(response: Response) {
	return (await response.json()) as Record<string, unknown>
}

describe("readDemoRunEnv", () => {
	it("needs both the control URI and the run id", () => {
		expect(readDemoRunEnv({ MDBRAIN_DEMO_CONTROL_URI: URI })).toBeNull()
		expect(readDemoRunEnv({ MDBRAIN_DEMO_RUN_ID: RUN_ID })).toBeNull()
		expect(
			readDemoRunEnv({
				MDBRAIN_DEMO_CONTROL_URI: URI,
				MDBRAIN_DEMO_RUN_ID: RUN_ID,
			}),
		).toEqual(RUN)
	})

	it("takes a run id as the seeding driver writes it, with dots and colons", () => {
		for (const runId of [
			"live-check-b-2026-10-20T11-29-54.742Z",
			"seed-2026-10-20T11:29:54.742Z",
		]) {
			expect(
				readDemoRunEnv({
					MDBRAIN_DEMO_CONTROL_URI: URI,
					MDBRAIN_DEMO_RUN_ID: runId,
				}),
			).toEqual({ controlUri: URI, runId })
		}
	})

	it("refuses a URI that is not a MongoDB connection string and a run id that is not an id", () => {
		for (const [uri, runId] of [
			["https://example.net/", "demo-run-9"],
			["not a uri", "demo-run-9"],
			[URI, "demo run 9"],
			[URI, "../other"],
		] as const) {
			expect(
				readDemoRunEnv({
					MDBRAIN_DEMO_CONTROL_URI: uri,
					MDBRAIN_DEMO_RUN_ID: runId,
				}),
			).toBeNull()
		}
	})
})

describe("GET /api/demo/v1/run: the run's deadline", () => {
	const running = () =>
		manifest({
			agentRunState: "running",
			agentRun: { state: "running", startedAt: "2026-10-20T09:55:00.000Z" },
		})
	const read = async (nowIso: string) => {
		const response = await handleDemoRead(
			request("/api/demo/v1/run"),
			ENV,
			noUpstream,
			{
				...deps(async () => running()),
				deadline: { now: () => new Date(nowIso), ms: 335_000 },
			},
		)
		return (await bodyOf(response)).agentRun as Record<string, unknown>
	}

	it("reports a run still running past its deadline as incomplete", async () => {
		expect((await read("2026-10-20T10:00:36.000Z")).state).toBe("incomplete")
	})

	it("keeps a run running inside its deadline", async () => {
		expect((await read("2026-10-20T09:58:00.000Z")).state).toBe("running")
	})
})

describe("GET /api/demo/v1/run", () => {
	it("answers the public record of the pinned run, read by its id alone", async () => {
		const read = vi.fn(async () => manifest())
		const response = await handleDemoRead(
			request("/api/demo/v1/run"),
			ENV,
			noUpstream,
			deps(read),
		)
		expect(response.status).toBe(200)
		expect(read).toHaveBeenCalledOnce()
		expect(read).toHaveBeenCalledWith(RUN_ID)
		const body = await bodyOf(response)
		expect(body.eventsPlanned).toBe(2)
		expect(body.arrivals).toEqual([
			{ sourceId: "src-1", eventId: "evt-a" },
			{ sourceId: "src-2", eventId: "evt-b" },
		])
		const text = JSON.stringify(body)
		for (const private_ of [
			"demo-run-9",
			RUN_ID,
			URI,
			"ctl-secret",
			"a".repeat(64),
		]) {
			expect(text).not.toContain(private_)
		}
		expect(noUpstream).not.toHaveBeenCalled()
	})

	it("takes no parameters from the browser", async () => {
		const read = vi.fn(async () => manifest())
		for (const query of [
			"?runId=demo-run-8",
			"?filter=%7B%7D",
			"?_id=demo-run-8",
			"?n=1",
		]) {
			const response = await handleDemoRead(
				request(`/api/demo/v1/run${query}`),
				ENV,
				noUpstream,
				deps(read),
			)
			expect(response.status).toBe(400)
			expect((await bodyOf(response)).error).toMatchObject({
				code: "UNKNOWN_PARAMETER",
			})
		}
		expect(read).not.toHaveBeenCalled()
	})

	it("only answers GET", async () => {
		const read = vi.fn(async () => manifest())
		const response = await handleDemoRead(
			request("/api/demo/v1/run", { method: "POST" }),
			ENV,
			noUpstream,
			deps(read),
		)
		expect(response.status).toBe(405)
		expect(read).not.toHaveBeenCalled()
	})

	it("says the run is not configured, and the other reads keep working", async () => {
		const read = vi.fn(async () => manifest())
		const missing = await handleDemoRead(
			request("/api/demo/v1/run"),
			ENV,
			noUpstream,
			deps(read, null),
		)
		expect(missing.status).toBe(503)
		expect(await bodyOf(missing)).toEqual({
			error: {
				code: "RUN_NOT_CONFIGURED",
				message: "The pinned run's record is not configured on this server.",
			},
		})
		expect(read).not.toHaveBeenCalled()
		const upstream = vi.fn(
			async () =>
				new Response(JSON.stringify({ pages: [], total: 0 }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		)
		const wiki = await handleDemoRead(
			request("/api/demo/v1/wiki?limit=1"),
			ENV,
			upstream,
			deps(read, null),
		)
		expect(wiki.status).toBe(200)
	})

	it("answers a fixed envelope when no manifest is stored", async () => {
		const response = await handleDemoRead(
			request("/api/demo/v1/run"),
			ENV,
			noUpstream,
			deps(async () => null),
		)
		expect(response.status).toBe(404)
		expect(await bodyOf(response)).toEqual({
			error: {
				code: "RUN_NOT_FOUND",
				message: "The pinned run has no stored record.",
			},
		})
	})

	it("refuses a manifest of another scope or agent with a fixed code", async () => {
		for (const other of [
			{ scopeRef: "demo-run-8" },
			{ agentId: "demo-run-8" },
		]) {
			const response = await handleDemoRead(
				request("/api/demo/v1/run"),
				ENV,
				noUpstream,
				deps(async () => manifest(other)),
			)
			expect(response.status).toBe(502)
			const body = await bodyOf(response)
			expect(body.error).toMatchObject({ code: "RUN_RECORD_MISMATCH" })
			expect(JSON.stringify(body)).not.toContain("demo-run-8")
		}
	})

	it("answers a fixed envelope for a document that is not a manifest", async () => {
		const response = await handleDemoRead(
			request("/api/demo/v1/run"),
			ENV,
			noUpstream,
			deps(async () => ({ state: "exploded" })),
		)
		expect(response.status).toBe(502)
		expect((await bodyOf(response)).error).toMatchObject({
			code: "RUN_RECORD_MALFORMED",
		})
	})

	it("answers unreachable without the driver's text, the URI or the host", async () => {
		const response = await handleDemoRead(
			request("/api/demo/v1/run"),
			ENV,
			noUpstream,
			deps(async () => {
				throw new Error(
					`getaddrinfo ENOTFOUND cluster0.example.net while connecting with ${URI}`,
				)
			}),
		)
		expect(response.status).toBe(502)
		const text = await response.text()
		expect(JSON.parse(text)).toEqual({
			error: {
				code: "RUN_UNREACHABLE",
				message: "The pinned run's record could not be read.",
			},
		})
		for (const leaked of ["cluster0", "ctl-secret", "ENOTFOUND", "mongodb"]) {
			expect(text).not.toContain(leaked)
		}
	})
})

describe("the run's steps", () => {
	it("are not a read of their own: the record names each step's event, and cite confirms it by id", async () => {
		const read = vi.fn(async () => manifest())
		const response = await handleDemoRead(
			request("/api/demo/v1/run/step?n=1"),
			ENV,
			noUpstream,
			deps(read),
		)
		expect(response.status).toBe(404)
		expect(read).not.toHaveBeenCalled()
		expect(noUpstream).not.toHaveBeenCalled()
	})
})

describe("role labels", () => {
	it("match the labels the demo agents are configured with", () => {
		const config = readFileSync(
			join(__dirname, "../../../demo-agents/src/agents/config.ts"),
			"utf8",
		)
		for (const [role, label] of Object.entries(AGENT_ROLE_LABELS)) {
			expect(config).toContain(`${role}: "${label}"`)
		}
	})
})
