// scripts/stress-test.ts — stress test for the MDBrain wiki engine.
//
// Creates N wiki pages, runs hybrid search, verifies page count, tests
// concurrent writes, and checks for data loss. Run against a live API.
//
// Usage:
//   MDBRAIN_API_URL=http://127.0.0.1:3847 \
//   MDBRAIN_API_KEY=local-dev-secret \
//   bun run scripts/stress-test.ts --pages 1000 --concurrency 10

import { MdbrainClient } from "@mdbrain/client"

const baseUrl = process.env.MDBRAIN_API_URL ?? "http://127.0.0.1:3847"
const apiKey = process.env.MDBRAIN_API_KEY ?? "local-dev-secret"
const scope = "workspace"
const scopeRef = `stress-${Date.now()}`

function parseArgs(): { pages: number; concurrency: number } {
	const args = process.argv.slice(2)
	let pages = 1000
	let concurrency = 10
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--pages" && args[i + 1]) {
			pages = Number(args[i + 1])
			i++
		}
		if (args[i] === "--concurrency" && args[i + 1]) {
			concurrency = Number(args[i + 1])
			i++
		}
	}
	return { pages, concurrency }
}

async function main() {
	const { pages, concurrency } = parseArgs()
	const client = new MdbrainClient({ baseUrl, apiKey })

	console.log(`MDBrain Stress Test`)
	console.log(`  Pages: ${pages}`)
	console.log(`  Concurrency: ${concurrency}`)
	console.log(`  Scope: ${scope}/${scopeRef}`)
	console.log()

	// Phase 1: Bulk page creation
	console.log(`Phase 1: Creating ${pages} wiki pages...`)
	const startTime = Date.now()
	let created = 0
	let errors = 0

	const pageBatches: number[][] = []
	for (let i = 0; i < pages; i += concurrency) {
		pageBatches.push(
			Array.from({ length: Math.min(concurrency, pages - i) }, (_, j) => i + j),
		)
	}

	for (const batch of pageBatches) {
		await Promise.all(
			batch.map(async (i) => {
				try {
					await client.wikiApply({
						kind: "concept",
						title: `Concept ${i}`,
						slug: `concepts/concept-${i}`,
						summary: `This is concept number ${i} about topic ${i % 10}.`,
						body: `# Concept ${i}\n\nDetails about concept ${i}.\n\nRelated to topic ${i % 10}.`,
						frontmatter: { type: "concept", tags: [`topic-${i % 10}`] },
						scope,
						scopeRef,
						trustTier: "standard",
					})
					created++
					if (created % 100 === 0) {
						console.log(`  ...${created}/${pages} created`)
					}
				} catch (err) {
					errors++
					if (errors <= 5) {
						console.error(
							`  Error creating page ${i}: ${err instanceof Error ? err.message : String(err)}`,
						)
					}
				}
			}),
		)
	}

	const createTime = Date.now() - startTime
	console.log(
		`  Created: ${created}/${pages} (${createTime}ms, ${Math.round(created / (createTime / 1000))} pages/sec)`,
	)
	console.log(`  Errors: ${errors}`)
	console.log()

	// Phase 2: Search performance
	console.log(`Phase 2: Search performance (10 queries)...`)
	const searchQueries = [
		"concept topic",
		"details about",
		"related to",
		"concept number",
		"topic 0",
		"topic 5",
		"concept 500",
		"concept 999",
		"nonexistent topic",
		"all concepts",
	]
	const searchTimes: number[] = []
	for (const query of searchQueries) {
		const searchStart = Date.now()
		try {
			const result = await client.wikiSearch({
				query,
				scope,
				scopeRef,
				maxResults: 20,
			})
			const elapsed = Date.now() - searchStart
			searchTimes.push(elapsed)
			const count = Array.isArray(result) ? result.length : 0
			console.log(`  "${query}": ${count} results (${elapsed}ms)`)
		} catch (err) {
			console.error(
				`  Search "${query}" failed: ${err instanceof Error ? err.message : String(err)}`,
			)
		}
	}
	if (searchTimes.length > 0) {
		const avg = Math.round(
			searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length,
		)
		const max = Math.max(...searchTimes)
		const min = Math.min(...searchTimes)
		console.log(`  Search latency: avg=${avg}ms, min=${min}ms, max=${max}ms`)
	}
	console.log()

	// Phase 3: Read verification (sample 50 pages)
	console.log(`Phase 3: Read verification (sampling 50 pages)...`)
	let verified = 0
	let missing = 0
	const sampleSize = Math.min(50, pages)
	for (let i = 0; i < sampleSize; i++) {
		const idx = Math.floor(Math.random() * pages)
		try {
			const page = await client.wikiGet({
				slug: `concepts/concept-${idx}`,
				scope,
				scopeRef,
			})
			if (page) {
				verified++
			} else {
				missing++
			}
		} catch {
			missing++
		}
	}
	console.log(`  Verified: ${verified}/${sampleSize}`)
	console.log(`  Missing: ${missing}`)
	console.log()

	// Phase 4: OKF export
	console.log(`Phase 4: OKF export...`)
	try {
		const exportStart = Date.now()
		await client.wikiExportOkf({
			scope,
			scopeRef,
			outDir: `/tmp/stress-okf-${scopeRef}`,
		})
		const exportTime = Date.now() - exportStart
		console.log(`  Export completed (${exportTime}ms)`)
	} catch (err) {
		console.error(
			`  Export failed: ${err instanceof Error ? err.message : String(err)}`,
		)
	}
	console.log()

	// Phase 5: Lint (contradictions check)
	console.log(`Phase 5: Lint (contradictions + page list)...`)
	try {
		const lintStart = Date.now()
		const lintResult = await client.wikiLint({
			scope,
			scopeRef,
			limit: 100,
		})
		const lintTime = Date.now() - lintStart
		const pages2 = (lintResult as { pages?: unknown[] })?.pages
		console.log(`  Lint completed (${lintTime}ms)`)
		console.log(
			`  Pages returned: ${Array.isArray(pages2) ? pages2.length : "unknown"}`,
		)
	} catch (err) {
		console.error(
			`  Lint failed: ${err instanceof Error ? err.message : String(err)}`,
		)
	}
	console.log()

	// Summary
	const totalTime = Date.now() - startTime
	console.log(`═══ Stress Test Summary ═══`)
	console.log(`  Total time: ${(totalTime / 1000).toFixed(1)}s`)
	console.log(`  Pages created: ${created}/${pages}`)
	console.log(`  Write errors: ${errors}`)
	console.log(
		`  Read verification: ${verified}/${sampleSize} (missing: ${missing})`,
	)
	console.log(`  Scope: ${scope}/${scopeRef}`)
	console.log()

	if (errors === 0 && missing === 0) {
		console.log(`✅ ALL CHECKS PASSED`)
	} else {
		console.log(`❌ ${errors + missing} issues found`)
		// Data loss or write errors must fail the run — CI relies on the exit code.
		process.exit(1)
	}
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
