import { describe, expect, it } from "vitest"
import { plainText } from "./markdown.js"
import { sourceLabel, splitRoleLabel, viewSource } from "./source-text.js"

describe("splitRoleLabel", () => {
	it("takes the role label Memongo stores in front of an event off the body", () => {
		expect(splitRoleLabel("User: # Release notes\n\nBody")).toEqual({
			role: "User",
			body: "# Release notes\n\nBody",
		})
		expect(splitRoleLabel("Assistant: Done.")).toEqual({
			role: "Assistant",
			body: "Done.",
		})
	})

	it("leaves any other text alone, as it was stored", () => {
		for (const stored of [
			"Ticket: NS-4107\nRequester: Elif",
			"User:no space",
			"A user: lower down",
			"",
		]) {
			expect(splitRoleLabel(stored)).toEqual({ body: stored })
		}
	})
})

describe("sourceLabel", () => {
	it("leads with the first heading, without its markdown", () => {
		expect(sourceLabel("# Release notes: Track 9.3\n\n**Owner:** Priya")).toBe(
			"Release notes: Track 9.3",
		)
	})

	it("falls back to the first line, as written", () => {
		expect(sourceLabel("Ticket: NS-4107\nRequester: Elif Voss")).toBe(
			"Ticket: NS-4107",
		)
		expect(
			sourceLabel("**Subject:** Halvorsen renewal\n\n**Author:** Viktor"),
		).toBe("Subject: Halvorsen renewal")
	})

	it("shortens a long first line at a word, and says nothing for an empty source", () => {
		const label = sourceLabel(`${"word ".repeat(40)}end`)
		expect(label?.length).toBeLessThanOrEqual(81)
		expect(label?.endsWith("…")).toBe(true)
		expect(sourceLabel("")).toBeUndefined()
		expect(sourceLabel("\n\n---\n")).toBeUndefined()
	})
})

describe("viewSource", () => {
	const claim = "The renewal depends on the SLA credit."
	const filler = Array.from(
		{ length: 12 },
		(_, at) => `- filler point number ${at} about nothing in particular`,
	).join("\n")
	const long = `User: # Account review\n\n${filler}\n- Halvorsen says the renewal depends on the SLA credit being honored\n\nClosing paragraph.`

	it("takes the role off, and finds the phrase the claim rests on in the body", () => {
		const view = viewSource(long, claim)
		expect(view.role).toBe("User")
		expect(view.label).toBe("Account review")
		expect(view.mark).not.toBeNull()
		const { start, end } = view.mark ?? { start: 0, end: 0 }
		const body = long.slice("User: ".length)
		expect(body.slice(start, end).toLowerCase()).toBe(
			"the renewal depends on the sla credit",
		)
	})

	it("cuts a long source to the one unit that holds the phrase", () => {
		const view = viewSource(long, claim)
		expect(view.excerpt).not.toBeNull()
		expect(view.excerpt?.map((block) => block.kind)).toEqual(["list"])
		const [list] = view.excerpt ?? []
		expect(
			list?.kind === "list" && plainText(list.items[0]?.inline ?? []),
		).toContain("Halvorsen says the renewal depends")
	})

	it("shows a short source whole, with nothing to open", () => {
		const view = viewSource("Ticket: NS-4107\nResolved the SLA credit.", claim)
		expect(view.excerpt).toBeNull()
		expect(view.blocks.length).toBeGreaterThan(0)
	})

	it("opens a long source with its start when no phrase of the claim is in it", () => {
		const view = viewSource(long, "Nothing here matches at all.")
		expect(view.mark).toBeNull()
		expect(view.excerpt?.map((block) => block.kind)).toEqual([
			"heading",
			"list",
		])
	})
})
