// GET /v1/cite — the citation resolver.
//
// The route and the engine's real revision lookup and governance run against a
// fake revisions collection, so "hidden by that revision's own permissions" is
// decided by the shipped filter, not by a mock. Only the store handle and the
// memory bridge's recall are replaced.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const prevEnv = { ...process.env }

const bridge = vi.hoisted(() => ({ mdbrainBridgeSearch: vi.fn() }))
const store = vi.hoisted(() => ({
	getWikiStoreHandle: vi.fn(),
	withWikiTransaction: vi.fn(),
}))

vi.mock("@mdbrain/memory-bridge", async (importOriginal) => ({
	...(await importOriginal<typeof import("@mdbrain/memory-bridge")>()),
	...bridge,
}))
vi.mock("./wiki-store-runtime.js", () => ({ ...store }))

import { createApp } from "./app.js"

type RevisionDoc = {
	pageSlug: string
	scope: string
	scopeRef: string
	revision: number
	editKind: "create" | "update" | "delete"
	snapshot: Record<string, unknown>
	createdAt: Date
}

type Claim = {
	id: string
	text: string
	status: string
	evidence: Array<Record<string, unknown>>
	updatedAt: Date
}

let revisions: RevisionDoc[]
let lookups: Array<Record<string, unknown>>

function claim(
	id: string,
	text: string,
	evidence: Claim["evidence"] = [],
): Claim {
	return {
		id,
		text,
		status: "active",
		evidence,
		updatedAt: new Date("2026-09-30T10:00:00.000Z"),
	}
}

function revision(
	scopeRef: string,
	revisionNumber: number,
	claims: Claim[],
	extra: Record<string, unknown> = {},
	slug = "accounts/halvorsen",
): RevisionDoc {
	return {
		pageSlug: slug,
		scope: "workspace",
		scopeRef,
		revision: revisionNumber,
		editKind: revisionNumber === 1 ? "create" : "update",
		snapshot: {
			slug,
			title: "Halvorsen Freight Group",
			scope: "workspace",
			scopeRef,
			revision: revisionNumber,
			claims,
			...extra,
		},
		createdAt: new Date(`2026-10-0${revisionNumber}T09:00:00.000Z`),
	}
}

const fakeDb = {
	collection: () => ({
		findOne: async (filter: Record<string, unknown>) => {
			lookups.push(filter)
			return revisions.find(
				(doc) =>
					doc.pageSlug === filter.pageSlug &&
					doc.scope === filter.scope &&
					doc.scopeRef === filter.scopeRef &&
					doc.revision === filter.revision,
			)
		},
	}),
}

const marker = (slug: string, claimId: string, rev: number) =>
	`[[wiki:${slug}#${claimId}@r${rev}]]`

function cite(
	markerText: string | undefined,
	options: {
		scopeRef?: string
		token?: string
		extra?: string
		citedBy?: string
		agentId?: string
	} = {},
) {
	const params = new URLSearchParams({
		scope: "workspace",
		scopeRef: options.scopeRef ?? "ws-1",
	})
	if (markerText !== undefined) params.set("marker", markerText)
	if (options.citedBy !== undefined) params.set("citedBy", options.citedBy)
	if (options.agentId !== undefined) params.set("agentId", options.agentId)
	const headers: Record<string, string> = options.token
		? { Authorization: `Bearer ${options.token}` }
		: {}
	return createApp().request(`/v1/cite?${params}${options.extra ?? ""}`, {
		headers,
	})
}

async function notFoundBody(res: Response): Promise<string> {
	expect(res.status).toBe(404)
	const raw = await res.text()
	expect(JSON.parse(raw).error.code).toBe("CITATION_NOT_FOUND")
	return raw
}

type CiteBody = {
	status?: string
	kind?: string
	marker?: string
	citedBy?: string
	event?: Record<string, unknown>
	page?: { slug?: string; title?: string; revision?: number }
	claim?: { id?: string; text?: string; evidence?: unknown[] }
	error?: { code: string; message: string }
}

