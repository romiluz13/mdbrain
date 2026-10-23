export type ChapterId =
	| "brain"
	| "ask"
	| "sources"
	| "agents"
	| "contradiction"
	| "growth"
	| "changes"
	| "hood"
	| "run"

export type Chapter = { id: ChapterId; title: string; lede: string }

export const CHAPTERS: readonly Chapter[] = [
	{
		id: "brain",
		title: "The brain",
		lede: "Every page, claim and source on this screen is read from the stored brain. Nothing here is typed into the page.",
	},
	{
		id: "ask",
		title: "Ask",
		lede: "Ask the stored brain a question. The stored search answers with claims and the source each one came from; the answer lane has a small model read the same pages and write a cited answer.",
	},
	{
		id: "sources",
		title: "Sources arrive",
		lede: "Where the knowledge came from: the source files the run wrote, in the order they arrived.",
	},
	{
		id: "agents",
		title: "Agents at work",
		lede: "Which agents wrote to the brain, and what they did.",
	},
	{
		id: "contradiction",
		title: "A contradiction caught",
		lede: "When two pages disagree, mdbrain keeps both claims and records the conflict. Nothing is overwritten.",
	},
	{
		id: "growth",
		title: "Governed growth",
		lede: "New knowledge is trusted in tiers, and every page carries its lifecycle state.",
	},
	{
		id: "changes",
		title: "What changed",
		lede: "Every stored revision, with the claims that moved.",
	},
	{
		id: "hood",
		title: "Under the hood",
		lede: "The same reads an agent or an engineer would make, run live against the demo read proxy.",
	},
	{
		id: "run",
		title: "Reading the pinned run",
		lede: "Each headline number in this demo, paired with the read that proves it.",
	},
]

export function chapterIndex(id: string): number {
	return CHAPTERS.findIndex((chapter) => chapter.id === id)
}
