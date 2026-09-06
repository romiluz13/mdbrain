// Deterministic end-to-end smoke for the full compose bundle
// (docker/compose.full.yml): boots nothing itself — point it at a running
// stack and it verifies the wiring: API auth, the memory write path
// (api → memongo → MongoDB), the memory read path, and the wiki path
// (api → wiki-engine → MongoDB). No LLM or embedding keys required: the
// wiki gate polls the DEFAULT hybrid recipe, which $rankFusion serves via
// the text lane when the auto-embed vector index is absent (verified live
// on atlas-local:preview keyless). An invalid VOYAGE_API_KEY is NOT
// tolerated: the query-embedding call fails and hybrid search 503s — the
// smoke fails and prints the /ready search capability block as the
// diagnostic (negative-path evidence, not a fake pass).
//
// Keyless boots: the FIRST memory write waits out memongo's one-time
// index-bootstrap horizon (~60s; measured live 61.7s first write, 51ms
// second write). The writeEvent call below carries a 180s deadline to
// cover it; the compose bundle raises the bridge deadline likewise
// (MEMONGO_TIMEOUT_MS). Keyed boots do not hit the wait (vector indexes
// register and the bootstrap completes quickly).
//
// Usage:
//   docker compose -f docker/compose.full.yml up -d
//   MDBRAIN_API_KEY=dev-mdbrain-key bun scripts/compose-smoke.ts
//
// Environment:
//   MDBRAIN_API_URL   default http://127.0.0.1:3847
//   MDBRAIN_API_KEY   required in production-mode containers
//   MDBRAIN_WEB_URL   default http://127.0.0.1:3040; set empty to skip

import { randomUUID } from "node:crypto"
import { MdbrainClient } from "@mdbrain/client"

const apiUrl = process.env.MDBRAIN_API_URL?.trim() ?? "http://127.0.0.1:3847"
const apiKey = process.env.MDBRAIN_API_KEY?.trim() || undefined
const webUrl = process.env.MDBRAIN_WEB_URL?.trim() ?? "http://127.0.0.1:3040"
const agentId = `compose-smoke-${randomUUID().slice(0, 8)}`
const marker = `Ampere Heron ${randomUUID().slice(0, 8)}`
const slug = `concepts/compose-smoke-${randomUUID().slice(0, 8)}`
const wikiScope = "agent"
const wikiScopeRef = `agent:${agentId}`

const client = new MdbrainClient({ baseUrl: apiUrl, apiKey, maxRetries: 2 })

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function fail(message: string): never {
	console.error(`compose-smoke: FAIL ${message}`)
	process.exit(1)
}

async function waitFor(
	label: string,
	probe: () => Promise<boolean>,
	timeoutMs: number,
	onTimeout?: () => Promise<void>,
): Promise<void> {
	const deadline = Date.now() + timeoutMs
	for (;;) {
		if (await probe()) return
		if (Date.now() > deadline) {
			if (onTimeout) await onTimeout()
			fail(`${label} did not become ready in time`)
		}
		await sleep(1_000)
	}
}

/** Fetch /ready and print the wiki search capability block — the diagnostic
 *  for a failed wiki gate (e.g. invalid VOYAGE_API_KEY: vector lane reports
 *  "unavailable" there while hybrid search 503s). Never secrets. */
async function printSearchCapabilities(): Promise<void> {
	try {
		const res = await fetch(`${apiUrl}/ready`)
		const body = (await res.json()) as {
			wiki?: { search?: Record<string, unknown> }
		}
		console.error(
			`compose-smoke: /ready (${res.status}) wiki.search = ${JSON.stringify(
				body.wiki?.search,
			)}`,
		)
	} catch (err) {
		console.error(
			`compose-smoke: could not fetch /ready for diagnostics: ${
				err instanceof Error ? err.message : String(err)
			}`,
		)
	}
}

async function main(): Promise<void> {
	await waitFor(
		"API readiness",
		async () => {
			try {
				const res = await fetch(`${apiUrl}/ready`)
				return res.status === 200
			} catch {
				return false
			}
		},
		120_000,
	)

	if (webUrl) {
		await waitFor(
			"Web console",
			async () => {
				try {
					const res = await fetch(webUrl)
					return res.ok
				} catch {
					return false
				}
			},
			60_000,
		)
	}

	// Memory write path: api → memongo → MongoDB. The FIRST write in a
	// keyless boot waits out memongo's one-time index-bootstrap horizon
	// (~60s, no embedding model registered); the default client deadline
	// (10s) cannot cover it, so this call carries an explicit long one.
	const written = await client.writeEvent(
		{
			role: "user",
			body: `Decided: the compose-smoke marker for this run is ${marker}.`,
			idempotencyKey: randomUUID(),
			agentId,
		},
		{ timeoutMs: 180_000 },
	)
	if (!written.ok || !written.eventId) {
		fail(`writeEvent did not return an event id: ${JSON.stringify(written)}`)
	}
	console.log(`compose-smoke: wrote event ${written.eventId}`)

	// Memory read path. The write→index pipeline is asynchronous, so poll
	// until the marker surfaces (text-lane fallback keeps this keyless).
	await waitFor(
		"marker recall",
		async () => {
			const res = await client.search({ query: marker, agentId, limit: 5 })
			return res.results.some((r) => r.snippet.includes(marker))
		},
		120_000,
	)
	console.log("compose-smoke: marker recalled via /v1/search")

	// Wiki write path: api → wiki-engine → MongoDB (transactional create).
	const headers: Record<string, string> = { "content-type": "application/json" }
	if (apiKey) headers.authorization = `Bearer ${apiKey}`
	const createRes = await fetch(`${apiUrl}/v1/wiki`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			kind: "concept",
			title: `Compose Smoke ${marker}`,
			slug,
			summary: `Smoke page about the ${marker} migration pattern.`,
			body: `# Compose Smoke ${marker}\n\nThe ${marker} winters near the reservoir.`,
			frontmatter: { type: "concept" },
			scope: wikiScope,
			scopeRef: wikiScopeRef,
			trustTier: "standard",
		}),
	})
	if (createRes.status !== 201) {
		fail(
			`wiki page create returned ${createRes.status}: ${await createRes.text()}`,
		)
	}
	console.log(`compose-smoke: created wiki page ${slug}`)

	// Wiki search gate: poll the DEFAULT hybrid recipe until the exact slug
	// returns. Empty results are NOT a pass — a stack that swallows the page
	// (dead text lane, misrouted scope) must fail here, not report success
	// (W1.6). Keyless runs pass honestly: $rankFusion serves the text lane
	// without the vector index (verified live). Invalid-key runs 503 and fail
	// here — by design; the /ready capability block explains why.
	await waitFor(
		"wiki hybrid search returns the created page",
		async () => {
			try {
				const wiki = (await client.wikiSearch({
					query: marker,
					maxResults: 5,
					scope: wikiScope,
					scopeRef: wikiScopeRef,
				})) as { results?: Array<{ page?: { slug?: string } }> }
				return (wiki.results ?? []).some((r) => r.page?.slug === slug)
			} catch {
				// 503 SEARCH_UNAVAILABLE (invalid key / search outage) — keep
				// polling; the timeout path prints the capability diagnostic.
				return false
			}
		},
		120_000,
		printSearchCapabilities,
	)
	console.log(`compose-smoke: wiki hybrid search returned ${slug}`)

	console.log("compose-smoke: PASS")
}

main().catch(async (error) => {
	await printSearchCapabilities()
	fail(error instanceof Error ? error.message : String(error))
})
