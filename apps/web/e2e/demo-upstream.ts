// A stand-in for the Mdbrain API behind the demo read proxy, built from the
// committed Northstar corpus. It is NOT a recording of the live stack: the
// pages, claims and sources are the corpus's own, wrapped in the API's response
// shapes, with generated ids and ingestion times. The /demo e2e serves it
// through the real proxy handler (handleDemoRead), so the allowlist, the
// server-set principal and the read key are exercised, not bypassed.
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { formatCitationMarker, parseCitationMarker } from "@mdbrain/client"
import type { DemoProxyEnv } from "../lib/demo-data/proxy.js"

export const FIXTURE_ENV: DemoProxyEnv = {
	apiBaseUrl: "http://upstream.test",
	readKey: "e2e-read-key",
	scope: "workspace",
	scopeRef: "demo-run-e2e",
	agentId: "demo-run-e2e",
}

export const FIXTURE_FIRST_INGESTION = "2026-10-20T09:00:00.000Z"
const FIXTURE_UNTIL = "2026-10-20T10:00:00.000Z"
const DETECTED_AT = "2026-10-20T09:43:00.000Z"
const PAGE_STEP_MS = 20_000
const REVISION_STEP_MS = 5 * 60_000
// The live feed pages at 100 revisions and the seeded run holds 109, so its
// feed spans two pages. The fixture's revisions are fewer; a smaller page keeps
// the same shape.
const CHANGES_PAGE_SIZE = 40

type ChangesCursor = { since: string; after: number }

// Opaque to the page, as the real cursor is: it carries the window and the
// position after the last entry returned.
const encodeCursor = (cursor: ChangesCursor): string =>
	Buffer.from(JSON.stringify(cursor)).toString("base64url")

function decodeCursor(raw: string | null): ChangesCursor | null {
	if (raw === null) {
		return null
	}
	try {
		const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
		return typeof parsed?.since === "string" && Number.isInteger(parsed.after)
			? { since: parsed.since, after: parsed.after }
			: null
	} catch {
		return null
	}
}

/** What each revision after the first did to the page's claims: how many it
 * added, changed and removed. The corpus has one revision per page; these later
 * ones give the value checks tiers, states and counts that differ. */
type RevisionPlan = Array<[added: number, changed: number, removed: number]>

const tierOf = (type: string): "restricted" | "standard" | "admin" =>
	type === "policy" ? "admin" : type === "incidents" ? "restricted" : "standard"

const stateOf = (position: number): "active" | "superseded" | "draft" =>
	position % 13 === 6 ? "superseded" : position % 17 === 8 ? "draft" : "active"

export function corpusDir(): string {
	for (const root of [join(process.cwd(), ".."), join(process.cwd(), "apps")]) {
		const dir = join(root, "demo-agents", "corpus", "northstar")
		if (existsSync(join(dir, "world.json"))) {
			return dir
		}
	}
	throw new Error("the Northstar corpus is not found next to apps/web")
}

type WorldClaim = {
	id: string
	text: string
	confidence: number
	evidence: Array<{ sourceId: string }>
}
type WorldPage = {
	slug: string
	kind: string
	type: string
	title: string
	summary: string
	tags?: string[]
	claims: WorldClaim[]
	relationships: Array<{ targetPageSlug: string; kind: string }>
	body: string
}
type World = {
	pages: WorldPage[]
	sources: Array<{ id: string; date: string }>
	contradiction: {
		targetPageSlug: string
		targetClaimId: string
		incoming: WorldPage
	}
}

// Memongo names an event by a UUID, not by the id the corpus gave its source.
// The UUID is derived from the corpus id so a run of the fixture is repeatable.
export function eventIdOf(sourceId: string): string {
	const hex = createHash("sha1")
		.update(`northstar-fixture:${sourceId}`)
		.digest("hex")
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		`5${hex.slice(13, 16)}`,
		`${((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}`,
		hex.slice(20, 32),
	].join("-")
}

// What Memongo stores in front of an event ingested as a user message.
const ROLE_LABEL = "User: "

function words(text: string): string[] {
	return (text.toLowerCase().match(/[a-z0-9$%]+/g) ?? []).filter(
		(word) => word.length >= 3,
	)
}

type Json = Record<string, unknown>

