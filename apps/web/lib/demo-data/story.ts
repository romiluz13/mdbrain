// The story chapter's seam: one pure function that turns the data the page has
// already read into the summary, six beats and five properties. Each item is
// judged only on the reads it needs, so one failed read never hides an item
// that does not depend on it. Nothing here is typed in as scenario data: the
// specifics come from the reads, and the words around them are fixed copy.

import type { WikiMapView } from "./loaders.js"
import type { ContradictionCase } from "./loaders-chapters.js"
import { countOf } from "./plural.js"
import {
	AGENT_ROLE_LABELS,
	type AgentRoleId,
	type AgentRunRecord,
	FAILED_LABEL,
	type RunRecord,
} from "./run-record.js"
import type { DataState } from "./states.js"

export type Readiness = "shown" | "not-recorded" | "loading" | "unreadable"

export const READINESS_LABEL: Record<Readiness, string> = {
	shown: "shown in this run",
	"not-recorded": "not recorded",
	loading: "still loading",
	unreadable: "could not be read",
}

export const STORY_DEFINITION =
	"mdbrain is shared, source-linked memory for a company's people and AI agents."
export const STORY_SECTION_LINE =
	"These are design properties you can check on this page, not benchmark results."

const PROPERTY_HOOD_LINE =
	"This public page reads through a dedicated read-only key; the reads it makes are listed live. Refusals of writes and other scopes are covered by the proxy's tests and deploy checks."

export type StoryTarget =
	| "contradiction"
	| "sources"
	| "agents"
	| "growth"
	| "hood"

/** One judged item: its readiness, the filled copy when it is shown, and a
 * fixed label when a stored state explains why it is not. */
export type Judged = { readiness: Readiness; text?: string; note?: string }

export type StoryBeat = Judged & {
	n: number
	title: string
	target: StoryTarget
}

export type StoryProperty = Judged & {
	title: string
	target: StoryTarget
}

export type CitationProof = {
	readiness: Readiness
	label: string
	pageTitle?: string
}

export type Story = {
	definition: string
	lead: Judged
	summary: { counts: Judged; handoff: Judged; proposal: Judged }
	beats: StoryBeat[]
	citations: CitationProof[]
	properties: StoryProperty[]
}

export type StoryInput = {
	map: DataState<WikiMapView>
	contradiction: DataState<ContradictionCase>
	run: DataState<RunRecord>
}

const RANK: Record<Readiness, number> = {
	shown: 0,
	"not-recorded": 1,
	unreadable: 2,
	loading: 3,
}

/** The most pressing of several readiness states: loading, then unreadable,
 * then not recorded, then shown. */
function worst(states: readonly Readiness[]): Readiness {
	return states.reduce<Readiness>(
		(most, state) => (RANK[state] > RANK[most] ? state : most),
		"shown",
	)
}

function quote(text: string): string {
	return text.replace(/\.$/, "")
}

type ContradictionPart = {
	readiness: Readiness
	pair?: [
		ContradictionCase["claims"][number],
		ContradictionCase["claims"][number],
	]
	resolution?: string
}

function contradictionPart(
	state: DataState<ContradictionCase>,
): ContradictionPart {
	switch (state.kind) {
		case "loading":
			return { readiness: "loading" }
		case "empty":
			return { readiness: "not-recorded" }
		case "ready": {
			const [first, second] = state.data.claims
			if (state.data.claims.length < 2 || !first || !second) {
				return { readiness: "not-recorded" }
			}
			return {
				readiness: "shown",
				pair: [first, second],
				resolution: state.data.resolution,
			}
		}
		default:
			return { readiness: "unreadable" }
	}
}

function citationOf(
	claim: ContradictionCase["claims"][number]["claim"],
	pageTitle: string,
): CitationProof {
	if (!claim.evidence.some((evidence) => evidence.kind === "event")) {
		return {
			readiness: "not-recorded",
			label: "No stored event source",
			pageTitle,
		}
	}
	if (claim.marker === undefined) {
		return {
			readiness: "unreadable",
			label: "The citation marker is missing.",
			pageTitle,
		}
	}
	return { readiness: "shown", label: "citation recorded", pageTitle }
}

type RunPart = {
	readiness: Readiness
	record?: RunRecord
	note?: string
}

