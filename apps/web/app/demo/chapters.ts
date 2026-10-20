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
		lede: "Ask the stored brain a question. It answers with stored claims and the source each one came from. No model is called on this screen.",
	},
	{
		id: "sources",
		title: "Sources arrive",
		lede: "Where the knowledge came from: the source events the stored claims cite.",
	},
	{
		id: "agents",
		title: "Agents at work",
		lede: "Which agents wrote to the brain, and what they did.",
	},
	{
		id: "contradiction",
		title: "A contradiction caught",
		lede: "Two pages disagree. mdbrain kept both claims and recorded the conflict. Nothing was overwritten.",
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
