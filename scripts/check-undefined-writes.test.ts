// Repo lint rule (CH-001 / WS-5 item 1): every raw MongoDB document write in
// the wiki engine must route its documents/update objects through
// omitUndefined (or carry an explicit, justified exemption below).
//
// Rationale: the MongoDB Node driver serializes `undefined` property values
// to BSON null, which fails the $jsonSchema validators on wiki_pages /
// wiki_revisions (defect class C2-15 / NB-1). Mock-only unit tests cannot
// catch this — only a live validator does — so this static rule keeps the
// defect class from regressing between live-harness runs.
//
// This file is a test, not a script: it runs as part of `bun run test`
// (`bunx vitest run scripts/*.test.ts`) and in CI.

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const SRC_DIR = join(
	resolve(import.meta.dirname, ".."),
	"packages",
	"wiki-engine",
	"src",
)

/** MongoDB collection methods that write documents. */
const WRITE_CALL =
	/\.(insertOne|updateOne|findOneAndUpdate|findOneAndDelete|findOneAndReplace|bulkWrite|replaceOne)\s*\(/

/**
 * Files with write calls that are exempt from the omitUndefined rule.
 * Every entry MUST carry a justification; stale entries fail the test so
 * exemptions cannot silently outlive the code they describe.
 */
const EXEMPT: Record<string, string> = {
	"memory-delivery.ts":
		"every $set/$setOnInsert literal writes fully-defined values only; verified by memory-delivery.test.ts and WS-4 validations (V-026..V-038)",
	"wiki-mutation-intents.ts":
		"intent documents are fully initialized from typed params; the payload is stored as a sha256 fingerprint string, never as a caller-supplied document",
}

describe("check-undefined-writes (WS-5 item 1 lint rule)", () => {
	it("routes every wiki-engine Mongo write site through omitUndefined", () => {
		const offenders: string[] = []
		const files = readdirSync(SRC_DIR)
			.filter(
				(name) =>
					name.endsWith(".ts") &&
					!name.endsWith(".test.ts") &&
					!name.endsWith(".d.ts"),
			)
			.map((name) => join(SRC_DIR, name))
			.filter((full) => existsSync(full))
		for (const full of files) {
			const source = readFileSync(full, "utf8")
			if (!WRITE_CALL.test(source)) continue
			const relative = full.slice(SRC_DIR.length + 1)
			if (EXEMPT[relative]) continue
			if (source.includes("omitUndefined")) continue
			offenders.push(relative)
		}
		expect(
			offenders,
			`wiki-engine write sites bypassing omitUndefined (add the helper, or add a justified exemption to EXEMPT in scripts/check-undefined-writes.test.ts): ${offenders.join(", ")}`,
		).toEqual([])
	})

	it("has no stale exemption entries", () => {
		for (const [relative, justification] of Object.entries(EXEMPT)) {
			expect(
				justification.trim().length,
				`exemption for ${relative} must carry a justification`,
			).toBeGreaterThan(10)
			const full = join(SRC_DIR, relative)
			expect(
				existsSync(full),
				`exempted file ${relative} no longer exists`,
			).toBe(true)
			const source = readFileSync(full, "utf8")
			expect(
				WRITE_CALL.test(source),
				`${relative} is exempt but performs no Mongo write calls — remove the exemption`,
			).toBe(true)
		}
	})
})
