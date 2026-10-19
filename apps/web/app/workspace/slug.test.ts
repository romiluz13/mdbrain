import { describe, expect, it } from "vitest"
import { slugify } from "./slug.js"

describe("slugify", () => {
	it("makes a flat, readable slug from user text", () => {
		expect(slugify("  Identity rollout: v3 decision! ")).toBe(
			"identity-rollout-v3-decision",
		)
		expect(slugify("Café déjà vu")).toBe("cafe-deja-vu")
		expect(slugify("???")).toBe("")
	})
})
