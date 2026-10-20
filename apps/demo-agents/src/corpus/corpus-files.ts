import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	truncateSync,
	writeFileSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { RenderedRecord, World } from "./types.js"

export const CORPUS_DIR = fileURLToPath(
	new URL("../../corpus/northstar/", import.meta.url),
)
const worldFile = (dir: string) => path.join(dir, "world.json")
const recordsFile = (dir: string) => path.join(dir, "records.jsonl")

export function writeWorld(world: World, dir = CORPUS_DIR): void {
	mkdirSync(dir, { recursive: true })
	writeFileSync(worldFile(dir), `${JSON.stringify(world, null, "\t")}\n`)
}

export function readWorld(dir = CORPUS_DIR): World {
	return JSON.parse(readFileSync(worldFile(dir), "utf8")) as World
}

// An interrupted append can leave one torn final line; that record is simply
// rendered again. Damage anywhere else is not an interrupted append, so it
// stops the run instead of being skipped.
export function readRecords(dir = CORPUS_DIR): Map<string, RenderedRecord> {
	if (!existsSync(recordsFile(dir))) return new Map()
	const lines = readFileSync(recordsFile(dir), "utf8").split("\n")
	const records = new Map<string, RenderedRecord>()
	for (const [index, line] of lines.entries()) {
		if (!line) continue
		try {
			const record = JSON.parse(line) as RenderedRecord
			records.set(record.id, record)
		} catch (error) {
			if (index === lines.length - 1) {
				console.warn(
					`records.jsonl: dropped a torn final line (line ${index + 1})`,
				)
				continue
			}
			throw new Error(`records.jsonl: line ${index + 1} is not valid JSON`, {
				cause: error,
			})
		}
	}
	return records
}

// Run before the first append of a resumed render: a torn final line left in
// place would have the next record glued onto it, corrupting a line that is
// no longer last. Only an unparsable tail after the last newline is removed.
export function trimTornTail(dir = CORPUS_DIR): void {
	const file = recordsFile(dir)
	if (!existsSync(file)) return
	const text = readFileSync(file, "utf8")
	if (!text || text.endsWith("\n")) return
	const cut = text.lastIndexOf("\n") + 1
	let complete = true
	try {
		JSON.parse(text.slice(cut))
	} catch {
		complete = false
	}
	if (complete) {
		appendFileSync(file, "\n")
		return
	}
	console.warn(
		`records.jsonl: removed a torn final line (line ${text.slice(0, cut).split("\n").length})`,
	)
	truncateSync(file, Buffer.byteLength(text.slice(0, cut)))
}

export function appendRecord(record: RenderedRecord, dir = CORPUS_DIR): void {
	appendFileSync(recordsFile(dir), `${JSON.stringify(record)}\n`)
}

// Rewrites the checkpoint in source order so the committed file diffs cleanly
// whatever order parallel renders finished in. The new content goes to a temp
// file that replaces the checkpoint by rename, so an interruption leaves
// either the old file or the new one, never a truncated one.
export function sortRecords(world: World, dir = CORPUS_DIR): void {
	const records = readRecords(dir)
	const lines = world.sources.flatMap((s) => {
		const r = records.get(s.id)
		return r ? [JSON.stringify(r)] : []
	})
	const temp = `${recordsFile(dir)}.tmp`
	writeFileSync(temp, lines.length ? `${lines.join("\n")}\n` : "")
	renameSync(temp, recordsFile(dir))
}
