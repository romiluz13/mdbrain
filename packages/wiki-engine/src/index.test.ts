import { describe, it, expect } from "vitest"
import { WIKI_ENGINE_VERSION } from "./index.js"

describe("@mdbrain/wiki-engine scaffold", () => {
	it("exports a version string", () => {
		expect(typeof WIKI_ENGINE_VERSION).toBe("string")
		expect(WIKI_ENGINE_VERSION).toBe("2.0.0")
	})
})
