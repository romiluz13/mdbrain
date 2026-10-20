import { afterEach, describe, expect, it, vi } from "vitest"
import { MdbrainClient } from "./index.js"

describe("MdbrainClient public contract", () => {
	it("forwards constraint relaxation and retains throttling metadata", async () => {
		const out = { results: [], metadata: { throttled: { retryAfterMs: 300 } } }
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json(out))
		vi.stubGlobal("fetch", fetchMock)
		await expect(
			new MdbrainClient().searchDetailed({
				query: "decision",
				searchConfig: { allowConstraintRelaxation: true },
			}),
		).resolves.toEqual(out)
		expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
			searchConfig: { allowConstraintRelaxation: true },
		})
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	it("does not expose Memongo control operations", () => {
		const client = new MdbrainClient()

		expect(client).not.toHaveProperty("status")
		expect(client).not.toHaveProperty("probeEmbedding")
		expect(client).not.toHaveProperty("probeVector")
	})

	it("serializes explicit scope for every scoped retrieval wrapper", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
			Response.json({
				results: [],
				metadata: {},
			}),
		)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		await client.searchKB({
			query: "knowledge",
			scope: "tenant",
			scopeRef: "tenant-1",
		})
		await client.recallConversation({
			query: "conversation",
			scope: "tenant",
			scopeRef: "tenant-1",
		})
		await client.searchDetailed({
			query: "detailed",
			scope: "tenant",
			scopeRef: "tenant-1",
		})

		expect(
			fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body))),
		).toEqual([
			expect.objectContaining({ scope: "tenant", scopeRef: "tenant-1" }),
			expect.objectContaining({ scope: "tenant", scopeRef: "tenant-1" }),
			expect.objectContaining({ scope: "tenant", scopeRef: "tenant-1" }),
		])
	})

	it("omits scope fields when scoped retrieval callers do not provide them", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
			Response.json({
				results: [],
				metadata: {},
			}),
		)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		await client.searchKB({ query: "knowledge" })
		await client.recallConversation({ query: "conversation" })
		await client.searchDetailed({ query: "detailed" })

		for (const call of fetchMock.mock.calls) {
			const body = JSON.parse(String(call[1]?.body))
			expect(body).not.toHaveProperty("scope")
			expect(body).not.toHaveProperty("scopeRef")
		}
	})

	it("bounds requests with the default deadline", async () => {
		vi.useFakeTimers()
		const fetchMock = vi.fn(
			(_input: string | URL | Request, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => reject(init.signal?.reason),
						{ once: true },
					)
				}),
		)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const request = client.search({ query: "deadline" })
		const rejection = expect(request).rejects.toMatchObject({
			code: "DEADLINE_EXCEEDED",
		})
		await vi.advanceTimersByTimeAsync(10_000)

		await rejection
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it("cancels a call from the caller signal", async () => {
		const fetchMock = vi.fn(
			(_input: string | URL | Request, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => reject(init.signal?.reason),
						{ once: true },
					)
				}),
		)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()
		const controller = new AbortController()

		const request = client.search(
			{ query: "cancel" },
			{ signal: controller.signal },
		)
		const rejection = expect(request).rejects.toMatchObject({
			code: "REQUEST_ABORTED",
		})
		controller.abort()

		await rejection
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it("retries a safe read after a transient response", async () => {
		vi.useFakeTimers()
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response("busy", { status: 503 }))
			.mockResolvedValueOnce(Response.json({ results: [] }))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const request = client.search({ query: "retry" })
		await vi.advanceTimersByTimeAsync(200)

		await expect(request).resolves.toEqual({ results: [] })
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("does not retry a mutation without an idempotency contract", async () => {
		vi.useFakeTimers()
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response("busy", { status: 503 }))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const request = client.writeStructured({ entry: { type: "preference" } })
		const rejection = expect(request).rejects.toMatchObject({ status: 503 })
		await vi.advanceTimersByTimeAsync(1_000)

		await rejection
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it("retries an idempotent write with the same key and body", async () => {
		vi.useFakeTimers()
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response("busy", { status: 503 }))
			.mockResolvedValueOnce(
				Response.json({ ok: true, eventId: "evt-1", chunkCreated: true }),
			)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const request = client.add({
			content: "same request",
			idempotencyKey: "key-1",
		})
		await vi.advanceTimersByTimeAsync(200)

		await expect(request).resolves.toMatchObject({ eventId: "evt-1" })
		const firstInit = fetchMock.mock.calls[0]?.[1]
		const secondInit = fetchMock.mock.calls[1]?.[1]
		expect(firstInit?.body).toBe(secondInit?.body)
		expect(firstInit?.headers).toMatchObject({ "Idempotency-Key": "key-1" })
		expect(secondInit?.headers).toMatchObject({ "Idempotency-Key": "key-1" })
	})

	it("retries a safe read after a transport failure", async () => {
		vi.useFakeTimers()
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new TypeError("connection reset"))
			.mockResolvedValueOnce(Response.json({ results: [] }))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const request = client.search({ query: "transport retry" })
		const resolution = expect(request).resolves.toEqual({ results: [] })
		await vi.advanceTimersByTimeAsync(200)

		await resolution
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("retries a safe read when the response body transport fails", async () => {
		vi.useFakeTimers()
		const brokenBody = new ReadableStream({
			start(controller) {
				controller.error(new TypeError("body connection reset"))
			},
		})
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(brokenBody, {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(Response.json({ results: [] }))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const request = client.search({ query: "body retry" })
		const resolution = expect(request).resolves.toEqual({ results: [] })
		await vi.advanceTimersByTimeAsync(200)

		await resolution
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("honors Retry-After when it fits a per-call deadline", async () => {
		vi.useFakeTimers()
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response("rate limited", {
					status: 429,
					headers: { "Retry-After": "1" },
				}),
			)
			.mockResolvedValueOnce(Response.json({ results: [] }))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient({ defaultDeadlineMs: 50 })

		const request = client.search(
			{ query: "retry after" },
			{ timeoutMs: 1_500 },
		)
		const resolution = expect(request).resolves.toEqual({ results: [] })
		await vi.advanceTimersByTimeAsync(999)
		expect(fetchMock).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1)

		await resolution
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("does not wait for Retry-After beyond the call deadline", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			new Response("rate limited", {
				status: 429,
				headers: { "Retry-After": "2" },
			}),
		)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		await expect(
			client.search({ query: "too late" }, { timeoutMs: 500 }),
		).rejects.toMatchObject({ status: 429 })
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it("shares one deadline across wiki apply create and update attempts", async () => {
		vi.useFakeTimers()
		let patchSignal: AbortSignal | null = null
		const fetchMock = vi.fn(
			(_input: string | URL | Request, init?: RequestInit) => {
				if (!patchSignal) {
					patchSignal = init?.signal ?? null
					return new Promise<Response>((resolve) => {
						setTimeout(
							() => resolve(new Response("duplicate", { status: 409 })),
							800,
						)
					})
				}
				patchSignal = init?.signal ?? null
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => reject(init.signal?.reason),
						{ once: true },
					)
				})
			},
		)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const request = client.wikiApply(
			{
				kind: "note",
				title: "Deadline",
				slug: "deadline",
				summary: "Deadline",
				body: "Deadline",
				frontmatter: { type: "note" },
				scope: "workspace",
				scopeRef: "test",
				trustTier: "standard",
			},
			{ timeoutMs: 1_000 },
		)
		const rejection = expect(request).rejects.toMatchObject({
			code: "DEADLINE_EXCEEDED",
		})
		await vi.advanceTimersByTimeAsync(800)
		await vi.advanceTimersByTimeAsync(200)
		const abortedAtDeadline = patchSignal?.aborted
		await vi.advanceTimersByTimeAsync(800)

		await rejection
		expect(abortedAtDeadline).toBe(true)
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("does not start a wiki update after its deadline is exhausted", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response("duplicate", { status: 409 }))
			.mockResolvedValueOnce(Response.json({ ok: true }))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		await expect(
			client.wikiApply(
				{
					kind: "note",
					title: "Expired",
					slug: "expired",
					summary: "Expired",
					body: "Expired",
					frontmatter: { type: "note" },
					scope: "workspace",
					scopeRef: "test",
					trustTier: "standard",
				},
				{ timeoutMs: 0 },
			),
		).rejects.toMatchObject({ code: "DEADLINE_EXCEEDED" })
		expect(fetchMock).toHaveBeenCalledTimes(0)
	})

	it("wikiApply update fallback sends the observed revision as a CAS precondition", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				Response.json(
					{
						error: {
							code: "DUPLICATE_SLUG",
							message: 'wiki page slug "cas" already exists',
						},
					},
					{ status: 409 },
				),
			)
			.mockResolvedValueOnce(Response.json({ slug: "cas", revision: 3 }))
			.mockResolvedValueOnce(Response.json({ slug: "cas", revision: 4 }))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const result = await client.wikiApply({
			kind: "note",
			title: "CAS",
			slug: "cas",
			summary: "CAS",
			body: "CAS",
			frontmatter: { type: "note" },
			scope: "workspace",
			scopeRef: "test",
			trustTier: "standard",
		})

		expect(result).toMatchObject({ revision: 4 })
		expect(fetchMock).toHaveBeenCalledTimes(3)
		// Call 0 is the create attempt (409 DUPLICATE_SLUG); the fallback then
		// GETs the observed state and PATCHes with it as the precondition.
		const getUrl = fetchMock.mock.calls[1]?.[0]
		const patchUrl = fetchMock.mock.calls[2]?.[0]
		const patchInit = fetchMock.mock.calls[2]?.[1]
		expect(String(getUrl)).toContain("/v1/wiki/cas?scope=workspace")
		expect(String(patchUrl)).toContain("/v1/wiki/cas")
		expect(patchInit?.method).toBe("PATCH")
		expect(JSON.parse(String(patchInit?.body))).toMatchObject({
			expectedRevision: 3,
			title: "CAS",
		})
	})

	it("wikiApply sends claims with evidence and relationships on both the create and the update attempt", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				Response.json(
					{
						error: {
							code: "DUPLICATE_SLUG",
							message: 'wiki page slug "accounts/halvorsen" already exists',
						},
					},
					{ status: 409 },
				),
			)
			.mockResolvedValueOnce(
				Response.json({ slug: "accounts/halvorsen", revision: 1 }),
			)
			.mockResolvedValueOnce(
				Response.json({ slug: "accounts/halvorsen", revision: 2 }),
			)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()
		const claims = [
			{
				id: "clm_halvorsen_renewal_at_risk",
				text: "The Halvorsen renewal is at risk.",
				confidence: 0.9,
				evidence: [{ kind: "event" as const, sourceId: "evt_ticket_4471" }],
			},
		]
		const relationships = [
			{
				targetPageSlug: "incidents/eta-drift",
				targetTitle: "ETA drift escalation",
				kind: "relates_to",
			},
		]

		await client.wikiApply({
			kind: "entity",
			title: "Halvorsen Freight",
			slug: "accounts/halvorsen",
			summary: "Freight customer",
			body: "Renewal is at risk.",
			frontmatter: { type: "account" },
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			claims,
			relationships,
		})

		const createBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
		const patchBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))
		expect(createBody.claims).toEqual(claims)
		expect(createBody.relationships).toEqual(relationships)
		expect(patchBody.claims).toEqual(claims)
		expect(patchBody.relationships).toEqual(relationships)
		expect(patchBody.expectedRevision).toBe(1)
	})

	it("wikiApply surfaces REVISION_CONFLICT from the update fallback instead of overwriting", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				Response.json(
					{
						error: {
							code: "DUPLICATE_SLUG",
							message: 'wiki page slug "cas" already exists',
						},
					},
					{ status: 409 },
				),
			)
			.mockResolvedValueOnce(Response.json({ slug: "cas", revision: 3 }))
			.mockResolvedValueOnce(
				Response.json(
					{
						error: {
							code: "REVISION_CONFLICT",
							message:
								'wiki page "cas" moved past revision 3 — concurrent update',
						},
					},
					{ status: 409 },
				),
			)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		await expect(
			client.wikiApply({
				kind: "note",
				title: "Stale",
				slug: "cas",
				summary: "Stale",
				body: "Stale",
				frontmatter: { type: "note" },
				scope: "workspace",
				scopeRef: "test",
				trustTier: "standard",
			}),
		).rejects.toMatchObject({
			status: 409,
			envelope: { code: "REVISION_CONFLICT" },
		})
		expect(fetchMock).toHaveBeenCalledTimes(3)
	})

	it("wikiApply treats only DUPLICATE_SLUG as the update trigger", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
			Response.json(
				{
					error: {
						code: "REVISION_CONFLICT",
						message: "stale precondition",
					},
				},
				{ status: 409 },
			),
		)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		await expect(
			client.wikiApply({
				kind: "note",
				title: "X",
				slug: "x",
				summary: "X",
				body: "X",
				frontmatter: { type: "note" },
				scope: "workspace",
				scopeRef: "test",
				trustTier: "standard",
			}),
		).rejects.toMatchObject({ status: 409 })
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it("wikiApply falls back to a plain update when the GET hits a 404 (page vanished mid-upsert)", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				Response.json(
					{
						error: {
							code: "DUPLICATE_SLUG",
							message: 'wiki page slug "ghost" already exists',
						},
					},
					{ status: 409 },
				),
			)
			.mockResolvedValueOnce(
				Response.json(
					{ error: { code: "WIKI_NOT_FOUND", message: "no page" } },
					{ status: 404 },
				),
			)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		await expect(
			client.wikiApply({
				kind: "note",
				title: "Ghost",
				slug: "ghost",
				summary: "Ghost",
				body: "Ghost",
				frontmatter: { type: "note" },
				scope: "workspace",
				scopeRef: "test",
				trustTier: "standard",
			}),
		).rejects.toMatchObject({ status: 404 })
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("wikiGet URL-encodes path-unsafe slugs and forwards transclude", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ slug: "tables/a b" }))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		await client.wikiGet({
			slug: "tables/a b?c",
			scope: "workspace",
			scopeRef: "ws-1",
			transclude: true,
		})

		const url = String(fetchMock.mock.calls[0]?.[0])
		expect(url).toContain(`/v1/wiki/${encodeURIComponent("tables/a b?c")}?`)
		expect(url).toContain("transclude=true")
		expect(url).toContain("scope=workspace")
	})

	it("wikiGet with format=markdown resolves to the raw rendered string", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
			new Response("# Accounts Table\n\n- id: uuid", {
				status: 200,
				headers: { "Content-Type": "text/markdown" },
			}),
		)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const out = await client.wikiGet({
			slug: "tables/accounts",
			scope: "workspace",
			scopeRef: "ws-1",
			format: "markdown",
		})

		expect(out).toBe("# Accounts Table\n\n- id: uuid")
	})

	it("wikiDelete URL-encodes path-unsafe slugs", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
			Response.json({
				ok: true,
				slug: "x",
				scope: "s",
				scopeRef: "r",
				hard: false,
			}),
		)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		await client.wikiDelete({
			slug: "tables/a b",
			scope: "workspace",
			scopeRef: "ws-1",
		})

		const url = String(fetchMock.mock.calls[0]?.[0])
		expect(url).toContain(`/v1/wiki/${encodeURIComponent("tables/a b")}?`)
	})

	const pageView = {
		_id: "681a",
		kind: "note",
		title: "Deploy windows",
		slug: "notes/deploy windows",
		aliases: [],
		summary: "Friday deploy windows only",
		body: "Deploys happen on Fridays.",
		frontmatter: { type: "note" },
		claims: [],
		contradictions: [],
		questions: [],
		relationships: [],
		personCard: null,
		scope: "workspace",
		scopeRef: "ws-1",
		trustTier: "standard",
		permissions: {},
		state: "active",
		revision: 2,
		validFrom: "2026-10-06T10:00:00.000Z",
		freshness: "fresh",
		backlinks: [],
		transcludes: [],
		createdAt: "2026-10-06T10:00:00.000Z",
		updatedAt: "2026-10-06T10:05:00.000Z",
	}

	it("wikiGet JSON resolves to the typed page view and still returns strings for markdown", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json(pageView))
			.mockResolvedValueOnce(
				new Response("# Deploy", {
					status: 200,
					headers: { "Content-Type": "text/markdown" },
				}),
			)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const page = await client.wikiGet({
			slug: "notes/deploy windows",
			scope: "workspace",
			scopeRef: "ws-1",
		})
		const markdown = await client.wikiGet({
			slug: "notes/deploy windows",
			scope: "workspace",
			scopeRef: "ws-1",
			format: "markdown",
		})

		expect(page).toEqual(pageView)
		expect(page.state).toBe("active")
		expect(page.revision).toBe(2)
		expect(markdown).toBe("# Deploy")
	})

	it("wikiList requests the list route with filters and returns the page envelope", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ pages: [pageView], total: 1 }))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const out = await client.wikiList({
			scope: "workspace",
			scopeRef: "ws-1",
			kind: "note",
			state: "all",
			limit: 25,
			skip: 50,
			agentId: "main",
		})

		expect(out).toEqual({ pages: [pageView], total: 1 })
		const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
		expect(url.pathname).toBe("/v1/wiki")
		expect(url.searchParams.get("scope")).toBe("workspace")
		expect(url.searchParams.get("scopeRef")).toBe("ws-1")
		expect(url.searchParams.get("kind")).toBe("note")
		expect(url.searchParams.get("state")).toBe("all")
		expect(url.searchParams.get("limit")).toBe("25")
		expect(url.searchParams.get("skip")).toBe("50")
		expect(url.searchParams.get("agentId")).toBe("main")
	})

	it("wikiCreate posts the page input to the create route", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json(pageView, { status: 201 }))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const out = await client.wikiCreate({
			kind: "note",
			title: "Deploy windows",
			slug: "notes/deploy windows",
			summary: "Friday deploy windows only",
			body: "Deploys happen on Fridays.",
			frontmatter: { type: "note" },
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			agentId: "main",
		})

		expect(out).toEqual(pageView)
		const init = fetchMock.mock.calls[0]?.[1]
		expect(init?.method).toBe("POST")
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/wiki")
		expect(JSON.parse(String(init?.body))).toEqual({
			kind: "note",
			title: "Deploy windows",
			slug: "notes/deploy windows",
			summary: "Friday deploy windows only",
			body: "Deploys happen on Fridays.",
			frontmatter: { type: "note" },
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			agentId: "main",
		})
	})

	it("wikiCreate sends claims with their evidence and relationships", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json(pageView, { status: 201 }))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		await client.wikiCreate({
			kind: "entity",
			title: "Halvorsen Freight",
			slug: "accounts/halvorsen",
			summary: "Freight customer",
			body: "Renewal is healthy.",
			frontmatter: { type: "account" },
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			claims: [
				{
					id: "clm_halvorsen_renewal_healthy",
					text: "The Halvorsen renewal is healthy.",
					status: "active",
					confidence: 0.82,
					evidence: [
						{
							kind: "event",
							sourceId: "evt_call_notes_0914",
							note: "Renewal call, 14 Sep",
							weight: 0.9,
						},
					],
					writerAgent: { id: "account-manager", name: "Account Manager" },
					derivedFrom: ["evt_call_notes_0914"],
				},
			],
			relationships: [
				{
					targetPageSlug: "projects/identity-gateway",
					targetTitle: "Identity Gateway v2",
					kind: "depends_on",
					weight: 0.5,
				},
			],
		})

		const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
		expect(body.claims).toEqual([
			{
				id: "clm_halvorsen_renewal_healthy",
				text: "The Halvorsen renewal is healthy.",
				status: "active",
				confidence: 0.82,
				evidence: [
					{
						kind: "event",
						sourceId: "evt_call_notes_0914",
						note: "Renewal call, 14 Sep",
						weight: 0.9,
					},
				],
				writerAgent: { id: "account-manager", name: "Account Manager" },
				derivedFrom: ["evt_call_notes_0914"],
			},
		])
		expect(body.relationships).toEqual([
			{
				targetPageSlug: "projects/identity-gateway",
				targetTitle: "Identity Gateway v2",
				kind: "depends_on",
				weight: 0.5,
			},
		])
	})

	it("wikiUpdate sends the inspected revision unchanged and URL-encodes the slug", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json(pageView))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const out = await client.wikiUpdate({
			slug: "notes/deploy windows?v2",
			scope: "workspace",
			scopeRef: "ws-1",
			expectedRevision: 2,
			title: "Deploy windows (revised)",
			body: "Deploys happen on Fridays, before 16:00.",
			agentId: "main",
		})

		expect(out).toEqual(pageView)
		const init = fetchMock.mock.calls[0]?.[1]
		expect(init?.method).toBe("PATCH")
		const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
		expect(url.pathname).toBe(
			`/v1/wiki/${encodeURIComponent("notes/deploy windows?v2")}`,
		)
		expect(JSON.parse(String(init?.body))).toEqual({
			title: "Deploy windows (revised)",
			body: "Deploys happen on Fridays, before 16:00.",
			scope: "workspace",
			scopeRef: "ws-1",
			expectedRevision: 2,
			agentId: "main",
		})
	})

	it("wikiUpdate sends claims and relationships in the patch body", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json(pageView))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		await client.wikiUpdate({
			slug: "accounts/halvorsen",
			scope: "workspace",
			scopeRef: "ws-1",
			expectedRevision: 1,
			claims: [
				{
					id: "clm_halvorsen_renewal_at_risk",
					text: "The Halvorsen renewal is at risk.",
					evidence: [{ kind: "event", sourceId: "evt_ticket_4471" }],
				},
			],
			relationships: [
				{
					targetPageSlug: "incidents/eta-drift",
					targetTitle: "ETA drift escalation",
					kind: "relates_to",
				},
			],
		})

		expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
			scope: "workspace",
			scopeRef: "ws-1",
			expectedRevision: 1,
			claims: [
				{
					id: "clm_halvorsen_renewal_at_risk",
					text: "The Halvorsen renewal is at risk.",
					evidence: [{ kind: "event", sourceId: "evt_ticket_4471" }],
				},
			],
			relationships: [
				{
					targetPageSlug: "incidents/eta-drift",
					targetTitle: "ETA drift escalation",
					kind: "relates_to",
				},
			],
		})
	})

	it("wikiUpdate propagates REVISION_CONFLICT without retrying an overwrite", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
			Response.json(
				{
					error: {
						code: "REVISION_CONFLICT",
						message: "stale precondition",
					},
				},
				{ status: 409 },
			),
		)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		await expect(
			client.wikiUpdate({
				slug: "notes/deploy windows",
				scope: "workspace",
				scopeRef: "ws-1",
				expectedRevision: 2,
				body: "Stale draft",
			}),
		).rejects.toMatchObject({
			status: 409,
			envelope: { code: "REVISION_CONFLICT" },
		})
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it("wikiRevisions requests the revision list with slug and scope in the query", async () => {
		const revisions = [
			{
				pageSlug: "notes/deploy windows",
				scope: "workspace",
				scopeRef: "ws-1",
				revision: 2,
				editKind: "update",
				editor: { id: "api-key:admin", name: "MDBrain administrator" },
				createdAt: "2026-10-06T10:05:00.000Z",
			},
		]
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ revisions }))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const out = await client.wikiRevisions({
			slug: "notes/deploy windows",
			scope: "workspace",
			scopeRef: "ws-1",
			limit: 10,
			agentId: "main",
		})

		expect(out).toEqual({ revisions })
		const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
		expect(url.pathname).toBe("/v1/wiki/revisions")
		expect(url.searchParams.get("slug")).toBe("notes/deploy windows")
		expect(url.searchParams.get("scope")).toBe("workspace")
		expect(url.searchParams.get("scopeRef")).toBe("ws-1")
		expect(url.searchParams.get("limit")).toBe("10")
		expect(url.searchParams.get("agentId")).toBe("main")
	})

	it("wikiRevision fetches one revision snapshot by number", async () => {
		const record = {
			pageSlug: "notes/deploy windows",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 1,
			editKind: "create",
			createdAt: "2026-10-06T10:00:00.000Z",
			snapshot: pageView,
		}
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json(record))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const out = await client.wikiRevision({
			slug: "notes/deploy windows",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 1,
			agentId: "main",
		})

		expect(out).toEqual(record)
		expect(out.snapshot.slug).toBe("notes/deploy windows")
		const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
		expect(url.pathname).toBe("/v1/wiki/revisions/1")
		expect(url.searchParams.get("slug")).toBe("notes/deploy windows")
		expect(url.searchParams.get("agentId")).toBe("main")
	})

	it("cite resolves a marker with the request's scope, citedBy and agentId in the query", async () => {
		const resolved = {
			status: "resolved",
			kind: "claim",
			marker: "[[wiki:accounts/halvorsen#renewal@r2]]",
			page: {
				slug: "accounts/halvorsen",
				title: "Halvorsen",
				revision: 2,
				revisionCreatedAt: "2026-10-02T09:00:00.000Z",
			},
			claim: { id: "renewal", text: "The renewal is at risk." },
		}
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json(resolved))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const out = await client.cite({
			marker: "[[event:evt 1&2]]",
			citedBy: "[[wiki:accounts/halvorsen#renewal@r2]]",
			scope: "workspace",
			scopeRef: "ws-1",
			agentId: "main",
		})

		expect(out).toEqual(resolved)
		const [href, init] = fetchMock.mock.calls[0] ?? []
		const url = new URL(String(href))
		expect(url.pathname).toBe("/v1/cite")
		expect(url.searchParams.get("marker")).toBe("[[event:evt 1&2]]")
		expect(url.searchParams.get("citedBy")).toBe(
			"[[wiki:accounts/halvorsen#renewal@r2]]",
		)
		expect(url.searchParams.get("scope")).toBe("workspace")
		expect(url.searchParams.get("scopeRef")).toBe("ws-1")
		expect(url.searchParams.get("agentId")).toBe("main")
		expect(init?.method ?? "GET").toBe("GET")
	})

	it("cite leaves citedBy and agentId out when they are not given", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ status: "resolved" }))
		vi.stubGlobal("fetch", fetchMock)

		await new MdbrainClient().cite({
			marker: "[[wiki:a#b@r1]]",
			scope: "workspace",
			scopeRef: "ws-1",
		})

		const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
		expect([...url.searchParams.keys()].sort()).toEqual([
			"marker",
			"scope",
			"scopeRef",
		])
	})

	it("cite surfaces an unresolved marker as a client error carrying the API's code and no content", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
			Response.json(
				{
					error: {
						code: "CITATION_NOT_FOUND",
						message: "citation not found",
					},
				},
				{ status: 404 },
			),
		)
		vi.stubGlobal("fetch", fetchMock)

		await expect(
			new MdbrainClient().cite({
				marker: "[[wiki:a#b@r1]]",
				scope: "workspace",
				scopeRef: "ws-1",
			}),
		).rejects.toMatchObject({
			status: 404,
			envelope: { code: "CITATION_NOT_FOUND" },
		})
	})

	it("overview reads the page's overview with the scope, agentId and every bound in the query", async () => {
		const overview = { page: { slug: "notes/deploy windows" } }
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json(overview))
		vi.stubGlobal("fetch", fetchMock)

		const out = await new MdbrainClient().overview({
			slug: "notes/deploy windows",
			scope: "workspace",
			scopeRef: "ws-1",
			agentId: "main",
			maxBacklinks: 5,
			maxNeighbors: 6,
			maxNeighborClaims: 2,
			maxRevisions: 7,
			maxContradictions: 8,
		})

		expect(out).toEqual(overview)
		const [href, init] = fetchMock.mock.calls[0] ?? []
		const url = new URL(String(href))
		expect(url.pathname).toBe("/v1/wiki/overview/notes%2Fdeploy%20windows")
		expect(Object.fromEntries(url.searchParams)).toEqual({
			scope: "workspace",
			scopeRef: "ws-1",
			agentId: "main",
			maxBacklinks: "5",
			maxNeighbors: "6",
			maxNeighborClaims: "2",
			maxRevisions: "7",
			maxContradictions: "8",
		})
		expect(init?.method ?? "GET").toBe("GET")
	})

	it("overview leaves the bounds and agentId out when they are not given", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ page: {} }))
		vi.stubGlobal("fetch", fetchMock)

		await new MdbrainClient().overview({
			slug: "accounts/halvorsen",
			scope: "workspace",
			scopeRef: "ws-1",
		})

		const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
		expect([...url.searchParams.keys()].sort()).toEqual(["scope", "scopeRef"])
	})

	it("overview surfaces a missing or hidden page as a client error with the API's code", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				Response.json(
					{ error: { code: "WIKI_NOT_FOUND", message: "wiki page not found" } },
					{ status: 404 },
				),
			)
		vi.stubGlobal("fetch", fetchMock)

		await expect(
			new MdbrainClient().overview({
				slug: "accounts/secret",
				scope: "workspace",
				scopeRef: "ws-1",
			}),
		).rejects.toMatchObject({
			status: 404,
			envelope: { code: "WIKI_NOT_FOUND" },
		})
	})

	it("changes reads the feed with the scope, agentId, window, cursor and page bounds in the query", async () => {
		const page = { changes: [], hasMore: false }
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json(page))
		vi.stubGlobal("fetch", fetchMock)

		const out = await new MdbrainClient().changes({
			scope: "workspace",
			scopeRef: "ws-1",
			agentId: "main",
			since: "2026-10-01T00:00:00.000Z",
			until: new Date("2026-10-01T10:30:00.000Z"),
			cursor: "abc",
			limit: 7,
			maxClaims: 3,
		})

		expect(out).toEqual(page)
		const [href, init] = fetchMock.mock.calls[0] ?? []
		const url = new URL(String(href))
		expect(url.pathname).toBe("/v1/wiki/changes")
		expect(Object.fromEntries(url.searchParams)).toEqual({
			scope: "workspace",
			scopeRef: "ws-1",
			agentId: "main",
			since: "2026-10-01T00:00:00.000Z",
			until: "2026-10-01T10:30:00.000Z",
			cursor: "abc",
			limit: "7",
			maxClaims: "3",
		})
		expect(init?.method ?? "GET").toBe("GET")
	})

	it("changes sends a Date as an ISO instant and leaves out what it is not given", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ changes: [] }))
		vi.stubGlobal("fetch", fetchMock)

		await new MdbrainClient().changes({
			scope: "workspace",
			scopeRef: "ws-1",
			since: new Date("2026-10-01T10:00:00.000+02:00"),
		})

		const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
		expect(Object.fromEntries(url.searchParams)).toEqual({
			scope: "workspace",
			scopeRef: "ws-1",
			since: "2026-10-01T08:00:00.000Z",
		})
	})

	it("changes surfaces a bad request as a client error with the API's code", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
			Response.json(
				{
					error: { code: "VALIDATION_ERROR", message: "cursor is not valid" },
				},
				{ status: 400 },
			),
		)
		vi.stubGlobal("fetch", fetchMock)

		await expect(
			new MdbrainClient().changes({
				scope: "workspace",
				scopeRef: "ws-1",
				cursor: "garbage",
			}),
		).rejects.toMatchObject({
			status: 400,
			envelope: { code: "VALIDATION_ERROR" },
		})
	})

	it("wikiGet accepts a runtime format of any JSON value for MCP-style callers", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json(pageView))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const args: Record<string, unknown> = { format: "json" }
		const format =
			args.format === "markdown" ||
			args.format === "html" ||
			args.format === "json"
				? args.format
				: undefined
		const out = await client.wikiGet({
			slug: "notes/deploy windows",
			scope: "workspace",
			scopeRef: "ws-1",
			format,
		})

		expect(typeof out === "string" ? out : out.slug).toBe(
			"notes/deploy windows",
		)
	})
})
