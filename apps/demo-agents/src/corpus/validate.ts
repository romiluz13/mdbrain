import { areContradictory, textOverlap } from "@mdbrain/wiki-engine"
import { isScreenedName, realCompaniesIn } from "./names.js"
import type { ClaimSpec, PageSpec, RenderedRecord, World } from "./types.js"

const QUARTER = { from: "2026-07-01", to: "2026-09-30T23:59:59.999Z" }

function duplicates(values: string[]): string[] {
	const seen = new Set<string>()
	return values.filter((v) => {
		if (seen.has(v)) return true
		seen.add(v)
		return false
	})
}

const contradicts = (a: ClaimSpec, b: ClaimSpec) =>
	areContradictory({ id: a.id, text: a.text }, { id: b.id, text: b.text })

export function validateWorld(world: World): string[] {
	const errors: string[] = []
	const people = new Set(world.people.map((p) => p.id))
	const accounts = new Set(world.accounts.map((a) => a.id))
	const products = new Set(world.products.map((p) => p.id))
	const sources = new Map(world.sources.map((s) => [s.id, s]))
	const pages = new Map(world.pages.map((p) => [p.slug, p]))
	const person = (where: string, id: string) => {
		if (!people.has(id)) errors.push(`${where}: unknown person ${id}`)
	}

	const allClaims = [...world.pages, world.contradiction.incoming].flatMap(
		(p) => p.claims.map((c) => c.id),
	)
	for (const [label, ids] of [
		["person id", world.people.map((p) => p.id)],
		["person name", world.people.map((p) => p.name)],
		["account id", world.accounts.map((a) => a.id)],
		["account name", world.accounts.map((a) => a.name)],
		["source id", world.sources.map((s) => s.id)],
		[
			"page slug",
			[...world.pages.map((p) => p.slug), world.contradiction.incoming.slug],
		],
		["claim id", allClaims],
	] as const) {
		for (const dup of duplicates([...ids]))
			errors.push(`duplicate ${label} ${dup}`)
	}

	for (const a of world.accounts) {
		if (!isScreenedName(a.name))
			errors.push(`account name ${a.name} matches a well-known company`)
		for (const id of [a.ownerId, a.csmId, a.championId, ...a.contactIds])
			person(a.id, id)
		for (const p of a.productIds)
			if (!products.has(p)) errors.push(`${a.id}: unknown product ${p}`)
	}
	for (const p of world.people) {
		if (p.org !== "northstar" && !accounts.has(p.org))
			errors.push(`${p.id}: unknown org ${p.org}`)
	}

	for (const s of world.sources) {
		person(s.id, s.authorId)
		for (const id of s.participantIds) person(s.id, id)
		if (s.accountId && !accounts.has(s.accountId))
			errors.push(`${s.id}: unknown account ${s.accountId}`)
		for (const p of s.productIds)
			if (!products.has(p)) errors.push(`${s.id}: unknown product ${p}`)
		if (s.date < QUARTER.from || s.date > QUARTER.to)
			errors.push(`${s.id}: date ${s.date} outside Q3 2026`)
		if (!s.facts.length || s.facts.some((f) => !f.trim()))
			errors.push(`${s.id}: needs non-empty facts`)
	}

	const checkClaims = (page: PageSpec, allowReplay: boolean) => {
		for (const r of page.relationships) {
			if (!pages.has(r.targetPageSlug) || r.targetPageSlug === page.slug)
				errors.push(`${page.slug}: bad relationship target ${r.targetPageSlug}`)
		}
		for (const c of page.claims) {
			if (!c.evidence.length) errors.push(`${c.id}: claim has no evidence`)
			for (const e of c.evidence) {
				const source = sources.get(e.sourceId)
				if (!source) {
					errors.push(`${c.id}: unknown source ${e.sourceId}`)
					continue
				}
				if (!source.facts.includes(e.anchor))
					errors.push(
						`${c.id}: anchor "${e.anchor}" is not a fact of ${e.sourceId}`,
					)
				if (!c.text.toLowerCase().includes(e.anchor.toLowerCase()))
					errors.push(
						`${c.id}: claim text does not state its anchor "${e.anchor}"`,
					)
				if (source.phase === "replay" && !allowReplay)
					errors.push(`${c.id}: base claim cites replay source ${e.sourceId}`)
			}
		}
		for (const [i, a] of page.claims.entries()) {
			for (const b of page.claims.slice(i + 1)) {
				if (textOverlap(a.text, b.text) >= 0.8)
					errors.push(
						`${page.slug}: claims ${a.id} and ${b.id} are near-duplicates`,
					)
			}
		}
	}
	for (const page of world.pages) checkClaims(page, false)

	// The shipped detector compares a written page's claims with the claims of
	// the pages it links to; the base wiki must not trip it anywhere.
	for (const page of world.pages) {
		for (const r of page.relationships) {
			for (const a of page.claims) {
				for (const b of pages.get(r.targetPageSlug)?.claims ?? []) {
					if (contradicts(a, b))
						errors.push(`unplanned: ${a.id} contradicts ${b.id}`)
				}
			}
		}
	}

	const { targetPageSlug, targetClaimId, incoming } = world.contradiction
	checkClaims(incoming, true)
	const target = pages.get(targetPageSlug)
	const planned = incoming.claims[0]
	if (!target?.claims.some((c) => c.id === targetClaimId))
		errors.push(`contradiction target ${targetClaimId} missing`)
	if (!incoming.relationships.some((r) => r.targetPageSlug === targetPageSlug))
		errors.push("contradiction page has no relationship to its target")
	if (planned && target) {
		const hits = target.claims
			.filter((c) => contradicts(planned, c))
			.map((c) => c.id)
		if (hits.length !== 1 || hits[0] !== targetClaimId)
			errors.push(
				`planned claim contradicts [${hits.join(", ")}], expected exactly ${targetClaimId}`,
			)
	}

	for (const story of world.storylines) {
		const own = story.sourceIds.map((id) => sources.get(id))
		if (own.length < 3 || own.some((s) => !s || s.storyline !== story.id))
			errors.push(
				`storyline ${story.id} needs at least three of its own sources`,
			)
		if (!own.some((s) => s?.phase === "replay"))
			errors.push(`storyline ${story.id} has nothing to replay`)
	}
	return errors
}

export function validateRendered(
	world: World,
	records: Map<string, RenderedRecord>,
): string[] {
	const errors: string[] = []
	const ids = new Set(world.sources.map((s) => s.id))
	for (const id of records.keys())
		if (!ids.has(id)) errors.push(`${id}: rendered record has no source spec`)
	for (const s of world.sources) {
		const record = records.get(s.id)
		if (!record) {
			errors.push(`${s.id}: not rendered`)
			continue
		}
		if (record.finishReason !== "stop")
			errors.push(
				`${s.id}: truncated or unfinished (finish: ${record.finishReason ?? "unrecorded"})`,
			)
		const body = record.body.toLowerCase()
		for (const fact of s.facts)
			if (!body.includes(fact.toLowerCase()))
				errors.push(`${s.id}: missing fact "${fact}"`)
		const brands = realCompaniesIn(record.body)
		if (brands.length)
			errors.push(`${s.id}: names a real company (${brands.join(", ")})`)
	}
	return errors
}
