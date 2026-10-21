import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const WEB = join(__dirname, "../..")

function sourcesUnder(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) {
			return sourcesUnder(path)
		}
		return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
			? [path]
			: []
	})
}

const importing = (pattern: RegExp): string[] =>
	["app", "lib"]
		.flatMap((dir) => sourcesUnder(join(WEB, dir)))
		.filter((path) => pattern.test(readFileSync(path, "utf8")))
		.map((path) => relative(WEB, path))
		.sort()

// The connection string reaches the server only: the driver and the store that
// holds it are imported by the demo API route and by nothing a browser bundle
// can reach.
describe("the control database stays on the server", () => {
	it("is reached by one module, and that module only by the demo API route", () => {
		expect(importing(/from "mongodb"/)).toEqual(["lib/demo-data/run-store.ts"])
		expect(importing(/["']\S*run-store(\.js)?["']/)).toEqual([
			"app/api/demo/v1/[[...path]]/route.ts",
		])
	})
})
