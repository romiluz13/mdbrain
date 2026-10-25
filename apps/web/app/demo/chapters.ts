export type ChapterId =
	| "story"
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
		id: "story",
		title: "The story",
		lede: "What mdbrain is, what the recorded run did, and five properties a company brain must have, each one checkable on this page.",
	},
	{
		id: "brain",
		title: "The whole brain",
		lede: "Every page, claim and source here is read from the stored brain, not typed into the page.",
	},
	{
		id: "ask",
		title: "Ask it",
		lede: "Ask the stored brain a question: the search returns claims with the source each one came from, and the answer lane writes a cited answer from the same pages.",
	},
	{
		id: "sources",
		title: "Where it came from",
		lede: "The source files this run wrote, in the order they arrived.",
	},
	{
		id: "agents",
		title: "Agents at work",
		lede: "Which agents wrote to the brain, and what each one did.",
	},
	{
		id: "contradiction",
		title: "Caught: a disagreement",
		lede: "When two pages disagree, mdbrain keeps both claims and records the conflict; nothing is overwritten.",
	},
	{
		id: "growth",
		title: "A recorded proposal",
		lede: "This run recorded a proposal awaiting review; its title is visible here, and no approval is recorded in this run.",
	},
	{
		id: "changes",
		title: "What changed",
		lede: "Every stored revision, with the claims that moved.",
	},
	{
		id: "hood",
		title: "The raw reads",
		lede: "The same reads an agent or an engineer would make, run live against the demo read proxy.",
	},
	{
		id: "run",
		title: "Check every number",
		lede: "Each headline number on this page, paired with the read that proves it.",
	},
]

export function chapterIndex(id: string): number {
	return CHAPTERS.findIndex((chapter) => chapter.id === id)
}