beforeEach(() => {
	process.env = { ...prevEnv }
	revisions = []
	lookups = []
	bridge.mdbrainBridgeSearch.mockReset()
	store.getWikiStoreHandle.mockReset()
	store.getWikiStoreHandle.mockResolvedValue({ db: fakeDb, prefix: "t_" })
})

afterEach(() => {
	process.env = { ...prevEnv }
})

describe("GET /v1/cite for a claim marker", () => {
	it("resolves to the claim's text and evidence as stored at that revision", async () => {
		revisions.push(
			revision("ws-1", 1, [
				claim("renewal", "Halvorsen's renewal is at risk.", [
					{ kind: "event", sourceId: "evt-1", note: "ETA recovery plan" },
				]),
			]),
		)

		const res = await cite(marker("accounts/halvorsen", "renewal", 1))

		expect(res.status).toBe(200)
		const body = (await res.json()) as CiteBody
		expect(body).toMatchObject({
			status: "resolved",
			kind: "claim",
			marker: marker("accounts/halvorsen", "renewal", 1),
			page: { slug: "accounts/halvorsen", revision: 1 },
			claim: {
				id: "renewal",
				text: "Halvorsen's renewal is at risk.",
				evidence: [
					{ kind: "event", sourceId: "evt-1", note: "ETA recovery plan" },
				],
			},
		})
	})

	it("still resolves an edited claim's old revision to the old text", async () => {
		revisions.push(
			revision("ws-1", 1, [claim("renewal", "The renewal is at risk.")]),
			revision("ws-1", 2, [claim("renewal", "The renewal is confirmed.")]),
		)

		const oldMarker = await cite(marker("accounts/halvorsen", "renewal", 1))
		const newMarker = await cite(marker("accounts/halvorsen", "renewal", 2))

		expect(((await oldMarker.json()) as CiteBody).claim?.text).toBe(
			"The renewal is at risk.",
		)
		expect(((await newMarker.json()) as CiteBody).claim?.text).toBe(
			"The renewal is confirmed.",
		)
	})

	it("never falls back to newer content when the named revision does not exist", async () => {
		revisions.push(revision("ws-1", 2, [claim("renewal", "Newer text.")]))

		const res = await cite(marker("accounts/halvorsen", "renewal", 1))

		expect(await notFoundBody(res)).not.toContain("Newer text")
		expect(lookups).toHaveLength(1)
		expect(lookups[0]).toMatchObject({ revision: 1 })
	})

	it("does not resolve a claim that was not on the page at that revision", async () => {
		revisions.push(
			revision("ws-1", 1, [claim("renewal", "Early text.")]),
			revision("ws-1", 2, [
				claim("renewal", "Early text."),
				claim("champion", "The champion left."),
			]),
		)

		const res = await cite(marker("accounts/halvorsen", "champion", 1))

		expect(await notFoundBody(res)).not.toContain("champion left")
	})

	it("takes the scope from the request, so colliding ids in two scopes stay apart", async () => {
		revisions.push(
			revision("ws-1", 1, [claim("renewal", "Scope one text.")]),
			revision("ws-2", 1, [claim("renewal", "Scope two text.")]),
		)
		const same = marker("accounts/halvorsen", "renewal", 1)

		const one = (await (
			await cite(same, { scopeRef: "ws-1" })
		).json()) as CiteBody
		const two = (await (
			await cite(same, { scopeRef: "ws-2" })
		).json()) as CiteBody

		expect(one.claim?.text).toBe("Scope one text.")
		expect(two.claim?.text).toBe("Scope two text.")
	})

	it("answers a caller who holds no grant for the scope with 403 and no content", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "ws1-only",
				scopes: ["workspace"],
				scopeRefs: ["ws-1"],
				capabilities: ["read"],
			},
		])
		revisions.push(
			revision("ws-1", 1, [claim("renewal", "Scope one text.")]),
			revision("ws-2", 1, [claim("renewal", "Scope two text.")]),
		)
		const same = marker("accounts/halvorsen", "renewal", 1)

		const denied = await cite(same, { scopeRef: "ws-2", token: "ws1-only" })
		const allowed = await cite(same, { scopeRef: "ws-1", token: "ws1-only" })

		expect(denied.status).toBe(403)
		expect(await denied.text()).not.toContain("Scope two text")
		expect(((await allowed.json()) as CiteBody).claim?.text).toBe(
			"Scope one text.",
		)
		expect(lookups.every((filter) => filter.scopeRef === "ws-1")).toBe(true)
	})

	it("cannot be steered to another scope by text inside the marker", async () => {
		revisions.push(
			revision("ws-2", 1, [claim("renewal", "Scope two text.")], {}, "x"),
		)

		const res = await cite("[[wiki:x%3FscopeRef%3Dws-2#renewal@r1]]")

		await notFoundBody(res)
		expect(lookups).toHaveLength(1)
		expect(lookups.every((filter) => filter.scopeRef === "ws-1")).toBe(true)
	})

	describe("with a revision that was restricted when it was written", () => {
		beforeEach(() => {
			process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
				{
					token: "plain",
					scopes: ["workspace"],
					scopeRefs: ["ws-1"],
					trustTier: "standard",
					capabilities: ["read"],
				},
				{
					token: "exec",
					scopes: ["workspace"],
					scopeRefs: ["ws-1"],
					trustTier: "standard",
					roles: ["exec"],
					capabilities: ["read"],
				},
			])
			revisions.push(
				revision("ws-1", 1, [claim("renewal", "Confidential draft text.")], {
					permissions: { privacyTier: "confidential", allowedRoles: ["exec"] },
				}),
				revision("ws-1", 2, [claim("renewal", "Published text.")], {
					permissions: { privacyTier: "internal" },
				}),
			)
		})

		it("answers the hidden revision exactly like a missing one, with no content", async () => {
			const hidden = await cite(marker("accounts/halvorsen", "renewal", 1), {
				token: "plain",
			})
			const missing = await cite(marker("accounts/halvorsen", "renewal", 9), {
				token: "plain",
			})

			const hiddenBody = await notFoundBody(hidden)
			expect(hiddenBody).toBe(await notFoundBody(missing))
			expect(hiddenBody).not.toContain("Confidential")
			expect(lookups).toHaveLength(2)
		})

		it("shows that revision to a caller its own permissions allow, and the open one to everyone", async () => {
			const exec = await cite(marker("accounts/halvorsen", "renewal", 1), {
				token: "exec",
			})
			const plain = await cite(marker("accounts/halvorsen", "renewal", 2), {
				token: "plain",
			})

			expect(((await exec.json()) as CiteBody).claim?.text).toBe(
				"Confidential draft text.",
			)
			expect(((await plain.json()) as CiteBody).claim?.text).toBe(
				"Published text.",
			)
		})
	})

	it("keeps resolving an earlier revision after the page was deleted", async () => {
		revisions.push(
			revision("ws-1", 1, [claim("renewal", "Text before deletion.")]),
			{
				...revision("ws-1", 2, [claim("renewal", "Text before deletion.")]),
				editKind: "delete",
			},
		)

		const res = await cite(marker("accounts/halvorsen", "renewal", 1))

		expect(res.status).toBe(200)
		expect(((await res.json()) as CiteBody).claim?.text).toBe(
			"Text before deletion.",
		)
	})

	it.each([
		["a missing marker", undefined],
		["an empty marker", ""],
		["plain text", "the Halvorsen renewal"],
		["a marker with surrounding text", "see [[wiki:a#b@r1]] here"],
		["revision zero", "[[wiki:a#b@r0]]"],
		["an unencoded delimiter", "[[wiki:a#b#c@r1]]"],
		["a bad percent escape", "[[wiki:a%ZZ#b@r1]]"],
		["an unknown kind", "[[doc:a#b@r1]]"],
	])("answers %s with 400 and does not touch the store", async (_name, text) => {
		const res = await cite(text)

		expect(res.status).toBe(400)
		const body = (await res.json()) as CiteBody
		expect(body.error?.code).toBe("INVALID_MARKER")
		expect(store.getWikiStoreHandle).not.toHaveBeenCalled()
	})
})

