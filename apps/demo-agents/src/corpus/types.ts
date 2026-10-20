export type RecordKind =
	| "crm_note"
	| "support_ticket"
	| "slack_thread"
	| "call_transcript"
	| "doc"
	| "jira_issue"

export type StorylineId =
	| "renewal-risk"
	| "eta-drift"
	| "pricing-change"
	| "champion-leaving"

export type Product = { id: string; name: string; summary: string }

export type Person = {
	id: string
	name: string
	title: string
	// "northstar" for employees, otherwise the customer account id.
	org: string
	team?: string
}

export type Account = {
	id: string
	slug: string
	name: string
	industry: string
	region: string
	fleetSize: number
	productIds: string[]
	arrUsd: number
	renewalDate: string
	ownerId: string
	csmId: string
	contactIds: string[]
	championId: string
}

// "history" sources are seeded before a run; "replay" sources are held back
// and handed to the role agents during the run.
export type SourceSpec = {
	id: string
	kind: RecordKind
	title: string
	date: string
	authorId: string
	participantIds: string[]
	accountId?: string
	productIds: string[]
	storyline?: StorylineId
	phase: "history" | "replay"
	brief: string
	// Exact strings the rendered body must contain; claims cite them.
	facts: string[]
	length: "short" | "medium" | "long"
}

export type ClaimSpec = {
	id: string
	text: string
	confidence: number
	evidence: { sourceId: string; anchor: string }[]
}

export type PageSpec = {
	slug: string
	kind: "entity" | "concept" | "synthesis" | "procedure"
	type: string
	title: string
	summary: string
	body: string
	tags: string[]
	claims: ClaimSpec[]
	relationships: { targetPageSlug: string; kind: string }[]
}

export type ContradictionSpec = {
	targetPageSlug: string
	targetClaimId: string
	incoming: PageSpec
}

export type Storyline = {
	id: StorylineId
	title: string
	summary: string
	sourceIds: string[]
}

export type World = {
	seed: number
	company: { name: string; summary: string }
	products: Product[]
	people: Person[]
	accounts: Account[]
	sources: SourceSpec[]
	pages: PageSpec[]
	storylines: Storyline[]
	contradiction: ContradictionSpec
}

export type RenderedRecord = {
	id: string
	body: string
	model: string
	renderedAt: string
}
