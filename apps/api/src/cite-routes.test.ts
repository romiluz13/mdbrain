// GET /v1/cite — the citation resolver.
//
// The route and the engine's real revision lookup and governance run against a
// fake revisions collection, so "hidden by that revision's own permissions" is
// decided by the shipped filter, not by a mock. Only the store handle and the
// memory bridge's event read are replaced.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const prevEnv = { ...process.env }

const bridge = vi.hoisted(() => ({ mdbrainBridgeGetEvent: vi.fn() }))
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
	bridge.mdbrainBridgeGetEvent.mockReset()
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
	const citing = marker("accounts/halvorsen", "renewal", 1)
	const stored = (extra: Record<string, unknown> = {}) => ({
		eventId: "evt-1",
		role: "user",
		body: "Tobias asked for a written ETA recovery plan before the November signature.",
		timestamp: "2026-09-28T08:30:00.000Z",
		scope: "workspace",
		scopeRef: "ws-1",
		validAt: "2026-09-28T08:30:00.000Z",
		...extra,
	})

	beforeEach(() => {
		revisions.push(
			revision("ws-1", 1, [
				claim("renewal", "The renewal is at risk.", [
					{ kind: "event", sourceId: "evt-1", note: "An excerpt." },
					{ kind: "event", sourceId: "evt-2" },
					{ kind: "manual", sourceId: "evt-3", note: "A manual note." },
				]),
			]),
		)
		bridge.mdbrainBridgeGetEvent.mockResolvedValue(stored())
	})

	it("resolves by id under the request's agent, scope and scopeRef, with no citing claim", async () => {
		const res = await cite("[[event:evt-1]]", { agentId: "agent-7" })

		expect(res.status).toBe(200)
		const body = (await res.json()) as CiteBody
		expect(body).toEqual({
			status: "resolved",
			kind: "event",
			marker: "[[event:evt-1]]",
			event: {
				eventId: "evt-1",
				canonicalId: "event:evt-1",
				text: "Tobias asked for a written ETA recovery plan before the November signature.",
				timestamp: "2026-09-28T08:30:00.000Z",
				scope: "workspace",
				scopeRef: "ws-1",
			},
		})
		expect(bridge.mdbrainBridgeGetEvent).toHaveBeenCalledExactlyOnceWith({
			eventId: "evt-1",
			agentId: "agent-7",
			scope: "workspace",
			scopeRef: "ws-1",
		})
		expect(store.getWikiStoreHandle).not.toHaveBeenCalled()
	})

	it("resolves by id after confirming the citing claim, and names that claim", async () => {
		const res = await cite("[[event:evt-1]]", { citedBy: citing })

		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({
			marker: "[[event:evt-1]]",
			citedBy: citing,
			event: { eventId: "evt-1", timestamp: "2026-09-28T08:30:00.000Z" },
		})
		expect(lookups).toHaveLength(1)
	})

	it("no longer needs an excerpt on the citing evidence", async () => {
		bridge.mdbrainBridgeGetEvent.mockResolvedValue(stored({ eventId: "evt-2" }))

		const res = await cite("[[event:evt-2]]", { citedBy: citing })

		expect(res.status).toBe(200)
	})

	it("leaves an event outside the request's agent, scope or scopeRef unresolved, with no content", async () => {
		bridge.mdbrainBridgeGetEvent.mockResolvedValue(null)

		const res = await cite("[[event:evt-1]]", { scopeRef: "ws-2" })

		expect(res.status).toBe(404)
		expect(((await res.json()) as CiteBody).error?.code).toBe(
			"CITATION_UNRESOLVED",
		)
		expect(bridge.mdbrainBridgeGetEvent).toHaveBeenCalledWith(
			expect.objectContaining({ scopeRef: "ws-2" }),
		)
	})

	it.each([
		["another event id", { eventId: "evt-10" }],
		["another scope", { scope: "tenant" }],
		["another scopeRef", { scopeRef: "ws-2" }],
	])("does not trust a record that reports %s", async (_label, extra) => {
		bridge.mdbrainBridgeGetEvent.mockResolvedValue(
			stored({ ...extra, body: "Leaked body" }),
		)

		const res = await cite("[[event:evt-1]]")

		expect(res.status).toBe(404)
		const raw = await res.text()
		expect(JSON.parse(raw).error.code).toBe("CITATION_UNRESOLVED")
		expect(raw).not.toContain("Leaked body")
	})

	it("does not call a lookup failure unresolved", async () => {
		bridge.mdbrainBridgeGetEvent.mockRejectedValue(new Error("memongo down"))

		const res = await cite("[[event:evt-1]]")

		expect(res.status).toBeGreaterThanOrEqual(500)
		expect(((await res.json()) as CiteBody).error?.code).not.toBe(
			"CITATION_UNRESOLVED",
		)
	})

	it.each([
		["an event marker", "[[event:evt-1]]"],
		["plain text", "the renewal claim"],
		["a malformed claim marker", "[[wiki:a#b@r0]]"],
	])("rejects %s as the citing claim", async (_name, citedBy) => {
		const res = await cite("[[event:evt-1]]", { citedBy })

		expect(res.status).toBe(400)
		expect(((await res.json()) as CiteBody).error?.code).toBe("INVALID_MARKER")
		expect(bridge.mdbrainBridgeGetEvent).not.toHaveBeenCalled()
	})

	it.each([
		["a claim that does not cite the event", "[[event:evt-9]]"],
		["evidence that is not an event", "[[event:evt-3]]"],
	])("leaves %s unresolved without a lookup", async (_name, eventMarker) => {
		const res = await cite(eventMarker, { citedBy: citing })

		expect(res.status).toBe(404)
		expect(((await res.json()) as CiteBody).error?.code).toBe(
			"CITATION_UNRESOLVED",
		)
		expect(bridge.mdbrainBridgeGetEvent).not.toHaveBeenCalled()
	})

	it("refuses a citing claim that is missing, without a lookup", async () => {
		const missing = await cite("[[event:evt-1]]", {
			citedBy: marker("accounts/halvorsen", "renewal", 9),
		})

		expect(missing.status).toBe(404)
		expect(((await missing.json()) as CiteBody).error?.code).toBe(
			"CITATION_NOT_FOUND",
		)
		expect(bridge.mdbrainBridgeGetEvent).not.toHaveBeenCalled()
	})

	it("refuses a citing claim the caller cannot read, exactly like a missing one", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "plain",
				scopes: ["workspace"],
				scopeRefs: ["ws-1"],
				trustTier: "standard",
				capabilities: ["read"],
			},
		])
		revisions.push(
			revision(
				"ws-1",
				2,
				[
					claim("renewal", "Confidential draft text.", [
						{ kind: "event", sourceId: "evt-1" },
					]),
				],
				{
					permissions: { privacyTier: "confidential", allowedRoles: ["exec"] },
				},
			),
		)

		const hidden = await cite("[[event:evt-1]]", {
			citedBy: marker("accounts/halvorsen", "renewal", 2),
			token: "plain",
		})
		const missing = await cite("[[event:evt-1]]", {
			citedBy: marker("accounts/halvorsen", "renewal", 9),
			token: "plain",
		})

		const hiddenBody = await notFoundBody(hidden)
		expect(hiddenBody).toBe(await notFoundBody(missing))
		expect(hiddenBody).not.toContain("Confidential")
		expect(bridge.mdbrainBridgeGetEvent).not.toHaveBeenCalled()
	})
})