function runPart(state: DataState<RunRecord>): RunPart {
	switch (state.kind) {
		case "loading":
			return { readiness: "loading" }
		case "empty":
			return { readiness: "not-recorded" }
		case "error":
			return { readiness: "unreadable" }
		case "ready":
			return { readiness: "shown", record: state.data }
		case "incomplete":
			if (state.reason === "RUN_NOT_CONFIGURED") {
				return { readiness: "not-recorded" }
			}
			if (state.reason === "RUN_NOT_READY" && state.data) {
				const seen = countOf(state.data.arrivals.length, "source record")
				return {
					readiness: "loading",
					note: `${seen} loaded so far; the run is still seeding.`,
				}
			}
			if (state.reason === "RUN_FAILED") {
				return { readiness: "unreadable", note: FAILED_LABEL }
			}
			return { readiness: "unreadable" }
	}
}

type MapPart = { readiness: Readiness; view?: WikiMapView }

function mapPart(state: DataState<WikiMapView>): MapPart {
	switch (state.kind) {
		case "loading":
			return { readiness: "loading" }
		case "empty":
			return { readiness: "not-recorded" }
		case "ready":
			return { readiness: "shown", view: state.data }
		default:
			return { readiness: "unreadable" }
	}
}

type Handoff = {
	readiness: Readiness
	note?: string
	writer?: string
	reader?: string
	title?: string
	text?: string
}

function durationSeconds(agent: AgentRunRecord): number | undefined {
	if (agent.endedAt === undefined) {
		return undefined
	}
	const seconds =
		(Date.parse(agent.endedAt) - Date.parse(agent.startedAt)) / 1000
	return Number.isFinite(seconds) && seconds >= 0
		? Math.round(seconds)
		: undefined
}

function rolesInTurn(agent: AgentRunRecord): AgentRoleId[] {
	const roles: AgentRoleId[] = []
	for (const step of agent.steps ?? []) {
		if (!roles.includes(step.role)) {
			roles.push(step.role)
		}
	}
	return roles
}

function handoffOf(part: RunPart, map: MapPart): Handoff {
	if (part.readiness !== "shown" || part.record === undefined) {
		return { readiness: part.readiness }
	}
	const agent = part.record.agentRun
	if (agent === undefined) {
		return { readiness: "not-recorded" }
	}
	if (agent.state !== "complete") {
		return { readiness: "not-recorded", note: agent.incompleteLabel }
	}
	const page = agent.reusedPage
	if (page === undefined) {
		return { readiness: "not-recorded" }
	}
	const writer = AGENT_ROLE_LABELS[page.writtenBy]
	const reader = AGENT_ROLE_LABELS[page.readBy]
	const title =
		map.view?.pages.find((candidate) => candidate.slug === page.slug)?.title ??
		page.slug
	const roles = rolesInTurn(agent)
	const seconds = durationSeconds(agent)
	const turn =
		roles.length === 0
			? undefined
			: `Then ${countOf(roles.length, "agent")} worked in turn (${roles
					.map((role) => AGENT_ROLE_LABELS[role])
					.join(
						", ",
					)})${seconds === undefined ? "" : ` for ${countOf(seconds, "second")}`}; the `
	const lead = turn ?? "The "
	return {
		readiness: "shown",
		writer,
		reader,
		title,
		text: `${lead}${writer} agent's page “${title}” was read by the ${reader} agent.`,
	}
}

