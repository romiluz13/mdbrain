// maintenance-run.ts tests — pure-CLI coverage (arg parsing, JSONL event
// loading, summary rendering, usage errors). The end-to-end dry-run paths
// were validated live against the local stack (see the ddd comparison
// record); they are intentionally not re-run here since they need MongoDB.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { loadEvents, parseArgs, printResult } from "./maintenance-run.js"

function withTempFile(content: string, fn: (path: string) => void) {
	const dir = mkdtempSync(join(tmpdir(), "mdbrain-cli-"))
	const path = join(dir, "events.jsonl")
	writeFileSync(path, content)
	try {
		fn(path)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}

describe("parseArgs", () => {
	it("parses a full git-diff invocation", () => {
		const args = parseArgs([
			"node",
			"maintenance-run.ts",
			"git-diff",
			"--source",
			"src/a.ts",
			"--source",
			"src/b.ts",
			"--scope",
			"tenant",
			"--scopeRef",
			"t-1",
			"--dry-run",
			"--json",
		])
		expect(args).toMatchObject({
			command: "git-diff",
			sources: ["src/a.ts", "src/b.ts"],
			scope: "tenant",
			scopeRef: "t-1",
			dryRun: true,
			json: true,
			heuristicImporter: false,
		})
	})

	it("parses a dreamer invocation with the explicit heuristic opt-in", () => {
		const args = parseArgs([
			"node",
			"maintenance-run.ts",
			"dreamer",
			"--events",
			"events.jsonl",
			"--importer",
			"heuristic-importer",
		])
		expect(args).toMatchObject({
			command: "dreamer",
			eventsFile: "events.jsonl",
			heuristicImporter: true,
			dryRun: false,
			json: false,
		})
	})

	it("exits with code 2 on an unknown subcommand", () => {
		const exit = vi.spyOn(process, "exit").mockImplementation((() => {
			throw new Error("exited")
		}) as never)
		const error = vi.spyOn(console, "error").mockImplementation(() => {})
		expect(() => parseArgs(["node", "maintenance-run.ts", "cron"])).toThrow(
			"exited",
		)
		expect(exit).toHaveBeenCalledWith(2)
		expect(error).toHaveBeenCalledWith(expect.stringContaining("cron"))
		exit.mockRestore()
		error.mockRestore()
	})

	it("exits with code 2 when git-diff has no sources", () => {
		const exit = vi.spyOn(process, "exit").mockImplementation((() => {
			throw new Error("exited")
		}) as never)
		vi.spyOn(console, "error").mockImplementation(() => {})
		expect(() => parseArgs(["node", "maintenance-run.ts", "git-diff"])).toThrow(
			"exited",
		)
		expect(exit).toHaveBeenCalledWith(2)
		exit.mockRestore()
		vi.restoreAllMocks()
	})
})

describe("loadEvents", () => {
	it("parses records with embeddings and timestamps, skipping blank lines", () => {
		withTempFile(
			'{"id":"e1","text":"one","embedding":[0.1,0.2],"timestamp":"2026-09-06T00:00:00.000Z","agentId":"a1"}\n\n{"id":"e2","text":"two"}\n',
			(path) => {
				const events = loadEvents(path)
				expect(events).toEqual([
					{
						id: "e1",
						text: "one",
						embedding: [0.1, 0.2],
						timestamp: new Date("2026-09-06T00:00:00.000Z"),
						agentId: "a1",
					},
					{ id: "e2", text: "two" },
				])
			},
		)
	})

	it("exits with code 1 naming the line for an invalid record", () => {
		withTempFile('{"id":"e1"}\n', (path) => {
			const exit = vi.spyOn(process, "exit").mockImplementation((() => {
				throw new Error("exited")
			}) as never)
			const error = vi.spyOn(console, "error").mockImplementation(() => {})
			expect(() => loadEvents(path)).toThrow("exited")
			expect(exit).toHaveBeenCalledWith(1)
			expect(error).toHaveBeenCalledWith(
				expect.stringContaining(`${path}:1: invalid event record`),
			)
			exit.mockRestore()
			error.mockRestore()
		})
	})
})

describe("printResult", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("renders the JSON summary verbatim", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {})
		printResult(
			{
				source: "git-diff",
				pagesProcessed: 2,
				pagesRegenerated: 1,
				claimsAdded: 3,
				claimsRejected: 0,
				contradictionsDetected: 0,
				errors: [],
				extractionMode: "llm",
				dryRun: true,
			},
			true,
		)
		expect(log).toHaveBeenCalledTimes(1)
		const printed = JSON.parse(String(log.mock.calls[0][0])) as Record<
			string,
			unknown
		>
		expect(printed).toMatchObject({ source: "git-diff", dryRun: true })
	})

	it("discloses extraction mode and errors in human mode", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {})
		printResult(
			{
				source: "dreamer",
				pagesProcessed: 1,
				pagesRegenerated: 0,
				claimsAdded: 0,
				claimsRejected: 1,
				contradictionsDetected: 1,
				errors: ["event e1: classifier returned an invalid injection"],
				extractionMode: "heuristic-importer",
			},
			false,
		)
		const lines = log.mock.calls.map((c) => String(c[0]))
		expect(lines.join("\n")).toContain("extraction mode:")
		expect(lines.join("\n")).toContain("heuristic-importer")
		expect(lines.join("\n")).toContain("contradictions detected: 1")
		expect(lines.join("\n")).toContain("event e1: classifier returned")
	})
})
