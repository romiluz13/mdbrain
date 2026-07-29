// @mdbrain/wiki-engine — page transclusion.
//
// A wiki page can embed another page's content live via `{{page:slug}}` or
// `{{page:slug#Section}}` markers in its body. Unlike a relationship link
// (a pointer a reader follows), a transclusion is resolved inline at render
// time — when the source page changes, every page that transcludes it shows
// the update automatically, without being edited itself.
//
// This exists specifically to attack a failure mode wiki-contradictions.ts
// can only detect after the fact: the same fact gets copy-pasted onto
// multiple pages, and one copy is updated while the others drift. A shared
// fact transcluded from one source instead of copy-pasted can't drift,
// because there's only ever one copy.

import { createSubsystemLogger } from "@mdbrain/lib"
import {
	getWikiPageGoverned,
	type GovernanceContext,
} from "./wiki-governance.js"
import type { WikiDbHandle } from "./wiki-bridge.js"

const log = createSubsystemLogger("wiki:transclusion")

const TRANSCLUSION_REGEX = /\{\{page:([^}#]+)(?:#([^}]+))?\}\}/g

/** Iterates regex matches without assignment-in-condition. */
function* iterateMatches(
	re: RegExp,
	input: string,
): Generator<RegExpExecArray> {
	for (;;) {
		const m = re.exec(input)
		if (!m) break
		yield m
	}
}

/** Extracts the unique set of page slugs a body transcludes, for storing on
 *  `transcludes[]` (an edge list mirroring `backlinks[]`, computed on write
 *  rather than manually edited). */
export function extractTransclusionTargets(body: string): string[] {
	const targets = new Set<string>()
	TRANSCLUSION_REGEX.lastIndex = 0
	for (const m of iterateMatches(TRANSCLUSION_REGEX, body)) {
		targets.add(m[1].trim())
	}
	return [...targets]
}

/** Extracts one `##`-level section from a page body by heading text
 *  (case-insensitive, trimmed). Returns the whole body if no section name is
 *  given, or undefined if the named section doesn't exist. */
function extractSection(
	body: string,
	sectionName?: string,
): string | undefined {
	if (!sectionName) return body
	const target = sectionName.trim().toLowerCase()
	const lines = body.split("\n")
	const out: string[] = []
	let inSection = false
	for (const line of lines) {
		const headingMatch = /^##\s+(.+)$/.exec(line)
		if (headingMatch) {
			if (inSection) break // next section ends this one
			inSection = headingMatch[1].trim().toLowerCase() === target
			continue
		}
		if (inSection) out.push(line)
	}
	if (!inSection && out.length === 0) return undefined
	return out.join("\n").trim()
}

const MAX_TRANSCLUSION_DEPTH = 5

/** Resolves `{{page:slug}}` / `{{page:slug#Section}}` markers in `body` into
 *  the referenced page's content, recursively (a transcluded page's own
 *  transclusions are resolved too, up to MAX_TRANSCLUSION_DEPTH).
 *
 *  Every referenced page is fetched through the SAME governance context as
 *  the page doing the transcluding — a marker referencing a page the
 *  caller/author can't otherwise read resolves to an inline notice, never
 *  the actual restricted content. This mirrors the OKF export governance
 *  fix: transclusion must never be a side channel around governance.
 *
 *  Unresolvable and circular references degrade to an inline HTML-comment
 *  notice rather than throwing, so one broken transclusion never breaks the
 *  whole page render (same tolerance philosophy as OKF's "consumers MUST
 *  tolerate broken links"). */
export async function resolveTransclusions(
	handle: WikiDbHandle,
	body: string,
	ctx: GovernanceContext,
	opts: { visited?: Set<string>; depth?: number } = {},
): Promise<string> {
	const depth = opts.depth ?? 0
	const visited = opts.visited ?? new Set<string>()
	if (depth >= MAX_TRANSCLUSION_DEPTH) {
		return body.replace(
			TRANSCLUSION_REGEX,
			(full) => `<!-- transclusion depth limit exceeded: ${full} -->`,
		)
	}

	const matches = [...iterateMatches(TRANSCLUSION_REGEX, body)]
	if (matches.length === 0) return body

	// Build the output by position rather than repeated string.replace(marker,
	// ...) — the same {{page:slug}} marker can legitimately appear more than
	// once in a body, and replace() only ever touches the first occurrence,
	// which would leave later duplicates unresolved or misalign replacements.
	let result = ""
	let cursor = 0
	for (const m of matches) {
		const [full, rawSlug, rawSection] = m
		const matchStart = m.index
		result += body.slice(cursor, matchStart)
		cursor = matchStart + full.length

		const targetSlug = rawSlug.trim()
		const section = rawSection?.trim()
		const cycleKey = `${targetSlug}#${section ?? ""}`

		if (visited.has(cycleKey)) {
			result += `<!-- circular transclusion: ${targetSlug} -->`
			continue
		}

		let page: Awaited<ReturnType<typeof getWikiPageGoverned>>
		try {
			page = await getWikiPageGoverned(handle, targetSlug, ctx)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			log.warn(`transclusion lookup failed for ${targetSlug}: ${msg}`)
			page = null
		}
		if (!page) {
			result += `<!-- transclusion not found or not accessible: ${targetSlug} -->`
			continue
		}

		const sectionContent = extractSection(String(page.body ?? ""), section)
		if (sectionContent === undefined) {
			result += `<!-- transclusion section not found: ${targetSlug}#${section} -->`
			continue
		}

		// Recurse so a transcluded page's own transclusions resolve too.
		const nestedVisited = new Set(visited)
		nestedVisited.add(cycleKey)
		const resolved = await resolveTransclusions(handle, sectionContent, ctx, {
			visited: nestedVisited,
			depth: depth + 1,
		})
		result += resolved
	}
	result += body.slice(cursor)
	return result
}
