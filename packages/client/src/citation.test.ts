import { describe, expect, it } from "vitest"
import {
	type CitationMarker,
	formatCitationMarker,
	parseCitationMarker,
} from "./citation.js"

describe("formatCitationMarker", () => {
	it("writes a claim marker with the slug's slashes readable", () => {
		expect(
			formatCitationMarker({
				kind: "wiki",
				slug: "accounts/halvorsen",
				claimId: "claim-1",
				revision: 3,
			}),
		).toBe("[[wiki:accounts/halvorsen#claim-1@r3]]")
	})

	it("writes an event marker", () => {
		expect(
			formatCitationMarker({
				kind: "event",
				eventId: "4e9daa65-6b2d-47ee-abbc-af462ea6ba4b",
			}),
		).toBe("[[event:4e9daa65-6b2d-47ee-abbc-af462ea6ba4b]]")
	})

	it("percent-encodes every character that would make parsing ambiguous", () => {
		expect(
			formatCitationMarker({
				kind: "wiki",
				slug: "a#b@r1]]",
				claimId: "x y:[z]%",
				revision: 2,
			}),
		).toBe("[[wiki:a%23b%40r1%5D%5D#x%20y%3A%5Bz%5D%25@r2]]")
	})

	it("refuses parts that cannot form a marker", () => {
		const claim = {
			kind: "wiki",
			slug: "s",
			claimId: "c",
			revision: 1,
		} as const
		expect(() => formatCitationMarker({ ...claim, slug: "" })).toThrow(/slug/)
		expect(() => formatCitationMarker({ ...claim, claimId: "" })).toThrow(
			/claimId/,
		)
		for (const revision of [0, -1, 1.5, Number.NaN, 2 ** 53]) {
			expect(() => formatCitationMarker({ ...claim, revision })).toThrow(
				/revision/,
			)
		}
		expect(() =>
			formatCitationMarker({
				kind: "wiki",
				slug: "a\nb",
				claimId: "c",
				revision: 1,
			}),
		).toThrow(/slug/)
		expect(() => formatCitationMarker({ kind: "event", eventId: "" })).toThrow(
			/eventId/,
		)
	})
})

describe("citation marker round trip", () => {
	const awkward: CitationMarker[] = [
		{ kind: "wiki", slug: "accounts/halvorsen", claimId: "c-1", revision: 1 },
		{ kind: "wiki", slug: "s#c@r9", claimId: "id", revision: 5 },
		{ kind: "wiki", slug: "[[wiki:x#y@r1]]", claimId: "%41", revision: 2 },
		{ kind: "wiki", slug: "naïve/日本語/🚀", claimId: "claim é", revision: 7 },
		{
			kind: "wiki",
			slug: "a b/c?d=e&f",
			claimId: "x/y\\z",
			revision: 9007199254740991,
		},
		{ kind: "event", eventId: "evt:1/2#3@r4]]" },
		{ kind: "event", eventId: "4e9daa65-6b2d-47ee-abbc-af462ea6ba4b" },
	]

	it.each(awkward)("parses what it formatted: %j", (marker) => {
		expect(parseCitationMarker(formatCitationMarker(marker))).toEqual({
			ok: true,
			marker,
		})
	})

	it("does not let a slug that looks like a marker change the parse", () => {
		const parsed = parseCitationMarker(
			formatCitationMarker({
				kind: "wiki",
				slug: "s#c@r1]]",
				claimId: "real",
				revision: 8,
			}),
		)
		expect(parsed).toEqual({
			ok: true,
			marker: { kind: "wiki", slug: "s#c@r1]]", claimId: "real", revision: 8 },
		})
	})

	it("reads a percent-encoded slash the same as a literal one", () => {
		expect(parseCitationMarker("[[wiki:accounts%2Fhalvorsen#c@r2]]")).toEqual({
			ok: true,
			marker: {
				kind: "wiki",
				slug: "accounts/halvorsen",
				claimId: "c",
				revision: 2,
			},
		})
	})
})

describe("parseCitationMarker rejects malformed input", () => {
	const malformed: Array<[string, string]> = [
		["empty text", ""],
		["plain text", "see the Halvorsen note"],
		["no brackets", "wiki:s#c@r1"],
		["single brackets", "[wiki:s#c@r1]"],
		["unclosed", "[[wiki:s#c@r1"],
		["surrounding text", "see [[wiki:s#c@r1]]"],
		["trailing text", "[[wiki:s#c@r1]] now"],
		["leading space", " [[wiki:s#c@r1]]"],
		["unknown kind", "[[doc:s#c@r1]]"],
		["missing revision", "[[wiki:s#c]]"],
		["missing claim", "[[wiki:s@r1]]"],
		["empty slug", "[[wiki:#c@r1]]"],
		["empty claim id", "[[wiki:s#@r1]]"],
		["empty event id", "[[event:]]"],
		["revision zero", "[[wiki:s#c@r0]]"],
		["revision with leading zero", "[[wiki:s#c@r01]]"],
		["negative revision", "[[wiki:s#c@r-1]]"],
		["fractional revision", "[[wiki:s#c@r1.5]]"],
		["non-numeric revision", "[[wiki:s#c@rx]]"],
		["unsafe revision", "[[wiki:s#c@r9007199254740993]]"],
		["second revision", "[[wiki:s#c@r1@r2]]"],
		["second claim separator", "[[wiki:s#c#d@r1]]"],
		["unencoded # in an event id", "[[event:a#b]]"],
		["unencoded ] in an event id", "[[event:a]b]]"],
		["unencoded space", "[[wiki:a b#c@r1]]"],
		["raw non-ASCII", "[[wiki:é#c@r1]]"],
		["truncated percent escape", "[[wiki:s%2#c@r1]]"],
		["non-hex percent escape", "[[wiki:s%ZZ#c@r1]]"],
		["invalid UTF-8 bytes", "[[wiki:s%FF#c@r1]]"],
		["encoded control character", "[[wiki:s%00#c@r1]]"],
		["encoded newline", "[[event:a%0Ab]]"],
		["event with a claim part", "[[event:e#c@r1]]"],
		["longer than the limit", `[[event:${"a".repeat(3000)}]]`],
	]

	it.each(malformed)("%s", (_name, text) => {
		const parsed = parseCitationMarker(text)
		expect(parsed.ok).toBe(false)
		if (!parsed.ok) expect(parsed.reason).toMatch(/\S/)
	})

	it("gives a reason that never repeats the input", () => {
		const parsed = parseCitationMarker("[[wiki:secret-slug#secret-claim@r0]]")
		expect(parsed.ok).toBe(false)
		if (!parsed.ok) expect(parsed.reason).not.toMatch(/secret/)
	})

	it("rejects text that is not a string", () => {
		for (const value of [undefined, null, 5, {}]) {
			expect(parseCitationMarker(value as unknown as string).ok).toBe(false)
		}
	})
})
