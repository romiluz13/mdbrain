// scripts/maintenance-run.ts — operator-triggered maintenance CLI (agreed
// plan W3). Two subcommands:
//
//   git-diff: detect changed source files (vs each tracked page's
//             maintenanceHash) and regenerate affected wiki pages via the
//             configured LLM.
//   dreamer:  promote events from a JSONL file to wiki pages through the
//             LLM classifier (phases 3+4); --importer heuristic-importer is
//             the explicit legacy opt-in.
//
// Usage (the MongoDB driver requires Node, not Bun):
//   bun run wiki:maintenance git-diff --source src/a.ts [--source src/b.ts]
//       [--scope workspace] [--scopeRef default] [--dry-run] [--json]
//   bun run wiki:maintenance dreamer --events events.jsonl
//       [--scope workspace] [--scopeRef default] [--dry-run] [--json]
//       [--importer heuristic-importer]
//
// LLM config (both subcommands, non-dry-run): MDBRAIN_LLM_BASE_URL,
// MDBRAIN_LLM_API_KEY, MDBRAIN_LLM_MODEL (see scripts/lib/openai-compatible-llm.ts).
// MongoDB: MDBRAIN_WIKI_MONGODB_URI (same contract as the API).
//
// Exit codes: 0 success, 1 item errors or fatal error, 2 usage error.
// --dry-run performs detection only: no LLM calls, no writes.

import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import {
	detectChangedSources,
	runDreamerPromotion,
	runGitDiffMaintenance,
	type EventInput,
	type MaintenanceResult,
	WikiStore,
	resolveWikiStoreConfig,
} from "@mdbrain/wiki-engine"
import { asDreamerClassifier, asLlmGenerateFn } from "./lib/maintenance-llm.js"
import {
	LlmConfigError,
	resolveLlmConfigFromEnv,
} from "./lib/openai-compatible-llm.js"

interface CliArgs {
	command: "git-diff" | "dreamer"
	sources: string[]
	eventsFile?: string
	scope: string
	scopeRef: string
	dryRun: boolean
	json: boolean
	heuristicImporter: boolean
	trustTier?: string
	agentId?: string
}

const USAGE = `usage:
  maintenance-run.ts git-diff --source <file> [--source <file>...]
      [--scope <scope>] [--scopeRef <ref>] [--trust-tier <tier>]
      [--agent-id <id>] [--dry-run] [--json]
  maintenance-run.ts dreamer --events <jsonl-file>
      [--scope <scope>] [--scopeRef <ref>] [--importer heuristic-importer]
      [--dry-run] [--json]`

/** Parses CLI arguments (exported for tests). Exits with code 2 on usage
 *  errors — call with valid argv in tests. */
export function parseArgs(argv: string[]): CliArgs {
	const [command, ...rest] = argv.slice(2)
	if (command !== "git-diff" && command !== "dreamer") {
		console.error(
			`unknown or missing subcommand: ${command ?? "(none)"}\n${USAGE}`,
		)
		process.exit(2)
	}
	const args: CliArgs = {
		command,
		sources: [],
		eventsFile: undefined,
		scope: "workspace",
		scopeRef: "default",
		dryRun: false,
		json: false,
		heuristicImporter: false,
	}
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i]
		const next = rest[i + 1]
		const value = () => {
			if (!next || next.startsWith("--")) {
				console.error(`${arg} requires a value\n${USAGE}`)
				process.exit(2)
			}
			i++
			return next
		}
		switch (arg) {
			case "--source":
				args.sources.push(value())
				break
			case "--events":
				args.eventsFile = value()
				break
			case "--scope":
				args.scope = value()
				break
			case "--scopeRef":
				args.scopeRef = value()
				break
			case "--trust-tier":
				args.trustTier = value()
				break
			case "--agent-id":
				args.agentId = value()
				break
			case "--dry-run":
				args.dryRun = true
				break
			case "--json":
				args.json = true
				break
			case "--importer":
				if (value() !== "heuristic-importer") {
					console.error("--importer only accepts heuristic-importer")
					process.exit(2)
				}
				args.heuristicImporter = true
				break
			default:
				console.error(`unknown arg: ${arg}\n${USAGE}`)
				process.exit(2)
		}
	}
	if (command === "git-diff" && args.sources.length === 0) {
		console.error(`git-diff requires at least one --source file\n${USAGE}`)
		process.exit(2)
	}
	if (command === "dreamer" && !args.eventsFile) {
		console.error(`dreamer requires --events <jsonl-file>\n${USAGE}`)
		process.exit(2)
	}
	return args
}

/** Loads and validates the LLM config for a non-dry-run maintenance pass. */
function requireLlmConfig() {
	try {
		return resolveLlmConfigFromEnv()
	} catch (err) {
		if (err instanceof LlmConfigError) {
			console.error(
				`maintenance requires an LLM (dry-run performs detection only): ${err.message}`,
			)
		} else {
			throw err
		}
		process.exit(1)
	}
}

