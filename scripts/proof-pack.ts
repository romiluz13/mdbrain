import { MdbrainClient } from "@mdbrain/client"
import proofPackBaseline from "./proof-pack-baseline.js"
import { writeProofArtifact } from "./proof-artifacts.js"

type CheckResult = {
	name: string
	ok: boolean
	details: string
}

const baseUrl = (
	process.env.MDBRAIN_API_URL ?? "http://127.0.0.1:3847"
).replace(/\/$/, "")
const apiKey = process.env.MDBRAIN_API_KEY
const agentId =
	process.env.MDBRAIN_AGENT_ID ??
	`proof-${new Date().toISOString().replace(/[:.]/g, "-")}`
const sessionScope =
	process.env.MDBRAIN_SESSION_ID ??
	process.env.MDBRAIN_CONTAINER_TAG ??
	`proof-session-${new Date().toISOString().replace(/[:.]/g, "-")}`

const client = new MdbrainClient({
	baseUrl,
	apiKey,
})

function getHeaders(): Record<string, string> {
	const headers: Record<string, string> = {}
	if (apiKey?.trim()) {
		headers.Authorization = `Bearer ${apiKey.trim()}`
	}
	return headers
}

async function fetchJson(path: string): Promise<unknown> {
	const response = await fetch(`${baseUrl}${path}`, {
		headers: getHeaders(),
	})
	if (!response.ok) {
		throw new Error(`${path} returned HTTP ${response.status}`)
	}
	return await response.json()
}

function pass(name: string, details: string): CheckResult {
	return { name, ok: true, details }
}

function fail(name: string, details: string): CheckResult {
	return { name, ok: false, details }
}

function summarizeResults(results: CheckResult[]) {
	const passed = results.filter((result) => result.ok).length
	const failed = results.length - passed
	return { passed, failed, total: results.length }
}

