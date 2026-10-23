// The Northstar fixture world behind the stand-in Mdbrain API in
// demo-upstream.ts: the committed corpus wrapped in the API's response shapes,
// with generated ids and ingestion times.
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { formatCitationMarker } from "@mdbrain/client"
import type { DemoProxyEnv } from "../lib/demo-data/proxy.js"

export const FIXTURE_ENV: DemoProxyEnv = {
	apiBaseUrl: "http://upstream.test",
	readKey: "e2e-read-key",
	scope: "workspace",
	scopeRef: "demo-run-e2e",
	agentId: "demo-run-e2e",
}

export const FIXTURE_FIRST_INGESTION = "2026-10-20T09:00:00.000Z"
export const FIXTURE_UNTIL = "2026-10-20T10:00:00.000Z"
const DETECTED_AT = "2026-10-20T09:43:00.000Z"
const PAGE_STEP_MS = 20_000
export const REVISION_STEP_MS = 5 * 60_000
// The live feed pages at 100 revisions and the seeded run holds 109, so its
// feed spans two pages. The fixture's revisions are fewer; a smaller page keeps
// the same shape.
export const CHANGES_PAGE_SIZE = 40

type ChangesCursor = { since: string; after: number }

// Opaque to the page, as the real cursor is: it carries the window and the
// position after the last entry returned.
export const encodeCursor = (cursor: ChangesCursor): string =>
	Buffer.from(JSON.stringify(cursor)).toString("base64url")

export function decodeCursor(raw: string | null): ChangesCursor | null {
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
export const ROLE_LABEL = "User: "

export function words(text: string): string[] {
	return (text.toLowerCase().match(/[a-z0-9$%]+/g) ?? []).filter(
		(word) => word.length >= 3,
	)
}

export type Json = Record<string, unknown>

export function build(padTo = 0, withContradiction = true, unsourced = false) {
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
