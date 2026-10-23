// A stand-in for the Mdbrain API behind the demo read proxy, built from the
// committed Northstar corpus. It is NOT a recording of the live stack: the
// pages, claims and sources are the corpus's own, wrapped in the API's response
// shapes, with generated ids and ingestion times. The /demo e2e serves it
// through the real proxy handler (handleDemoRead), so the allowlist, the
// server-set principal and the read key are exercised, not bypassed.
import { parseCitationMarker } from "@mdbrain/client"
import {
	build,
	CHANGES_PAGE_SIZE,
	decodeCursor,
	encodeCursor,
	FIXTURE_ENV,
	FIXTURE_FIRST_INGESTION,
	FIXTURE_UNTIL,
	type Json,
	REVISION_STEP_MS,
	ROLE_LABEL,
	words,
} from "./demo-upstream-data.js"

export { corpusDir, eventIdOf, FIXTURE_ENV } from "./demo-upstream-data.js"

function reply(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	})
}

const failure = (status: number, code: string, message: string) =>
	reply({ error: { code, message } }, status)

/** The API behind the proxy: `fetch` takes the proxy's upstream request. */
export function createDemoUpstream(
	options: {
		padTo?: number
		/** "none" models a seeded slot before its agent run: the lint read lists
		 * nothing and no claim is contradicted. "unsourced" records the
		 * contradiction with its second claim stored with no evidence, as an
		 * agent that dropped the evidence writes it. */
		contradiction?: "recorded" | "none" | "unsourced"
	} = {},
) {
	const recorded = options.contradiction !== "none"
	const data = build(
		options.padTo,
		recorded,
		options.contradiction === "unsourced",
	)
	const { pages, bySlug } = data

	const search = (query: string, max: number) => {
		const wanted = new Set(words(query))
		const scored = pages
			.map((page) => {
				let score = 0
				for (const word of words(page.title)) score += wanted.has(word) ? 2 : 0
				for (const word of words(page.summary))
					score += wanted.has(word) ? 1 : 0
				for (const claim of page.claims)
					for (const word of new Set(words(claim.text)))
						score += wanted.has(word) ? 1 : 0
				return { page, score }
			})
			.filter((entry) => entry.score > 0)
			.sort(
				(a, b) => b.score - a.score || a.page.slug.localeCompare(b.page.slug),
			)
		return {
			results: scored.slice(0, max).map((entry) => ({
				page: entry.page,
				score: entry.score,
				source: "text",
			})),
			total: scored.length,
			recipe: "text",
			mode: "text-only",
		}
	}

	const fetchImpl = async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const raw =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url
		const url = new URL(raw)
		const headers = new Headers(init?.headers)
		if (headers.get("authorization") !== `Bearer ${FIXTURE_ENV.readKey}`) {
			return failure(401, "UNAUTHORIZED", "a read key is required")
		}
		const method = (init?.method ?? "GET").toUpperCase()
		let body: Json = {}
		if (method === "POST") {
			body = JSON.parse(String(init?.body ?? "{}")) as Json
		}
		const scope = method === "POST" ? body.scope : url.searchParams.get("scope")
		const scopeRef =
			method === "POST" ? body.scopeRef : url.searchParams.get("scopeRef")
		if (scope !== FIXTURE_ENV.scope || scopeRef !== FIXTURE_ENV.scopeRef) {
			return failure(403, "FORBIDDEN_SCOPE", "the key cannot read that scope")
		}
		const path = url.pathname

		if (method === "POST" && path === "/v1/wiki/search") {
			return reply(
				search(String(body.query ?? ""), Number(body.maxResults ?? 6)),
			)
		}
		if (method !== "GET") {
			return failure(405, "METHOD_NOT_ALLOWED", "read routes only")
		}
		if (path === "/v1/wiki") {
			const limit = Number(url.searchParams.get("limit") ?? 50)
			const skip = Number(url.searchParams.get("skip") ?? 0)
			return reply({
				pages: pages.slice(skip, skip + limit),
				total: pages.length,
			})
		}
		if (path === "/v1/wiki/lint") {
			const holder = bySlug.get(data.targetPageSlug)
			return reply({
				pages: pages.length,
				total: pages.length,
				unresolvedContradictions:
					holder && recorded
						? [
								{
									pageSlug: holder.slug,
									pageTitle: holder.title,
									contradiction: {
										id: data.record.id,
										claimIds: [data.targetClaimId, data.incomingClaimId],
										detectedAt: data.record.detectedAt,
										resolution: data.record.resolution,
										note: data.record.note,
									},
								},
							]
						: [],
			})
		}
		if (path === "/v1/wiki/changes") {
			const cursor = decodeCursor(url.searchParams.get("cursor"))
			if (url.searchParams.has("cursor") && !cursor) {
				return failure(400, "VALIDATION_ERROR", "the cursor is not valid")
			}
			const sinceParam = url.searchParams.get("since")
			if (cursor && sinceParam !== null && sinceParam !== cursor.since) {
				return failure(400, "VALIDATION_ERROR", "since differs from the cursor")
			}
			const since = cursor?.since ?? sinceParam ?? FIXTURE_FIRST_INGESTION
			const feed = pages
				.flatMap((page) => {
					const plan = data.plans.get(page.slug) ?? []
					const head = { pageSlug: page.slug, title: page.title }
					// The first revision adds what the later ones leave in place, so the
					// feed's claims sum to the page's stored claims, as the API's do.
					const total = page.claims.length
					const net = plan.reduce(
						(sum, [add, change, remove]) =>
							sum +
							Math.min(add, total) -
							Math.min(remove, Math.max(0, total - add - change)),
						0,
					)
					const first = page.claims.slice(0, Math.max(0, total - net))
					const created = {
						...head,
						revision: 1,
						editKind: "create",
						createdAt: page.createdAt,
						baseline: "none",
						baselineRevision: null,
						claims: {
							added: first,
							changed: [],
							removed: [],
							counts: { added: first.length, changed: 0, removed: 0 },
							truncated: false,
						},
					}
					const updates = plan.map(([add, change, remove], at) => {
						const added = page.claims.slice(0, add)
						const changed = page.claims
							.slice(add, add + change)
							.map((claim) => ({
								id: claim.id,
								fields: ["confidence"],
								before: claim,
								after: { ...claim, confidence: claim.confidence * 0.9 },
							}))
						const removed = page.claims.slice(
							add + change,
							add + change + remove,
						)
						return {
							...head,
							revision: at + 2,
							editKind: "update",
							createdAt: new Date(
								Date.parse(page.createdAt) + (at + 1) * REVISION_STEP_MS,
							).toISOString(),
							baseline: "previous",
							baselineRevision: at + 1,
							claims: {
								added,
								changed,
								removed,
								counts: {
									added: added.length,
									changed: changed.length,
									removed: removed.length,
								},
								truncated: false,
							},
						}
					})
					return [created, ...updates]
				})
				.filter((change) => Date.parse(change.createdAt) >= Date.parse(since))
				.sort(
					(a, b) =>
						Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
						a.pageSlug.localeCompare(b.pageSlug) ||
						a.revision - b.revision,
				)
			const asked = Number(url.searchParams.get("limit"))
			const size =
				Number.isInteger(asked) && asked >= 1 ? asked : CHANGES_PAGE_SIZE
			const start = cursor?.after ?? 0
			const end = start + size
			return reply({
				window: { since, until: FIXTURE_UNTIL, settled: true },
				limits: { limit: size, maxClaims: 50 },
				changes: feed.slice(start, end),
				hasMore: end < feed.length,
				...(end < feed.length
					? { nextCursor: encodeCursor({ since, after: end }) }
					: {}),
			})
		}
		if (path.startsWith("/v1/wiki/overview/")) {
			const slug = decodeURIComponent(path.slice("/v1/wiki/overview/".length))
			const page = bySlug.get(slug)
			if (!page) return failure(404, "WIKI_NOT_FOUND", `no page ${slug}`)
			return reply({
				page,
				contradictions: {
					items: slug === data.targetPageSlug && recorded ? [data.record] : [],
					hasMore: false,
				},
				backlinks: { items: [], hasMore: false },
				neighbors: { items: [], hasMore: false },
				revisions: { items: [], hasMore: false },
				limits: {},
			})
		}
		if (path.startsWith("/v1/wiki/")) {
			const slug = decodeURIComponent(path.slice("/v1/wiki/".length))
			const page = bySlug.get(slug)
			return page
				? reply(page)
				: failure(404, "WIKI_NOT_FOUND", `no page ${slug}`)
		}
		if (path === "/v1/cite") {
			const marker = url.searchParams.get("marker") ?? ""
			const citedBy = url.searchParams.get("citedBy")
			const parsed = parseCitationMarker(marker)
			if (
				!parsed.ok ||
				parsed.marker.kind !== "event" ||
				(citedBy !== null && !parseCitationMarker(citedBy).ok)
			) {
				return failure(
					400,
					"INVALID_MARKER",
					"the marker or citedBy is not a citation marker",
				)
			}
			// The real route resolves the event in the caller's scope as the
			// caller's agent (the default "main" when none is sent); the run's
			// events live under the run's own agent, so any other agent finds
			// nothing.
			if (url.searchParams.get("agentId") !== FIXTURE_ENV.agentId) {
				return failure(
					404,
					"CITATION_UNRESOLVED",
					"the source could not be confirmed in this scope",
				)
			}
			const eventId = parsed.marker.eventId
			// With a citing claim the route reads that claim first, and only a
			// claim that lists the event can have it confirmed.
			if (citedBy !== null) {
				const citing = parseCitationMarker(citedBy)
				const citingMarker = citing.ok ? citing.marker : undefined
				const owner =
					citingMarker?.kind === "wiki"
						? bySlug
								.get(citingMarker.slug)
								?.claims.find((claim) => claim.id === citingMarker.claimId)
						: undefined
				if (!owner) {
					return failure(404, "CITATION_NOT_FOUND", "citation not found")
				}
				if (
					!owner.evidence.some(
						(evidence) =>
							evidence.kind === "event" && evidence.sourceId === eventId,
					)
				) {
					return failure(
						404,
						"CITATION_UNRESOLVED",
						"the source could not be confirmed in this scope",
					)
				}
			}
			const sourceId = data.sourceOf.get(eventId) ?? ""
			const body = data.bodies.get(sourceId)
			if (body === undefined)
				return failure(404, "CITATION_UNRESOLVED", `no event ${eventId}`)
			const timestamp = data.dates.get(sourceId)
			return reply({
				status: "resolved",
				kind: "event",
				marker,
				...(citedBy !== null ? { citedBy } : {}),
				event: {
					eventId,
					canonicalId: `event:${eventId}`,
					text: `${ROLE_LABEL}${body}`,
					...(timestamp !== undefined ? { timestamp } : {}),
					scope: FIXTURE_ENV.scope,
					scopeRef: FIXTURE_ENV.scopeRef,
				},
			})
		}
		return failure(404, "NOT_FOUND", `no route ${path}`)
	}

	return { fetch: fetchImpl as typeof fetch, data }
}
