// scripts/mdbrian-migrate.ts — Legacy migration CLI (T9).
//
// Usage:
//   bun run scripts/mdbrian-migrate.ts [--scope <scope>] [--scopeRef <ref>] [--dry-run]
//
// Migrates structured_mem + procedures records into wiki_pages. Idempotent.

import { mdbrianBridgeGetManager } from "@mdbrian/memory-bridge"
import {
	migrateLegacyToWiki,
	checkMigrationCoverage,
	getWikiDbHandle,
} from "@mdbrian/wiki-engine"

function parseArgs(argv: string[]): {
	scope?: string
	scopeRef?: string
	dryRun: boolean
} {
	const opts: { scope?: string; scopeRef?: string; dryRun: boolean } = {
		dryRun: false,
	}
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i]
		const next = argv[i + 1]
		switch (arg) {
			case "--scope":
				if (!next || next.startsWith("--")) {
					console.error("--scope requires a value")
					process.exit(1)
				}
				opts.scope = next
				i++
				break
			case "--scopeRef":
				if (!next || next.startsWith("--")) {
					console.error("--scopeRef requires a value")
					process.exit(1)
				}
				opts.scopeRef = next
				i++
				break
			case "--dry-run":
				opts.dryRun = true
				break
			default:
				console.error(`unknown arg: ${arg}`)
				process.exit(1)
		}
	}
	return opts
}

async function main() {
	const opts = parseArgs(process.argv)
	const agentId = process.env.MDBRAIN_AGENT_ID ?? "default"
	const manager = await mdbrianBridgeGetManager(agentId)
	const handle = getWikiDbHandle(manager)

	console.log(
		opts.dryRun
			? "MDBrain migration (DRY RUN — no writes)..."
			: "MDBrian migration...",
	)
	const result = await migrateLegacyToWiki(handle, {
		scope: opts.scope,
		scopeRef: opts.scopeRef,
		dryRun: opts.dryRun,
	})
	console.log("\nMigration results:")
	console.log(
		`  structured_mem: ${result.structuredMemMigrated}/${result.structuredMemTotal} migrated, ${result.structuredMemSkipped} skipped`,
	)
	console.log(
		`  procedures:     ${result.proceduresMigrated}/${result.proceduresTotal} migrated, ${result.proceduresSkipped} skipped`,
	)
	console.log(`  pages created:  ${result.pagesCreated}`)
	console.log(`  claims added:   ${result.claimsAdded}`)

	if (!opts.dryRun) {
		console.log("\nCoverage check:")
		const coverage = await checkMigrationCoverage(handle, {
			scope: opts.scope,
			scopeRef: opts.scopeRef,
		})
		const memPct =
			coverage.structuredMemTotal > 0
				? Math.round(
						(coverage.structuredMemCovered / coverage.structuredMemTotal) * 100,
					)
				: 100
		const procPct =
			coverage.proceduresTotal > 0
				? Math.round(
						(coverage.proceduresCovered / coverage.proceduresTotal) * 100,
					)
				: 100
		console.log(
			`  structured_mem: ${coverage.structuredMemCovered}/${coverage.structuredMemTotal} (${memPct}%)`,
		)
		console.log(
			`  procedures:     ${coverage.proceduresCovered}/${coverage.proceduresTotal} (${procPct}%)`,
		)
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err))
	process.exit(1)
})
