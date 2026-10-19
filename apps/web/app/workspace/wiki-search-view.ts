import { asNumber, asRecord, asString } from "./values.js"

export type WikiHit = {
	slug: string
	title: string
	kind?: string
	summary?: string
	revision?: number
	state?: string
	scope?: string
	scopeRef?: string
	score?: number
	source?: string
}

export type WikiSearchView = {
	hits: WikiHit[]
	total?: number
	recipe?: string
	mode?: string
}

/** `wikiSearch` is typed `unknown` in the SDK. Read only the fields we show and
 *  return null when the body is not a search response at all. */
export function parseWikiSearch(raw: unknown): WikiSearchView | null {
	const body = asRecord(raw)
	if (!body || !Array.isArray(body.results)) {
		return null
	}
	const hits: WikiHit[] = []
	for (const entry of body.results) {
		const result = asRecord(entry)
		const page = asRecord(result?.page)
		const slug = asString(page?.slug)
		if (!result || !page || !slug) {
			return null
		}
		hits.push({
			slug,
			title: asString(page.title) ?? slug,
			kind: asString(page.kind),
			summary: asString(page.summary),
			revision: asNumber(page.revision),
			state: asString(page.state),
			scope: asString(page.scope),
			scopeRef: asString(page.scopeRef),
			score: asNumber(result.score),
			source: asString(result.source),
		})
	}
	return {
		hits,
		total: asNumber(body.total),
		recipe: asString(body.recipe),
		mode: asString(body.mode),
	}
}