export function buildStory(input: StoryInput): Story {
	const contradiction = contradictionPart(input.contradiction)
	const run = runPart(input.run)
	const map = mapPart(input.map)
	const handoff = handoffOf(run, map)
	const proposalRecord = run.record?.agentRun?.pendingProposal
	const proposal: Judged =
		run.readiness !== "shown"
			? { readiness: run.readiness }
			: proposalRecord === undefined
				? { readiness: "not-recorded" }
				: {
						readiness: "shown",
						text: `An agent left “${proposalRecord.title}” awaiting review when this run was recorded; no approval is recorded in this run.`,
					}

	const pair = contradiction.pair
	const resolution = contradiction.resolution
	const [claimA, claimB] = pair ?? []
	const pageA = claimA?.pageTitle
	const pageB = claimB?.pageTitle

	const citations: CitationProof[] =
		input.contradiction.kind === "ready"
			? input.contradiction.data.claims.map((entry) =>
					citationOf(entry.claim, entry.pageTitle),
				)
			: []
	const citationReadiness: Readiness =
		input.contradiction.kind === "loading"
			? "loading"
			: input.contradiction.kind === "ready" ||
					input.contradiction.kind === "empty"
				? citations.length === 0
					? "not-recorded"
					: citations.some((citation) => citation.readiness === "shown")
						? "shown"
						: worst(citations.map((citation) => citation.readiness))
				: "unreadable"

	const countsReadiness = worst([run.readiness, map.readiness])
	const counts: Judged =
		countsReadiness === "shown" && run.record && map.view
			? {
					readiness: "shown",
					text: `This recorded run loaded ${countOf(run.record.arrivals.length, "source record")}, authored synthetic material for the demo; the brain now holds ${countOf(map.view.pageTotal, "page")} and ${countOf(map.view.claimTotal, "claim")}.`,
				}
			: { readiness: countsReadiness }

	const shownOr = (readiness: Readiness, text: () => string): Judged =>
		readiness === "shown" ? { readiness, text: text() } : { readiness }

	const beatFour: StoryBeat = {
		n: 4,
		title: "Where the records came from",
		target: "sources",
		readiness: run.readiness,
		...(run.readiness === "shown" && run.record
			? {
					text: `${countOf(run.record.arrivals.length, "source record")} loaded for this run.`,
				}
			: {}),
		...(run.note !== undefined ? { note: run.note } : {}),
	}
	return {
		definition: STORY_DEFINITION,
		lead:
			contradiction.readiness === "shown" && pageA && pageB && claimA && claimB
				? {
						readiness: "shown",
						text: `In this recorded run, two pages disagree. ${pageA} says “${quote(claimA.claim.text)}”. ${pageB} says “${quote(claimB.claim.text)}”. mdbrain kept both and recorded the disagreement as ${resolution}. Inspect the stored citations behind these claims.`,
					}
				: { readiness: contradiction.readiness },
		summary: {
			counts,
			handoff:
				handoff.readiness === "shown"
					? { readiness: "shown", text: handoff.text }
					: {
							readiness: handoff.readiness,
							...(handoff.note !== undefined ? { note: handoff.note } : {}),
						},
			proposal,
		},
		beats: [
			{
				n: 1,
				title: "Two accounts disagree",
				target: "contradiction",
				readiness: contradiction.readiness,
				...(contradiction.readiness === "shown" && pageA && pageB
					? { text: `${pageA} and ${pageB} disagree.` }
					: {}),
			},
			{
				n: 2,
				title: "Both are kept",
				target: "contradiction",
				readiness: contradiction.readiness,
				...(contradiction.readiness === "shown"
					? { text: `Both claims are kept, recorded as ${resolution}.` }
					: {}),
			},
			{
				n: 3,
				title: "Compare the sources",
				target: "contradiction",
				readiness: citationReadiness,
				...(citationReadiness === "shown"
					? { text: "Each claim below names the source events it rests on." }
					: {}),
			},
			beatFour,
			{
				n: 5,
				title: "Agents hand work on",
				target: "agents",
				readiness: handoff.readiness,
				...(handoff.readiness === "shown" &&
				handoff.writer &&
				handoff.reader &&
				handoff.title
					? {
							text: `${handoff.writer} wrote “${handoff.title}”; ${handoff.reader} read it.`,
						}
					: {}),
				...(handoff.note !== undefined ? { note: handoff.note } : {}),
			},
			{
				n: 6,
				title: "A recorded proposal",
				target: "growth",
				readiness: proposal.readiness,
				...(proposal.readiness === "shown" && proposalRecord
					? {
							text: `An agent left “${proposalRecord.title}” awaiting review when this run was recorded.`,
						}
					: {}),
			},
		],
		citations,
		properties: [
			{
				title: "Check the evidence behind a claim.",
				target: "contradiction",
				...shownOr(
					citationReadiness,
					() =>
						"Inspect a stored citation; a missing or unconfirmed source is said plainly.",
				),
			},
			{
				title: "See a disagreement without losing either account.",
				target: "contradiction",
				...shownOr(
					contradiction.readiness,
					() =>
						`In this recorded case, both claims are still readable and the disagreement is recorded as ${resolution}.`,
				),
			},
			{
				title: "A proposal can wait for a reviewer.",
				target: "growth",
				...shownOr(
					proposal.readiness,
					() =>
						`In this run an agent left “${proposalRecord?.title}” awaiting review; no approval is recorded in this run. The other roles could already write within their permissions.`,
				),
			},
			{
				title: "Many agents work on one brain.",
				target: "agents",
				...shownOr(
					handoff.readiness,
					() =>
						`In this run the ${handoff.writer} agent wrote “${handoff.title}” and the ${handoff.reader} agent read it.`,
				),
			},
			{
				title: "Explore the recorded brain without editing it.",
				target: "hood",
				readiness: "shown",
				text: PROPERTY_HOOD_LINE,
			},
		],
	}
}