describe("GET /v1/cite for an event marker", () => {
	const NOTE =
		"Tobias asked for a written ETA recovery plan before the November signature."
	const citing = marker("accounts/halvorsen", "renewal", 1)
	const recalled = (extra: Record<string, unknown> = {}) => ({
		canonicalId: "event:evt-1",
		text: `User: ${NOTE}`,
		timestamp: "2026-09-28T08:30:00.000Z",
		scope: "workspace",
		scopeRef: "ws-1",
		...extra,
	})

	beforeEach(() => {
		revisions.push(
			revision("ws-1", 1, [
				claim("renewal", "The renewal is at risk.", [
					{ kind: "event", sourceId: "evt-1", note: NOTE },
					{ kind: "event", sourceId: "evt-2" },
					{ kind: "manual", sourceId: "evt-3", note: "A manual note." },
				]),
			]),
			revision("ws-1", 2, [
				claim("renewal", "The renewal is at risk.", [
					{
						kind: "event",
						sourceId: "evt-1",
						note: "A later, different excerpt.",
					},
				]),
			]),
		)
		bridge.mdbrainBridgeSearch.mockResolvedValue({ results: [recalled()] })
	})

	it("resolves through governed recall under the request's agent and scope, queried with the evidence excerpt", async () => {
		const res = await cite("[[event:evt-1]]", {
			citedBy: citing,
			agentId: "agent-7",
		})

		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({
			status: "resolved",
			kind: "event",
			marker: "[[event:evt-1]]",
			citedBy: citing,
			event: {
				eventId: "evt-1",
				canonicalId: "event:evt-1",
				text: `User: ${NOTE}`,
				timestamp: "2026-09-28T08:30:00.000Z",
			},
		})
		expect(bridge.mdbrainBridgeSearch).toHaveBeenCalledTimes(1)
		expect(bridge.mdbrainBridgeSearch).toHaveBeenCalledWith(
			expect.objectContaining({
				query: NOTE,
				agentId: "agent-7",
				scope: "workspace",
				scopeRef: "ws-1",
			}),
		)
	})

	it("uses the excerpt recorded at the revision the citing marker names", async () => {
		await cite("[[event:evt-1]]", {
			citedBy: marker("accounts/halvorsen", "renewal", 2),
		})

		expect(bridge.mdbrainBridgeSearch).toHaveBeenCalledWith(
			expect.objectContaining({ query: "A later, different excerpt." }),
		)
	})

	it("accepts only a result whose canonicalId is exactly event:ID", async () => {
		bridge.mdbrainBridgeSearch.mockResolvedValue({
			results: [
				recalled({ canonicalId: "event:evt-10", text: "Other event ten" }),
				recalled({ canonicalId: "event:evt-1x", text: "Other event x" }),
				recalled({ canonicalId: "evt-1", text: "Bare id" }),
				recalled({ canonicalId: "event:evt-1 ", text: "Trailing space" }),
				recalled({ canonicalId: "Event:evt-1", text: "Wrong case" }),
			],
		})

		const res = await cite("[[event:evt-1]]", { citedBy: citing })

		expect(res.status).toBe(404)
		const raw = await res.text()
		expect(JSON.parse(raw).error.code).toBe("CITATION_UNRESOLVED")
		for (const leaked of ["Other event", "Bare id", "Trailing", "Wrong case"]) {
			expect(raw).not.toContain(leaked)
		}
	})

	it("picks the exact match out of near misses", async () => {
		bridge.mdbrainBridgeSearch.mockResolvedValue({
			results: [
				recalled({ canonicalId: "event:evt-10", text: "Other event ten" }),
				recalled(),
			],
		})

		const body = (await (
			await cite("[[event:evt-1]]", { citedBy: citing })
		).json()) as CiteBody

		expect(body.event?.text).toBe(`User: ${NOTE}`)
	})

	it("leaves a deleted source unresolved", async () => {
		bridge.mdbrainBridgeSearch.mockResolvedValue({ results: [] })

		const res = await cite("[[event:evt-1]]", { citedBy: citing })

		expect(res.status).toBe(404)
		expect(((await res.json()) as CiteBody).error?.code).toBe(
			"CITATION_UNRESOLVED",
		)
	})

	it("ignores an exact match that recall reports from another scope", async () => {
		bridge.mdbrainBridgeSearch.mockResolvedValue({
			results: [recalled({ scopeRef: "ws-2", text: "Other scope text" })],
		})

		const res = await cite("[[event:evt-1]]", { citedBy: citing })

		expect(res.status).toBe(404)
		const raw = await res.text()
		expect(JSON.parse(raw).error.code).toBe("CITATION_UNRESOLVED")
		expect(raw).not.toContain("Other scope text")
	})

	it("reports a throttled recall as retryable, not as a missing source", async () => {
		bridge.mdbrainBridgeSearch.mockResolvedValue({
			results: [],
			degradation: { kind: "throttled", scope: "denied", retryAfterMs: 2500 },
		})

		const res = await cite("[[event:evt-1]]", { citedBy: citing })

		expect(res.status).toBe(503)
		const body = (await res.json()) as CiteBody & {
			error: { retryable?: boolean }
		}
		expect(body.error.code).toBe("CITATION_RECALL_DEGRADED")
		expect(body.error.retryable).toBe(true)
	})

	it("does not call a recall failure unresolved", async () => {
		bridge.mdbrainBridgeSearch.mockRejectedValue(new Error("memongo down"))

		const res = await cite("[[event:evt-1]]", { citedBy: citing })

		expect(res.status).toBeGreaterThanOrEqual(500)
		expect(((await res.json()) as CiteBody).error?.code).not.toBe(
			"CITATION_UNRESOLVED",
		)
	})

	it("needs the claim that cites it", async () => {
		const res = await cite("[[event:evt-1]]")

		expect(res.status).toBe(400)
		expect(((await res.json()) as CiteBody).error?.code).toBe("INVALID_MARKER")
		expect(bridge.mdbrainBridgeSearch).not.toHaveBeenCalled()
		expect(store.getWikiStoreHandle).not.toHaveBeenCalled()
	})

	it.each([
		["an event marker", "[[event:evt-1]]"],
		["plain text", "the renewal claim"],
		["a malformed claim marker", "[[wiki:a#b@r0]]"],
	])("rejects %s as the citing claim", async (_name, citedBy) => {
		const res = await cite("[[event:evt-1]]", { citedBy })

		expect(res.status).toBe(400)
		expect(((await res.json()) as CiteBody).error?.code).toBe("INVALID_MARKER")
		expect(bridge.mdbrainBridgeSearch).not.toHaveBeenCalled()
	})

	it.each([
		["a claim that does not cite the event", "[[event:evt-9]]"],
		["evidence without an excerpt", "[[event:evt-2]]"],
		["evidence that is not an event", "[[event:evt-3]]"],
	])("leaves %s unresolved without searching", async (_name, eventMarker) => {
		const res = await cite(eventMarker, { citedBy: citing })

		expect(res.status).toBe(404)
		expect(((await res.json()) as CiteBody).error?.code).toBe(
			"CITATION_UNRESOLVED",
		)
		expect(bridge.mdbrainBridgeSearch).not.toHaveBeenCalled()
	})

	it("answers a citing claim that is missing or hidden like any missing citation, without searching", async () => {
		const missing = await cite("[[event:evt-1]]", {
			citedBy: marker("accounts/halvorsen", "renewal", 9),
		})

		expect(missing.status).toBe(404)
		expect(((await missing.json()) as CiteBody).error?.code).toBe(
			"CITATION_NOT_FOUND",
		)
		expect(bridge.mdbrainBridgeSearch).not.toHaveBeenCalled()
	})
})
