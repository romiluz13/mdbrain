import { describe, expect, it } from "vitest"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

// Vitest runs with the package directory as the working directory, so the
// demo-data sources resolve from there without import.meta (which the web
// tsconfig does not allow in test files).
const DATA_DIR = join(process.cwd(), "lib", "demo-data")
const FIXTURE_SPECIFIERS = ["demo-scenario", "@mdbrain/demo"]

async function sourceFiles(): Promise<string[]> {
	const entries = await readdir(DATA_DIR, { withFileTypes: true })
	return entries
		.filter(
			(entry) =>
				entry.isFile() &&
				entry.name.endsWith(".ts") &&
				!entry.name.endsWith(".test.ts"),
		)
		.map((entry) => join(DATA_DIR, entry.name))
}

describe("demo data layer", () => {
	it("imports nothing from the demo fixture", async () => {
		const files = await sourceFiles()
		expect(files.length).toBeGreaterThan(0)
		for (const file of files) {
			const source = await readFile(file, "utf8")
			for (const specifier of FIXTURE_SPECIFIERS) {
				expect(
					source.includes(specifier),
					`${file} references ${specifier}`,
				).toBe(false)
			}
		}
	})
})
