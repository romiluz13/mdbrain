// GET /v1/wiki/changes — the what-changed-since feed route.
//
// The engine is mocked, so these tests pin the HTTP contract: validation, the
// scope and governance context taken from the principal, error shapes and
// citation markers. The window, paging and governance of the feed itself are
// covered by the engine's own tests; the reserved slug is in
// changes-slug-routes.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const prevEnv = { ...process.env }

const wikiMocks = vi.hoisted(() => ({
	getWikiChanges: vi.fn(),
}))

const storeMocks = vi.hoisted(() => ({
	getWikiStoreHandle: vi.fn(),
}))

vi.mock("@mdbrain/wiki-engine", async (importOriginal) => ({
	...(await importOriginal<typeof import("@mdbrain/wiki-engine")>()),
	...wikiMocks,
}))
vi.mock("./wiki-store-runtime.js", () => ({ ...storeMocks }))

import {
	WikiChangesRequestError,
	WikiChangesScanError,
} from "@mdbrain/wiki-engine"
import { createApp } from "./app.js"

type Json = {
	error?: { code: string; message: string }
	[key: string]: unknown
}
const asJson = (res: Response) => res.json() as Promise<Json>

beforeEach(() => {
	process.env = { ...prevEnv }
	for (const mock of Object.values(wikiMocks)) mock.mockReset()
	for (const mock of Object.values(storeMocks)) mock.mockReset()
	storeMocks.getWikiStoreHandle.mockResolvedValue({ db: {}, prefix: "t_" })
})

afterEach(() => {
	process.env = { ...prevEnv }
})

const SCOPE_QUERY = "scope=workspace&scopeRef=ws-1"
const SINCE = "2026-10-01T00:00:00.000Z"

const getChanges = (query: string, headers: Record<string, string> = {}) =>
	createApp().request(`/v1/wiki/changes?${query}`, { headers })

const claimOf = (id: string, text: string, extra = {}) => ({
	id,
	text,
	status: "active",
	evidence: [],
	...extra,
})

const windowAndLimits = {
	window: {
		since: SINCE,
		until: "2026-10-01T11:00:00.000Z",
		settled: true,
	},
	limits: { limit: 25, maxClaims: 10 },
	hasMore: false,
}

const counts = (added: number, changed: number, removed: number) => ({
	added,
	changed,
	removed,
})