/** Parses one JSONL file of EventInput records (exported for tests). */
export function loadEvents(path: string): EventInput[] {
	const text = readFileSync(path, "utf8")
	const events: EventInput[] = []
	const lines = text.split("\n")
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim()
		if (line.length === 0) continue
		try {
			const raw = JSON.parse(line) as {
				id?: unknown
				text?: unknown
				embedding?: unknown
				timestamp?: unknown
				agentId?: unknown
			}
			if (typeof raw.id !== "string" || typeof raw.text !== "string") {
				throw new Error('each event needs string "id" and "text"')
			}
			if (
				raw.embedding !== undefined &&
				(!Array.isArray(raw.embedding) ||
					raw.embedding.some((v) => typeof v !== "number"))
			) {
				throw new Error('"embedding" must be an array of numbers')
			}
			if (raw.timestamp !== undefined && typeof raw.timestamp !== "string") {
				throw new Error('"timestamp" must be an ISO-8601 string')
			}
			events.push({
				id: raw.id,
				text: raw.text,
				embedding: raw.embedding as number[] | undefined,
				timestamp:
					typeof raw.timestamp === "string"
						? new Date(raw.timestamp)
						: undefined,
				agentId: typeof raw.agentId === "string" ? raw.agentId : undefined,
			})
		} catch (err) {
			console.error(
				`${path}:${i + 1}: invalid event record (${err instanceof Error ? err.message : String(err)})`,
			)
			process.exit(1)
		}
	}
	return events
}

export function printResult(
	result: MaintenanceResult & { dryRun?: boolean },
	json: boolean,
) {
	if (json) {
		console.log(JSON.stringify(result, null, 2))
		return
	}
	console.log(`maintenance source:      ${result.source}`)
	if (result.dryRun)
		console.log("mode:                    dry-run (detection only)")
	console.log(`pages processed:         ${result.pagesProcessed}`)
	console.log(`pages regenerated:       ${result.pagesRegenerated}`)
	console.log(`claims added:            ${result.claimsAdded}`)
	console.log(`claims rejected:         ${result.claimsRejected}`)
	console.log(`contradictions detected: ${result.contradictionsDetected}`)
	if (result.extractionMode) {
		console.log(`extraction mode:         ${result.extractionMode}`)
	}
	if (result.errors.length > 0) {
		console.log("errors:")
		for (const e of result.errors) console.log(`  - ${e}`)
	}
}

async function main() {
	const args = parseArgs(process.argv)
	const store = new WikiStore(resolveWikiStoreConfig())
	try {
		await store.initialize()
		const handle = store.handle()

		if (args.command === "git-diff") {
			const sources = args.sources.map((path) => ({
				path,
				content: readFileSync(path, "utf8"),
			}))
			const changed = await detectChangedSources(
				handle,
				sources,
				args.scope,
				args.scopeRef,
			)
			if (args.dryRun) {
				printResult(
					{
						source: "git-diff",
						pagesProcessed: changed.length,
						pagesRegenerated: 0,
						claimsAdded: 0,
						claimsRejected: 0,
						contradictionsDetected: 0,
						errors: [],
						extractionMode: "llm",
						dryRun: true,
					},
					args.json,
				)
				return
			}
			const config = requireLlmConfig()
			const result = await runGitDiffMaintenance(
				handle,
				changed,
				asLlmGenerateFn(config),
				{
					scope: args.scope,
					scopeRef: args.scopeRef,
					trustTier: args.trustTier,
					agentId: args.agentId,
				},
			)
			printResult(result, args.json)
			if (result.errors.length > 0) process.exitCode = 1
		} else {
			const events = loadEvents(args.eventsFile as string)
			if (args.dryRun) {
				printResult(
					{
						source: "dreamer",
						pagesProcessed: events.length,
						pagesRegenerated: 0,
						claimsAdded: 0,
						claimsRejected: 0,
						contradictionsDetected: 0,
						errors: [],
						extractionMode: args.heuristicImporter
							? "heuristic-importer"
							: "llm",
						dryRun: true,
					},
					args.json,
				)
				return
			}
			const result = await runDreamerPromotion(handle, events, {
				scope: args.scope,
				scopeRef: args.scopeRef,
				trustTier: args.trustTier,
				agentId: args.agentId,
				classifier: args.heuristicImporter
					? undefined
					: asDreamerClassifier(requireLlmConfig()),
				importer: args.heuristicImporter ? "heuristic-importer" : undefined,
			})
			printResult(result, args.json)
			if (result.errors.length > 0) process.exitCode = 1
		}
	} finally {
		await store.close()
	}
}

// Run only when invoked directly (imports for tests skip this).
const invokedDirectly =
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
	main().catch((err) => {
		console.error(err instanceof Error ? err.message : String(err))
		process.exit(1)
	})
}
