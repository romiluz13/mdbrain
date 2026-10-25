import { describe, expect, it } from "vitest"
import { CHAPTERS, chapterIndex } from "./chapters.js"

describe("chapter list", () => {
	it("has the story first, as chapter 1 of 10, so the page opens on it", () => {
		expect(CHAPTERS).toHaveLength(10)
		expect(CHAPTERS[0]).toMatchObject({ id: "story", title: "The story" })
	})

	it("keeps the nine existing ids in their order after the story", () => {
		expect(CHAPTERS.map((chapter) => chapter.id)).toEqual([
			"story",
			"brain",
			"ask",
			"sources",
			"agents",
			"contradiction",
			"growth",
			"changes",
			"hood",
			"run",
		])
	})

	it("uses the plain titles from the accepted plan", () => {
		expect(CHAPTERS.map((chapter) => chapter.title)).toEqual([
			"The story",
			"The whole brain",
			"Ask it",
			"Where it came from",
			"Agents at work",
			"Caught: a disagreement",
			"A recorded proposal",
			"What changed",
			"The raw reads",
			"Check every number",
		])
	})

	it("gives each lede one plain sentence", () => {
		for (const chapter of CHAPTERS) {
			expect(chapter.lede.split(/(?<=[.!?])\s+/)).toHaveLength(1)
		}
	})

	it("says what a recorded proposal means, without claiming an approval", () => {
		expect(chapterFor("growth").lede).toBe(
			"This run recorded a proposal awaiting review; its title is visible here, and no approval is recorded in this run.",
		)
	})

	it("finds every old hash, and -1 for an unknown one", () => {
		expect(chapterIndex("story")).toBe(0)
		expect(chapterIndex("brain")).toBe(1)
		expect(chapterIndex("contradiction")).toBe(5)
		expect(chapterIndex("hood")).toBe(8)
		expect(chapterIndex("run")).toBe(9)
		expect(chapterIndex("nowhere")).toBe(-1)
	})
})

function chapterFor(id: string) {
	const chapter = CHAPTERS.find((entry) => entry.id === id)
	if (!chapter) {
		throw new Error(`no chapter ${id}`)
	}
	return chapter
}