async function main() {
	const checks: CheckResult[] = []
	const marker = `proof-pack-${Date.now()}`
	const agentScopeRef = `agent:${agentId}`

	try {
		const health = (await fetchJson("/health")) as {
			ok?: boolean
			service?: string
		}
		checks.push(
			health.ok === true
				? pass("health", `service=${health.service ?? "unknown"}`)
				: fail("health", `unexpected payload: ${JSON.stringify(health)}`),
		)

		const readiness = (await fetchJson("/ready")) as {
			ok?: boolean
			memongo?: { contractVersion?: string }
		}
		checks.push(
			readiness.ok === true
				? pass(
						"readiness",
						`memongo=${readiness.memongo?.contractVersion ?? "unknown"}`,
					)
				: fail("readiness", "Memongo compatibility readiness failed"),
		)

		const openApi = (await fetchJson("/openapi.json")) as {
			paths?: Record<string, unknown>
		}
		const missingPaths = proofPackBaseline.requiredPaths.filter(
			(path) => !openApi.paths?.[path],
		)
		checks.push(
			missingPaths.length === 0
				? pass(
						"openapi",
						`verified ${proofPackBaseline.requiredPaths.length} core paths`,
					)
				: fail("openapi", `missing paths: ${missingPaths.join(", ")}`),
		)

		const writeEvent = await client.writeEvent({
			idempotencyKey: `${marker}:write-event`,
			agentId,
			sessionId: sessionScope,
			role: "user",
			body: `${marker} user prefers concise updates and deploys on Fridays`,
		})
		checks.push(
			writeEvent.ok
				? pass("writeEvent", `eventId=${writeEvent.eventId}`)
				: fail("writeEvent", "write-event did not return ok"),
		)

		const add = await client.add({
			idempotencyKey: `${marker}:add`,
			agentId,
			sessionId: sessionScope,
			content: `${marker} knowledge-base sync runs nightly at 02:00 UTC`,
		})
		checks.push(
			add.ok
				? pass("add", `eventId=${add.eventId}`)
				: fail("add", "add did not return ok"),
		)

		const structured = (await client.writeStructured({
			agentId,
			entry: {
				type: "preference",
				key: `${marker}:preference`,
				value: "prefers concise status reports",
				source: "agent",
				sessionId: sessionScope,
				scope: "agent",
			},
		})) as { upserted?: boolean; id?: string }
		checks.push(
			structured.id
				? pass("writeStructured", `id=${structured.id}`)
				: fail(
						"writeStructured",
						`unexpected payload: ${JSON.stringify(structured)}`,
					),
		)

		const procedure = (await client.writeProcedure({
			agentId,
			entry: {
				procedureId: `${marker}:deploy`,
				name: "Friday deploy checklist",
				intentTags: ["deploy", "release"],
				steps: [
					"Run root quality gates",
					"Review relevance report",
					"Deploy API and web",
				],
				agentId,
				sessionId: sessionScope,
				scope: "agent",
			},
		})) as { upserted?: boolean; id?: string }
		checks.push(
			procedure.id
				? pass("writeProcedure", `id=${procedure.id}`)
				: fail(
						"writeProcedure",
						`unexpected payload: ${JSON.stringify(procedure)}`,
					),
		)

		const search = (await client.search({
			agentId,
			query: "concise deploy status reports",
			limit: 5,
			sessionKey: sessionScope,
		})) as {
			results?: Array<{ path?: string; snippet?: string; score?: number }>
		}
		const topResult = search.results?.[0]
		checks.push(
			search.results && search.results.length > 0
				? pass(
						"search",
						`results=${search.results.length}, top=${topResult?.path ?? "unknown"}`,
					)
				: fail("search", "no search results returned"),
		)

		const detailed = await client.searchDetailed({
			agentId,
			query: "what is the deploy checklist and concise reporting preference",
			limit: 5,
			searchMode: "agentic",
			sourcePreference: ["structured", "procedural"],
			needExactEvidence: true,
			returnPlan: true,
		})
		checks.push(
			detailed.results.length > 0 &&
				Array.isArray(detailed.metadata.pathsExecuted)
				? pass(
						"searchDetailed",
						`paths=${detailed.metadata.pathsExecuted.join(",") || "none"}, evidence=${detailed.metadata.evidenceCoverage}`,
					)
				: fail("searchDetailed", "advanced search returned no evidence"),
		)

		const activeSlate = await client.hydrateActiveSlate({
			agentId,
			scope: "agent",
			scopeRef: agentScopeRef,
			maxItems: 4,
		})
		checks.push(
			activeSlate.items.length > 0
				? pass(
						"hydrateActiveSlate",
						`items=${activeSlate.items.length}, kinds=${activeSlate.items.map((item) => item.kind).join(",")}`,
					)
				: fail("hydrateActiveSlate", "active slate returned no items"),
		)

		const projection = await client.buildDiscoveryProjection({
			agentId,
			kind: "topic-brief",
			query: "deploy",
			scope: "agent",
			scopeRef: agentScopeRef,
			maxItems: 4,
		})
		checks.push(
			projection.sections.length > 0
				? pass(
						"discoveryProjection",
						`kind=${projection.kind}, sections=${projection.sections.length}, evidence=${projection.metadata.evidenceCount}`,
					)
				: fail("discoveryProjection", "projection returned no sections"),
		)

		const contextBundle = await client.buildContextBundle({
			agentId,
			query: "deploy checklist and concise reporting preference",
			scope: "agent",
			scopeRef: agentScopeRef,
			sessionId: sessionScope,
			tokenBudget: 260,
			maxEvidenceItems: 4,
			includeDiscoveryProjection: true,
			discoveryKind: "topic-brief",
		})
		checks.push(
			contextBundle.sections.length > 0
				? pass(
						"contextBundle",
						`sections=${contextBundle.sections.map((section) => section.kind).join(",")}, tokens=${contextBundle.metadata.estimatedTokensUsed}`,
					)
				: fail("contextBundle", "context bundle returned no sections"),
		)

		const profile = (await client.profile({
			agentId,
			maxEntities: 5,
			maxEpisodes: 5,
			scopeRef: sessionScope,
		})) as Record<string, unknown>
		checks.push(
			Object.keys(profile).length > 0
				? pass("profile", `keys=${Object.keys(profile).join(", ")}`)
				: fail("profile", "profile response was empty"),
		)
	} catch (error) {
		checks.push(
			fail(
				"proof-pack",
				error instanceof Error ? error.message : "unknown proof-pack error",
			),
		)
	}

	const missingChecks = proofPackBaseline.requiredChecks.filter(
		(name) => !checks.some((check) => check.name === name),
	)
	if (missingChecks.length > 0) {
		checks.push(
			fail(
				"baseline",
				`missing required proof-pack checks: ${missingChecks.join(", ")}`,
			),
		)
	}

	const summary = summarizeResults(checks)

	for (const result of checks) {
		const prefix = result.ok ? "PASS" : "FAIL"
		console.log(`${prefix} ${result.name}: ${result.details}`)
	}

	const report = {
		baseUrl,
		agentId,
		sessionScope,
		baseline: proofPackBaseline,
		summary,
		checks,
	}
	const artifactPath = await writeProofArtifact({
		suite: "proof-pack",
		payload: report,
	})

	console.log(
		JSON.stringify(
			artifactPath ? { ...report, artifactPath } : report,
			null,
			2,
		),
	)

	if (summary.failed > 0) {
		process.exitCode = 1
	}
}

await main()
