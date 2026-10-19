import type { Page, Route } from "@playwright/test"

/** In-browser stand-in for the Mdbrain API. Every workspace e2e result is
 *  therefore UI evidence against mocked network, not live backend behavior. */

export type FakePage = {
	_id: string
	kind: string
	title: string
	slug: string
	summary: string
	body: string
	frontmatter: { type: string }
	claims: unknown[]
	scope: string
	scopeRef: string
	trustTier: string
	permissions: Record<string, unknown>
	provenance: Record<string, unknown>
	sourceEventIds: string[]
	state: string
	revision: number
	freshness: string
	createdAt: string
	updatedAt: string
}

type Revision = {
	revision: number
	editKind: "create" | "update"
	editor: { id: string; name: string }
	createdAt: string
	snapshot: FakePage
}

export type Logged = {
	method: string
	path: string
	query: URLSearchParams
	body: Record<string, unknown>
	headers: Record<string, string>
}

export type FakeApi = ReturnType<typeof installFakeApi>

export function installFakeApi(page: Page) {
	const pages = new Map<string, FakePage>()
	const revisions = new Map<string, Revision[]>()
	const events: Array<{
		eventId: string
		sessionId: string
		content: string
		scopeRef: string
	}> = []
	const log: Logged[] = []
	const control = {
		wikiSearch: "ok" as "ok" | "down",
		detailed: "normal" as "normal" | "zero" | "error" | "throttled",
		addFailures: 0,
		/** Writes are applied at once but their responses wait here. */
		holds: {} as Record<
			"add" | "create" | "patch",
			{ waiters: Array<() => void> } | undefined
		>,
		holdList: undefined as
			| undefined
			| { scopeRef: string; waiters: Array<() => void> },
	}
	let clock = Date.parse("2026-10-06T10:00:00.000Z")
	let counter = 0
	const now = () => {
		clock += 1000
		return new Date(clock).toISOString()
	}
	const key = (scopeRef: string, slug: string) => `${scopeRef}::${slug}`

	function json(route: Route, status: number, body: unknown) {
		return route.fulfill({ status, json: body })
	}
	const err = (route: Route, status: number, code: string, message: string) =>
		json(route, status, { error: { code, message } })

	function seed(scopeRef: string, over: Partial<FakePage> & { slug: string }) {
		const stamp = now()
		const created: FakePage = {
			_id: `id-${++counter}`,
			kind: "concept",
			title: over.slug,
			summary: "seeded summary",
			body: "seeded body",
			frontmatter: { type: "note" },
			claims: [],
			scope: "workspace",
			scopeRef,
			trustTier: "standard",
			permissions: {},
			provenance: {},
			sourceEventIds: [],
			state: "active",
			revision: 1,
			freshness: "fresh",
			createdAt: stamp,
			updatedAt: stamp,
			...over,
		}
		pages.set(key(scopeRef, created.slug), created)
		revisions.set(key(scopeRef, created.slug), [
			{
				revision: 1,
				editKind: "create",
				editor: { id: "editor-1", name: "Editor One" },
				createdAt: stamp,
				snapshot: structuredClone(created),
			},
		])
		return created
	}

	function bump(scopeRef: string, slug: string, body: string) {
		const current = pages.get(key(scopeRef, slug))
		if (!current) {
			throw new Error("no such page")
		}
		current.body = body
		current.revision += 1
		current.updatedAt = now()
		revisions.get(key(scopeRef, slug))?.unshift({
			revision: current.revision,
			editKind: "update",
			editor: { id: "someone-else", name: "Someone Else" },
			createdAt: current.updatedAt,
			snapshot: structuredClone(current),
		})
	}

	async function held(kind: "add" | "create" | "patch") {
		const hold = control.holds[kind]
		if (hold) {
			await new Promise<void>((resolve) => hold.waiters.push(resolve))
		}
	}

	function holdNext(kind: "add" | "create" | "patch") {
		const hold = { waiters: [] as Array<() => void> }
		control.holds[kind] = hold
		return {
			pending: () => hold.waiters.length,
			release: () => {
				control.holds[kind] = undefined
				for (const resolve of hold.waiters) resolve()
			},
		}
	}

	void page.route("**/v1/**", async (route) => {
		const request = route.request()
		const url = new URL(request.url())
		const method = request.method()
		const raw = request.postData()
		const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
		log.push({
			method,
			path: url.pathname,
			query: url.searchParams,
			body,
			headers: request.headers(),
		})
		const path = url.pathname
		const scopeRef = String(
			url.searchParams.get("scopeRef") ?? body.scopeRef ?? "",
		)

		if (path === "/v1/wiki" && method === "GET") {
			const hold = control.holdList
			if (hold && hold.scopeRef === scopeRef) {
				await new Promise<void>((resolve) => {
					hold.waiters.push(resolve)
				})
			}
			const list = [...pages.values()].filter((p) => p.scopeRef === scopeRef)
			return json(route, 200, { pages: list, total: list.length }).catch(
				() => {},
			)
		}
		if (path === "/v1/wiki" && method === "POST") {
			if (pages.has(key(scopeRef, String(body.slug)))) {
				return err(
					route,
					409,
					"DUPLICATE_SLUG",
					`slug ${body.slug} already exists`,
				)
			}
			const created = seed(scopeRef, {
				slug: String(body.slug),
				title: String(body.title),
				kind: String(body.kind),
				summary: String(body.summary),
				body: String(body.body),
				frontmatter: body.frontmatter as { type: string },
				trustTier: String(body.trustTier),
			})
			await held("create")
			return json(route, 200, created).catch(() => {})
		}
		if (path === "/v1/wiki/search") {
			if (control.wikiSearch === "down") {
				return err(
					route,
					503,
					"SEARCH_UNAVAILABLE",
					"wiki search is currently unavailable",
				)
			}
			const q = String(body.query).toLowerCase()
			const hits = [...pages.values()].filter(
				(p) =>
					p.scopeRef === scopeRef &&
					`${p.title} ${p.body}`.toLowerCase().includes(q),
			)
			return json(route, 200, {
				results: hits.map((p) => ({ page: p, score: 0.5, source: "text" })),
				total: hits.length,
				recipe: "fast",
				mode: "text",
			})
		}
		const revisionDetail = path.match(/^\/v1\/wiki\/revisions\/(\d+)$/)
		if (revisionDetail) {
			const slug = String(url.searchParams.get("slug"))
			const found = revisions
				.get(key(scopeRef, slug))
				?.find((r) => r.revision === Number(revisionDetail[1]))
			return found
				? json(route, 200, {
						pageSlug: slug,
						scope: "workspace",
						scopeRef,
						...found,
					})
				: err(route, 404, "WIKI_REVISION_NOT_FOUND", "revision not found")
		}
		if (path === "/v1/wiki/revisions") {
			const slug = String(url.searchParams.get("slug"))
			const list = (revisions.get(key(scopeRef, slug)) ?? []).map(
				({ snapshot: _snapshot, ...summary }) => ({
					pageSlug: slug,
					scope: "workspace",
					scopeRef,
					...summary,
				}),
			)
			return json(route, 200, { revisions: list })
		}
		const pagePath = path.match(/^\/v1\/wiki\/(.+)$/)
		if (pagePath) {
			const slug = decodeURIComponent(pagePath[1] ?? "")
			const current = pages.get(key(scopeRef, slug))
			if (!current) {
				return err(route, 404, "NOT_FOUND", "page not found")
			}
			if (method === "GET") {
				return json(route, 200, current)
			}
			if (method === "PATCH") {
				if (body.expectedRevision !== current.revision) {
					return err(route, 409, "REVISION_CONFLICT", "revision conflict")
				}
				for (const field of ["title", "summary", "body"] as const) {
					if (typeof body[field] === "string") {
						current[field] = body[field]
					}
				}
				current.revision += 1
				current.updatedAt = now()
				revisions.get(key(scopeRef, slug))?.unshift({
					revision: current.revision,
					editKind: "update",
					editor: { id: "editor-1", name: "Editor One" },
					createdAt: current.updatedAt,
					snapshot: structuredClone(current),
				})
				await held("patch")
				return json(route, 200, current).catch(() => {})
			}
		}
		if (path === "/v1/add") {
			if (control.addFailures > 0) {
				control.addFailures -= 1
				return err(route, 500, "ADD_FAILED", "temporary storage failure")
			}
			const eventId = `event-${++counter}`
			events.push({
				eventId,
				sessionId: String(body.sessionId),
				content: String(body.content),
				scopeRef,
			})
			await held("add")
			return json(route, 200, { ok: true, eventId, chunkCreated: true }).catch(
				() => {},
			)
		}
		if (path === "/v1/recall-conversation") {
			const matched = events.filter(
				(e) =>
					e.scopeRef === scopeRef &&
					(!body.sessionId || e.sessionId === body.sessionId),
			)
			return json(route, 200, {
				results: matched.map((e) => ({
					citation: {
						eventId: e.eventId,
						sessionId: e.sessionId,
						role: "user",
						timestamp: "2026-10-06T10:30:00.000Z",
						preview: e.content,
					},
					matchType: "filter",
				})),
				metadata: {
					totalMatched: matched.length,
					filtersApplied: body.sessionId ? [`sessionId:${body.sessionId}`] : [],
					searchMethod: "standard",
					durationMs: 4,
				},
			})
		}
		if (path === "/v1/search-detailed") {
			if (control.detailed === "error") {
				return err(
					route,
					500,
					"SEARCH_DETAILED_FAILED",
					"retrieval backend failed",
				)
			}
			const base = {
				mode: "direct",
				classification: "factual",
				sourceOrder: ["conversation"],
				passes: [],
				queriesTried: [],
				constraintsApplied: [],
				resultsRejected: [],
				evidenceCoverage: "partial",
				pathsExecuted: ["conversation"],
				resultsByPath: {},
				queryRewritten: false,
				reranked: false,
			}
			if (control.detailed === "zero") {
				return json(route, 200, {
					results: [],
					metadata: {
						...base,
						noDirectEvidenceReason: "no events matched the query",
					},
				})
			}
			return json(route, 200, {
				results: [
					{
						path: "conversation/session-1",
						startLine: 1,
						endLine: 2,
						score: 0.42,
						snippet: "User prefers Friday deploys.",
						source: "conversation",
						canonicalId: "canon-1",
						sourceEventIds: ["event-9"],
						trust: {
							score: 0.7,
							confidence: "medium",
							exactness: "approximate",
							freshness: "fresh",
							contradiction: "none",
							scopeMatch: "exact",
							provenance: "partial",
							sourceDiversity: "single",
							factors: ["scope-exact", "single-source"],
						},
					},
					{
						path: "conversation/session-2",
						startLine: 3,
						endLine: 3,
						score: 0.3,
						snippet: "Sparse result with no optional fields.",
						source: "conversation",
					},
				],
				metadata: {
					...base,
					...(control.detailed === "throttled"
						? { throttled: { retryAfterMs: 1500 } }
						: {}),
				},
			})
		}
		if (path === "/v1/context-bundle") {
			return json(route, 200, {
				agentId: String(body.agentId),
				scope: String(body.scope),
				scopeRef,
				rendered: "## Active context\n- User prefers Friday deploys.",
				sections: [
					{
						kind: "query-evidence",
						title: "Query evidence",
						items: [{ title: "x", summary: "y" }],
						estimatedTokens: 12,
						truncated: false,
						partial: true,
					},
				],
				metadata: {
					tokenBudget: 800,
					estimatedTokensUsed: 12,
					partial: true,
					truncated: false,
					pathsExecuted: ["conversation"],
					sectionsIncluded: ["query-evidence"],
				},
				builtAt: "2026-10-06T10:40:00.000Z",
			})
		}
		return err(route, 404, "NOT_FOUND", `unhandled ${method} ${path}`)
	})

	return { pages, revisions, events, log, control, seed, bump, holdNext }
}
