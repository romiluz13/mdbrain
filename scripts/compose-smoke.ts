// Deterministic end-to-end smoke for the full compose bundle
// (docker/compose.full.yml): boots nothing itself — point it at a running
// stack and it verifies the wiring: API auth, the memory write path
// (api → memongo → MongoDB), the memory read path, and the wiki path
// (api → wiki-engine → MongoDB). No LLM or embedding keys required: search
// falls back to the text lane.
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
): Promise<void> {
	const deadline = Date.now() + timeoutMs
	for (;;) {
		if (await probe()) return
		if (Date.now() > deadline) fail(`${label} did not become ready in time`)
		await sleep(1_000)
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

	// Memory write path: api → memongo → MongoDB.
	const written = await client.writeEvent({
		role: "user",
		body: `Decided: the compose-smoke marker for this run is ${marker}.`,
		idempotencyKey: randomUUID(),
		agentId,
	})
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

	// Wiki path: api → wiki-engine → MongoDB. An empty result set is fine;
	// the assertion is that the query resolves without error. The wiki
	// surface requires explicit scope identity (REV-07 C11 parity), so pass
	// the canonical agent scope the write landed in: `agent:<agentId>`.
	const wiki = (await client.wikiSearch({
		query: marker,
		maxResults: 5,
		scope: "agent",
		scopeRef: `agent:${agentId}`,
	})) as { results?: unknown[] }
	if (
		typeof wiki !== "object" ||
		wiki === null ||
		!Array.isArray(wiki.results)
	) {
		fail(`wikiSearch returned an unexpected shape: ${JSON.stringify(wiki)}`)
	}
	console.log(`compose-smoke: wiki search ok (${wiki.results.length} results)`)

	console.log("compose-smoke: PASS")
}

main().catch((error) => {
	fail(error instanceof Error ? error.message : String(error))
})