describe("GET /v1/wiki/changes", () => {
	it("returns the engine's page with a citation marker on every claim it shows, each at the revision it was read from", async () => {
		wikiMocks.getWikiChanges.mockResolvedValue({
			...windowAndLimits,
			changes: [
				{
					pageSlug: "accounts/acme",
					revision: 1,
					editKind: "create",
					createdAt: "2026-10-01T02:00:00.000Z",
					baseline: "none",
					baselineRevision: null,
					claims: {
						added: [claimOf("k1", "Acme is a customer.")],
						changed: [],
						removed: [],
						counts: counts(1, 0, 0),
						truncated: false,
					},
				},
				{
					pageSlug: "accounts/acme",
					revision: 3,
					editKind: "update",
					createdAt: "2026-10-01T03:00:00.000Z",
					baseline: "previous",
					baselineRevision: 2,
					claims: {
						added: [claimOf("k3", "New.")],
						changed: [
							{
								id: "k1",
								fields: ["text"],
								before: claimOf("k1", "Old."),
								after: claimOf("k1", "New text."),
							},
						],
						removed: [claimOf("k2", "Gone.")],
						counts: counts(1, 1, 1),
						truncated: false,
					},
				},
				{
					pageSlug: "accounts/old",
					revision: 5,
					editKind: "delete",
					createdAt: "2026-10-01T04:00:00.000Z",
					baseline: "none",
					baselineRevision: null,
					claims: {
						added: [],
						changed: [],
						removed: [claimOf("z1", "Held at deletion.")],
						counts: counts(0, 0, 1),
						truncated: false,
					},
				},
				{
					pageSlug: "accounts/unreadable-before",
					revision: 2,
					editKind: "update",
					createdAt: "2026-10-01T05:00:00.000Z",
					baseline: "unavailable",
					baselineRevision: null,
					claims: null,
				},
			],
		})

		const res = await getChanges(`${SCOPE_QUERY}&since=${SINCE}`)
		const json = (await asJson(res)) as unknown as {
			changes: Array<{
				claims: null | {
					added: Array<{ marker?: string }>
					changed: Array<{
						before: { marker?: string }
						after: { marker?: string }
					}>
					removed: Array<{ marker?: string }>
				}
			}>
			window: unknown
			limits: unknown
		}

		expect(res.status).toBe(200)
		const [created, updated, deleted, unavailable] = json.changes
		expect(created?.claims?.added[0]?.marker).toBe(
			"[[wiki:accounts/acme#k1@r1]]",
		)
		expect(updated?.claims?.added[0]?.marker).toBe(
			"[[wiki:accounts/acme#k3@r3]]",
		)
		expect(updated?.claims?.changed[0]?.before.marker).toBe(
			"[[wiki:accounts/acme#k1@r2]]",
		)
		expect(updated?.claims?.changed[0]?.after.marker).toBe(
			"[[wiki:accounts/acme#k1@r3]]",
		)
		expect(updated?.claims?.removed[0]?.marker).toBe(
			"[[wiki:accounts/acme#k2@r2]]",
		)
		expect(deleted?.claims?.removed[0]?.marker).toBe(
			"[[wiki:accounts/old#z1@r5]]",
		)
		expect(unavailable?.claims).toBeNull()
		expect(json.window).toEqual(windowAndLimits.window)
		expect(json.limits).toEqual(windowAndLimits.limits)
	})

	it("hands the engine the window as dates, the page size and the cursor, in the request's scope", async () => {
		wikiMocks.getWikiChanges.mockResolvedValue({
			...windowAndLimits,
			changes: [],
		})

		await getChanges(
			`${SCOPE_QUERY}&since=2026-10-01T00:00:00.000Z&until=2026-10-01T10:30:00%2B02:00&limit=7&maxClaims=3&cursor=abc`,
		)

		const params = wikiMocks.getWikiChanges.mock.calls[0]?.[1]
		expect(params).toMatchObject({
			scope: "workspace",
			scopeRef: "ws-1",
			limit: 7,
			maxClaims: 3,
			cursor: "abc",
		})
		expect(params.since).toEqual(new Date("2026-10-01T00:00:00.000Z"))
		expect(params.until).toEqual(new Date("2026-10-01T08:30:00.000Z"))
	})

	it("leaves out what was not given, so the engine applies its defaults and freezes until", async () => {
		wikiMocks.getWikiChanges.mockResolvedValue({
			...windowAndLimits,
			changes: [],
		})

		await getChanges(`${SCOPE_QUERY}&since=${SINCE}`)

		const params = wikiMocks.getWikiChanges.mock.calls[0]?.[1]
		expect(params.until).toBeUndefined()
		expect(params.cursor).toBeUndefined()
		expect(params.limit).toBeUndefined()
		expect(params.maxClaims).toBeUndefined()
	})

	it("hands a value above the maximum to the engine, which clamps and discloses it", async () => {
		wikiMocks.getWikiChanges.mockResolvedValue({
			...windowAndLimits,
			changes: [],
		})

		const res = await getChanges(`${SCOPE_QUERY}&since=${SINCE}&limit=100000`)

		expect(res.status).toBe(200)
		expect(wikiMocks.getWikiChanges.mock.calls[0]?.[1].limit).toBe(100000)
	})

	it("passes the caller's own trust tier, roles and groups as the governance context", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "exec",
				scopes: ["workspace"],
				scopeRefs: ["ws-1"],
				trustTier: "standard",
				roles: ["exec"],
				departments: ["fin"],
				capabilities: ["read"],
			},
		])
		wikiMocks.getWikiChanges.mockResolvedValue({
			...windowAndLimits,
			changes: [],
		})

		await getChanges(`${SCOPE_QUERY}&since=${SINCE}`, {
			Authorization: "Bearer exec",
		})

		expect(
			wikiMocks.getWikiChanges.mock.calls[0]?.[1].governance,
		).toMatchObject({
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			roles: ["exec"],
			departments: ["fin"],
		})
	})

	it("refuses a caller who holds no grant for the scope, without asking the engine", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "ws1-only",
				scopes: ["workspace"],
				scopeRefs: ["ws-1"],
				capabilities: ["read"],
			},
		])

		const res = await getChanges(
			`scope=workspace&scopeRef=ws-2&since=${SINCE}`,
			{ Authorization: "Bearer ws1-only" },
		)

		expect(res.status).toBe(403)
		expect(wikiMocks.getWikiChanges).not.toHaveBeenCalled()
	})

	it("requires a scope", async () => {
		const res = await getChanges(`since=${SINCE}`)

		expect(res.status).toBe(400)
		expect((await asJson(res)).error?.code).toBe("VALIDATION_ERROR")
		expect(wikiMocks.getWikiChanges).not.toHaveBeenCalled()
	})

	it("answers 400 with the engine's reason when the request does not hold together", async () => {
		wikiMocks.getWikiChanges.mockRejectedValue(
			new WikiChangesRequestError("cursor is not valid"),
		)

		const res = await getChanges(`${SCOPE_QUERY}&cursor=garbage`)
		const json = await asJson(res)

		expect(res.status).toBe(400)
		expect(json.error).toEqual({
			code: "VALIDATION_ERROR",
			message: "cursor is not valid",
		})
	})

	it.each([
		["an engine failure", new Error("db down"), "db down"],
		[
			"a scan that found nothing readable",
			new WikiChangesScanError(),
			"the changes feed could not find a readable revision within its scan limit",
		],
	])("reports %s as 500 WIKI_CHANGES_FAILED", async (_name, error, message) => {
		wikiMocks.getWikiChanges.mockRejectedValue(error)

		const res = await getChanges(`${SCOPE_QUERY}&since=${SINCE}`)

		expect(res.status).toBe(500)
		expect((await asJson(res)).error).toEqual({
			code: "WIKI_CHANGES_FAILED",
			message,
		})
	})

	describe("validation", () => {
		beforeEach(() => {
			wikiMocks.getWikiChanges.mockResolvedValue({
				...windowAndLimits,
				changes: [],
			})
		})

		it.each([
			["since", "yesterday"],
			["since", "2026-10-01"],
			["since", "2026-10-01T10:00:00"],
			["since", "2026-13-01T10:00:00Z"],
			["since", "2026-10-01T10:00:00%2002:00"],
			["until", "tomorrow"],
			["until", "1700000000"],
			["limit", "abc"],
			["limit", "1.5"],
			["limit", "0"],
			["limit", "-3"],
			["maxClaims", "0"],
			["maxClaims", ""],
			["cursor", ""],
		])("answers 400 naming the parameter for %s=%s", async (name, value) => {
			const base = name === "since" ? "" : `since=${SINCE}&`
			const res = await getChanges(`${SCOPE_QUERY}&${base}${name}=${value}`)
			const json = await asJson(res)

			expect(res.status).toBe(400)
			expect(json.error?.code).toBe("VALIDATION_ERROR")
			expect(json.error?.message).toContain(name)
			expect(wikiMocks.getWikiChanges).not.toHaveBeenCalled()
		})

		it.each([
			"2026-10-01T10:00:00Z",
			"2026-10-01T10:00Z",
			"2026-10-01T10:00:00.5Z",
			"2026-10-01T10:00:00.123%2B05:30",
			"2026-10-01T10:00:00-07:00",
		])("accepts the ISO 8601 instant %s", async (instant) => {
			const res = await getChanges(`${SCOPE_QUERY}&since=${instant}`)

			expect(res.status).toBe(200)
		})
	})
})
