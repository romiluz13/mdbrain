import { describe, expect, it } from "vitest"
import { access, readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

// Vitest runs with the package directory as the working directory, so the
// demo sources resolve from there without import.meta (which the web
// tsconfig does not allow in test files).
const ROOT = process.cwd()
const DATA_DIR = join(ROOT, "lib", "demo-data")
const PAGE_DIR = join(ROOT, "app", "demo")
const FIXTURE_FILE = join(ROOT, "lib", "marketing", "demo-scenario.ts")
const FIXTURE_SPECIFIERS = ["demo-scenario", "@mdbrain/demo"]

async function sourceFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true })
	const files: string[] = []
	for (const entry of entries) {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) {
			files.push(...(await sourceFiles(path)))
		} else if (
			/\.(ts|tsx)$/.test(entry.name) &&
			!/\.test\.(ts|tsx)$/.test(entry.name)
		) {
			files.push(path)
		}
	}
	return files
}

async function expectNoFixtureImport(dir: string): Promise<void> {
	const files = await sourceFiles(dir)
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
}

describe("demo data layer", () => {
	it("imports nothing from the demo fixture", async () => {
		await expectNoFixtureImport(DATA_DIR)
	})
})

describe("the /demo page", () => {
	it("imports nothing from the demo fixture, in the page or any component", async () => {
		await expectNoFixtureImport(PAGE_DIR)
	})

	it("no longer ships the static scenario", async () => {
		await expect(access(FIXTURE_FILE)).rejects.toThrow()
	})
})
