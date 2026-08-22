import { describe, expect, it } from "vitest"
import { metadata } from "./layout.js"

describe("showcase metadata", () => {
	it("describes the governed knowledge and memory architecture", () => {
		expect(metadata.title).toBe("MDBrain | The living context system")
		expect(metadata.description).toContain("governed company knowledge")
		expect(metadata.description).toContain("long-term agent memory")
		expect(metadata.openGraph?.images).toEqual([
			{
				url: "/opengraph-image",
				width: 1200,
				height: 630,
				alt: "MDBrain maps sources, governed knowledge, long-term memory, MongoDB retrieval, and evidence into one living context system.",
			},
		])
	})
})
