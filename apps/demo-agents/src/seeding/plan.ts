import type { PageSpec, RenderedRecord, World } from "../corpus/types.js"
import { eventKey, pageKey } from "./ids.js"
import { planEvidenceNote } from "../evidence.js"

export type PlannedEvent = {
	sourceId: string
	idempotencyKey: string
	timestamp: string
	body: string
	role: "user"
	metadata: Record<string, string>
}

export type PlannedClaim = {
	id: string
	text: string
	confidence: number
	// `sourceId` is the logical corpus source; the seeder swaps in the eventId
	// returned by write-event before the claim reaches the wiki API.
	evidence: { sourceId: string; note: string }[]
}

export type PlannedRelationship = {
	targetPageSlug: string
	targetTitle: string
	kind: string
}

export type PlannedPage = {
	slug: string
	idempotencyKey: string
	kind: string
	title: string
	summary: string
	body: string
	frontmatter: { type: string; tags: string[] }
	claims: PlannedClaim[]
	relationships: PlannedRelationship[]
}

export type LoadPlanCounts = {
	eventsPlanned: number
	pagesPlanned: number
	replaySourcesHeldBack: number
	pagesHeldBack: number
	relationshipsOmitted: number
	evidenceRefsPlanned: number
}

export type LoadPlan = {
	events: PlannedEvent[]
	pages: PlannedPage[]
	heldBackSourceIds: string[]
	heldBackPageSlugs: string[]
	counts: LoadPlanCounts
}

/** Builds the deterministic write plan for one run slot.
 *
 * Events are history sources in timeline order (business date, then id).
 * Pages are ordered topologically (relationship targets before the pages
 * that cite them; cycles are broken by slug order rather than rejected).
 * Replay-phase sources — and any page whose evidence cites one — are held
 * back for the role agents. `limitSources` takes a deterministic timeline
 * prefix, for fast checks. */
export function buildLoadPlan(
	world: World,
	records: Map<string, RenderedRecord>,
	options: { scopeRef: string; limitSources?: number },
): LoadPlan {
	const history = world.sources
		.filter((source) => source.phase === "history")
		.sort(byTimeline)
	const replay = world.sources
		.filter((source) => source.phase === "replay")
		.sort(byTimeline)

	const selected = history.slice(
		0,
		options.limitSources === undefined
			? history.length
			: Math.max(0, options.limitSources),
	)

	const events: PlannedEvent[] = selected.map((source) => {
		const record = records.get(source.id)
		if (!record) {
			throw new Error(
				`corpus is incomplete: no rendered record for history source ${source.id}`,
			)
		}
		const metadata: Record<string, string> = {
			seedSourceId: source.id,
			seedSourceKind: source.kind,
		}
		if (source.storyline) metadata.seedStoryline = source.storyline
		return {
			sourceId: source.id,
			idempotencyKey: eventKey(options.scopeRef, source.id),
			timestamp: source.date,
			body: record.body,
			role: "user",
			metadata,
		}
	})

	const available = new Set(events.map((event) => event.sourceId))
	const titles = new Map(world.pages.map((spec) => [spec.slug, spec.title]))

	const includedSpecs: PageSpec[] = []
	const heldBackPageSlugs: string[] = []
	for (const spec of world.pages) {
		const citesUnavailable = spec.claims.some((claim) =>
			claim.evidence.some((ev) => !available.has(ev.sourceId)),
		)
		if (citesUnavailable) {
			heldBackPageSlugs.push(spec.slug)
		} else {
			includedSpecs.push(spec)
		}
	}

	const plannedSlugs = new Set(includedSpecs.map((spec) => spec.slug))
	let relationshipsOmitted = 0
	let evidenceRefsPlanned = 0
	const pages: PlannedPage[] = orderTopologically(includedSpecs).map((spec) => {
		const relationships: PlannedRelationship[] = []
		let omitted = 0
		for (const rel of spec.relationships) {
			const targetTitle = titles.get(rel.targetPageSlug)
			if (targetTitle === undefined) {
				throw new Error(
					`corpus is incomplete: page ${spec.slug} relates to unknown slug ${rel.targetPageSlug}`,
				)
			}
			if (!plannedSlugs.has(rel.targetPageSlug)) {
				omitted++
				continue
			}
			relationships.push({
				targetPageSlug: rel.targetPageSlug,
				targetTitle,
				kind: rel.kind,
			})
		}
		relationshipsOmitted += omitted
		const claims: PlannedClaim[] = spec.claims.map((claim) => ({
			id: claim.id,
			text: claim.text,
			confidence: claim.confidence,
			evidence: claim.evidence.map((ev) => planEvidenceNote(ev, records)),
		}))
		evidenceRefsPlanned += claims.reduce(
			(sum, claim) => sum + claim.evidence.length,
			0,
		)
		return {
			slug: spec.slug,
			idempotencyKey: pageKey(options.scopeRef, spec.slug),
			kind: spec.kind,
			title: spec.title,
			summary: spec.summary,
			body: spec.body,
			frontmatter: { type: spec.type, tags: spec.tags },
			claims,
			relationships,
		}
	})

	return {
		events,
		pages,
		heldBackSourceIds: replay.map((source) => source.id),
		heldBackPageSlugs,
		counts: {
			eventsPlanned: events.length,
			pagesPlanned: pages.length,
			replaySourcesHeldBack: replay.length,
			pagesHeldBack: heldBackPageSlugs.length,
			relationshipsOmitted,
			evidenceRefsPlanned,
		},
	}
}

function byTimeline(
	a: { date: string; id: string },
	b: { date: string; id: string },
): number {
	return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1
}

/** Kahn's algorithm with a slug-priority ready set: among pages whose
 * targets are all emitted, the smallest slug goes first. A cycle (the corpus
 * should not have one) leaves a remainder that is appended in slug order. */
function orderTopologically(specs: PageSpec[]): PageSpec[] {
	const targetsOf = new Map<string, Set<string>>()
	const dependents = new Map<string, string[]>()
	const indegree = new Map<string, number>()
	for (const spec of specs) {
		const targets = new Set(
			spec.relationships
				.map((rel) => rel.targetPageSlug)
				.filter((slug) => slug !== spec.slug),
		)
		targetsOf.set(spec.slug, targets)
		indegree.set(spec.slug, targets.size)
		for (const target of targets) {
			dependents.set(target, [...(dependents.get(target) ?? []), spec.slug])
		}
	}
	const ready = [...indegree.entries()]
		.filter(([, degree]) => degree === 0)
		.map(([slug]) => slug)
		.sort()
	const ordered: PageSpec[] = []
	const bySlug = new Map(specs.map((spec) => [spec.slug, spec]))
	while (ready.length) {
		const slug = ready.shift() as string
		const spec = bySlug.get(slug)
		if (spec) ordered.push(spec)
		for (const dependent of (dependents.get(slug) ?? []).slice().sort()) {
			const degree = (indegree.get(dependent) ?? 1) - 1
			indegree.set(dependent, degree)
			if (degree === 0) {
				ready.push(dependent)
				ready.sort()
			}
		}
	}
	if (ordered.length < specs.length) {
		const emitted = new Set(ordered.map((spec) => spec.slug))
		const remainder = specs
			.filter((spec) => !emitted.has(spec.slug))
			.sort((a, b) => (a.slug < b.slug ? -1 : 1))
		ordered.push(...remainder)
	}
	return ordered
}
