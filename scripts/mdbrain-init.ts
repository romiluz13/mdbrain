// scripts/mdbrain-init.ts — Map & Pointer generator CLI (T8).
//
// Usage:
//   bun run scripts/mdbrain-init.ts [--kind <kind>] [--scope <scope>] [--scopeRef <ref>]
//                                   [--files AGENTS.md,CLAUDE.md] [--max-pages 50]
//
// Connects to MongoDB (via the same config as the API), fetches wiki pages,
// and writes a "## MDBrain Wiki Map" block to the target files (default:
// AGENTS.md + CLAUDE.md). Idempotent — re-run to refresh.

import {
	generateAndWriteWikiMap,
	type MapPointerOptions,
	WikiStore,
	resolveWikiStoreConfig,
} from "@mdbrain/wiki-engine"

function parseArgs(argv: string[]): {
	files: string[]
	opts: MapPointerOptions
} {
	const files: string[] = []
	const opts: MapPointerOptions = {}
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i]
		const next = argv[i + 1]
		switch (arg) {
			case "--files":
				if (next) files.push(...next.split(","))
				i++
				break
			case "--kind":
				if (!next || next.startsWith("--")) {
					console.error(`--kind requires a value`)
					process.exit(1)
				}
				opts.kind = next
				i++
				break
			case "--scope":
				if (!next || next.startsWith("--")) {
					console.error(`--scope requires a value`)
					process.exit(1)
				}
				opts.scope = next
				i++
				break
			case "--scopeRef":
				if (!next || next.startsWith("--")) {
					console.error(`--scopeRef requires a value`)
					process.exit(1)
				}
				opts.scopeRef = next
				i++
				break
			case "--max-pages":
				if (!next || next.startsWith("--")) {
					console.error(`--max-pages requires a value`)
					process.exit(1)
				}
				opts.maxPages = Number(next)
				i++
				break
			case "--heading":
				if (!next || next.startsWith("--")) {
					console.error(`--heading requires a value`)
					process.exit(1)
				}
				opts.heading = next
				i++
				break
			default:
				console.error(`unknown arg: ${arg}`)
				process.exit(1)
		}
	}
	if (files.length === 0) files.push("AGENTS.md", "CLAUDE.md")
	return { files, opts }
}

async function main() {
	const { files, opts } = parseArgs(process.argv)
	const store = new WikiStore(resolveWikiStoreConfig())
	try {
		await store.initialize()
		const result = await generateAndWriteWikiMap(store.handle(), files, opts)
		console.log(`MDBrain Wiki Map written to ${result.files.length} file(s):`)
		for (const f of result.files) {
			console.log(`  ${f}`)
		}
	} finally {
		await store.close()
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err))
	process.exit(1)
})
