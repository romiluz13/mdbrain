import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	appendRecord,
	readRecords,
	sortRecords,
	trimTornTail,
} from "./corpus-files.js"
import type { RenderedRecord, World } from "./types.js"

const record = (id: string): RenderedRecord => ({
	id,
	body: `body of ${id}`,
	model: "claude-haiku-5-5",
	finishReason: "stop",
	renderedAt: "2026-10-20T00:00:00.000Z",
})
const line = (id: string) => JSON.stringify(record(id))
const world = { sources: [{ id: "a" }, { id: "b" }, { id: "c" }] } as World

let dir: string
beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), "corpus-files-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("checkpoint file", () => {
	it("drops a torn final line from an interrupted append, and says so", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		writeFileSync(
			path.join(dir, "records.jsonl"),
			`${line("a")}\n{"id":"b","bo`,
		)
		expect([...readRecords(dir).keys()]).toEqual(["a"])
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/torn final line/))
		warn.mockRestore()
	})

	it("resumes after a torn final line: trims it, appends, and sorts", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		writeFileSync(
			path.join(dir, "records.jsonl"),
			`${line("a")}\n{"id":"b","bo`,
		)
		trimTornTail(dir)
		appendRecord(record("c"), dir)
		sortRecords(world, dir)
		expect([...readRecords(dir).keys()]).toEqual(["a", "c"])
		expect(readFileSync(path.join(dir, "records.jsonl"), "utf8")).toBe(
			`${line("a")}\n${line("c")}\n`,
		)
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/torn final line/))
		warn.mockRestore()
	})

	it("keeps a complete final record that only lacks its newline", () => {
		writeFileSync(path.join(dir, "records.jsonl"), `${line("a")}\n${line("b")}`)
		trimTornTail(dir)
		appendRecord(record("c"), dir)
		expect([...readRecords(dir).keys()]).toEqual(["a", "b", "c"])
	})

	it("leaves interior corruption for the reader to refuse", () => {
		writeFileSync(path.join(dir, "records.jsonl"), `{"id":"a"\n${line("b")}\n`)
		trimTornTail(dir)
		expect(() => readRecords(dir)).toThrow(/line 1/)
	})

	it("refuses corruption anywhere but the final line", () => {
		writeFileSync(path.join(dir, "records.jsonl"), `{"id":"a"\n${line("b")}\n`)
		expect(() => readRecords(dir)).toThrow(/line 1/)
	})

	it("sorts into source order through a replaced file, leaving no temp file", () => {
		writeFileSync(
			path.join(dir, "records.jsonl"),
			`${line("c")}\n${line("a")}\n`,
		)
		sortRecords(world, dir)
		expect(readFileSync(path.join(dir, "records.jsonl"), "utf8")).toBe(
			`${line("a")}\n${line("c")}\n`,
		)
		expect(readdirSync(dir)).toEqual(["records.jsonl"])
	})
})