function build(padTo = 0, withContradiction = true, unsourced = false) {
	const dir = corpusDir()
	const world = JSON.parse(
		readFileSync(join(dir, "world.json"), "utf8"),
	) as World
	const bodies = new Map<string, string>()
	for (const line of readFileSync(join(dir, "records.jsonl"), "utf8").split(
		"\n",
	)) {
		if (line.trim() !== "") {
			const record = JSON.parse(line) as { id: string; body: string }
			bodies.set(record.id, record.body)
		}
	}
	const dates = new Map(world.sources.map((source) => [source.id, source.date]))
	const sourceOf = new Map(
		[...bodies.keys()].map((sourceId) => [eventIdOf(sourceId), sourceId]),
	)
	const { targetPageSlug, targetClaimId, incoming } = world.contradiction
	const incomingClaimId = incoming.claims[0]?.id ?? ""
	const basePages = world.pages.some((page) => page.slug === incoming.slug)
		? world.pages
		: [...world.pages, incoming]
	// A stress variant: corpus pages cloned, each linked back to its original,
	// to reach a node budget the corpus alone does not.
	const worldPages = [...basePages]
	for (
		let copy = 0;
		basePages.length > 0 && worldPages.length < padTo;
		copy++
	) {
		const original = basePages[copy % basePages.length] as WorldPage
		worldPages.push({
			...original,
			slug: `${original.slug}-copy-${copy}`,
			title: `${original.title} (copy ${copy})`,
			claims: original.claims.map((claim) => ({
				...claim,
				id: `${claim.id}-copy-${copy}`,
			})),
			relationships: [
				...original.relationships,
				{ targetPageSlug: original.slug, kind: "copy-of" },
			],
		})
	}
	const contradicted = new Set(
		withContradiction ? [targetClaimId, incomingClaimId] : [],
	)

	const plans = new Map<string, RevisionPlan>()
	const pages = worldPages.map((page, position) => {
		const plan: RevisionPlan =
			page.slug === targetPageSlug
				? [[0, 1, 0]]
				: position % 11 === 3
					? [[1, 1, 1]]
					: position % 11 === 7
						? [
								[1, 0, 0],
								[0, 1, 1],
							]
						: []
		plans.set(page.slug, plan)
		const revision = plan.length + 1
		const createdMs =
			Date.parse(FIXTURE_FIRST_INGESTION) + position * PAGE_STEP_MS
		const createdAt = new Date(createdMs).toISOString()
		return {
			_id: `page-${position}`,
			kind: page.kind,
			title: page.title,
			slug: page.slug,
			aliases: [],
			summary: page.summary,
			body: page.body,
			frontmatter: { type: page.type, tags: page.tags ?? [] },
			claims: page.claims.map((claim) => ({
				id: claim.id,
				text: claim.text,
				status: contradicted.has(claim.id) ? "contradicted" : "active",
				confidence: claim.confidence,
				marker: formatCitationMarker({
					kind: "wiki",
					slug: page.slug,
					claimId: claim.id,
					revision,
				}),
				evidence:
					unsourced && claim.id === incomingClaimId
						? []
						: claim.evidence.map((item) => ({
								kind: "event" as const,
								sourceId: eventIdOf(item.sourceId),
								marker: formatCitationMarker({
									kind: "event",
									eventId: eventIdOf(item.sourceId),
								}),
							})),
				derivedFrom: [],
			})),
			contradictions: [],
			questions: [],
			relationships: page.relationships.map((link) => ({
				targetPageSlug: link.targetPageSlug,
				kind: link.kind,
			})),
			personCard: null,
			scope: FIXTURE_ENV.scope,
			scopeRef: FIXTURE_ENV.scopeRef,
			trustTier: tierOf(page.type),
			permissions: {},
			state: stateOf(position),
			revision,
			validFrom: null,
			freshness: "fresh",
			backlinks: [],
			transcludes: [],
			createdAt,
			updatedAt: new Date(
				createdMs + plan.length * REVISION_STEP_MS,
			).toISOString(),
		}
	})
	const bySlug = new Map(pages.map((page) => [page.slug, page]))
	const target = bySlug.get(targetPageSlug)
	const other = bySlug.get(incoming.slug)
	const record = {
		id: "contradiction-halvorsen-renewal",
		detectedAt: DETECTED_AT,
		resolution: "unresolved",
		note: "The two claims make opposite statements about the same renewal.",
		claims: [target, other].flatMap((page) => {
			const claim = page?.claims.find((c) => contradicted.has(c.id))
			return page && claim
				? [
						{
							pageSlug: page.slug,
							pageTitle: page.title,
							revision: page.revision,
							claim,
						},
					]
				: []
		}),
	}
	return {
		pages,
		bySlug,
		plans,
		record,
		bodies,
		dates,
		sourceOf,
		targetPageSlug,
		targetClaimId,
		incomingClaimId,
	}
}

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
