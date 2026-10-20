import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs"
import { fileURLToPath } from "node:url"
import type { RenderedRecord, World } from "./types.js"

export const CORPUS_DIR = fileURLToPath(
	new URL("../../corpus/northstar/", import.meta.url),
)
const WORLD_FILE = `${CORPUS_DIR}world.json`
const RECORDS_FILE = `${CORPUS_DIR}records.jsonl`

export function writeWorld(world: World): void {
	mkdirSync(CORPUS_DIR, { recursive: true })
	writeFileSync(WORLD_FILE, `${JSON.stringify(world, null, "\t")}\n`)
}

export function readWorld(): World {
	return JSON.parse(readFileSync(WORLD_FILE, "utf8")) as World
}

export function readRecords(): Map<string, RenderedRecord> {
	if (!existsSync(RECORDS_FILE)) return new Map()
	const records = readFileSync(RECORDS_FILE, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as RenderedRecord)
	return new Map(records.map((r) => [r.id, r]))
}

export function appendRecord(record: RenderedRecord): void {
	appendFileSync(RECORDS_FILE, `${JSON.stringify(record)}\n`)
}

// Rewrites the checkpoint file in source order so the committed file diffs
// cleanly regardless of the order parallel renders finished in.
export function sortRecords(world: World): void {
	const records = readRecords()
	const lines = world.sources.flatMap((s) => {
		const r = records.get(s.id)
		return r ? [JSON.stringify(r)] : []
	})
	writeFileSync(RECORDS_FILE, lines.length ? `${lines.join("\n")}\n` : "")
}
