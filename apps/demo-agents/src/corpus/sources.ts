import { HALVORSEN, PRODUCTS } from "./cast.js"
import {
	ACCOUNT_HEALTH,
	CALL_TYPES,
	INTERNAL_CALLS,
	INTERNAL_DOCS,
	JIRA_TOPICS,
	RESOLUTIONS,
	SLACK_CHANNELS,
	TICKET_TOPICS,
	type Topic,
} from "./catalog.js"
import { at, longDate, trucks, usd } from "./format.js"
import type { Rng } from "./rng.js"
import { RESERVED_IDS } from "./storylines.js"
import type { Account, Person, SourceSpec } from "./types.js"

// Generic records are history only and end before the replay window.
const FIRST_DAY = "2026-07-01"
const LAST_DAY = "2026-09-19"
const LENGTHS: SourceSpec["length"][] = ["short", "medium", "long"]

type Ctx = { accounts: Account[]; people: Person[] }

export function genericSources(rng: Rng, ctx: Ctx): SourceSpec[] {
	const byId = new Map(ctx.people.map((p) => [p.id, p]))
	const team = (name: string) =>
		ctx.people.filter((p) => p.org === "northstar" && p.team === name)
	const support = team("Support")
	const engineers = team("Engineering")
	const productName = (id: string) =>
		PRODUCTS.find((p) => p.id === id)?.name ?? id
	const productList = (ids: string[]) => ids.map(productName).join(", ")
	const name = (id: string) => byId.get(id)?.name ?? id
	const day = () => {
		const start = Date.parse(`${FIRST_DAY}T00:00:00Z`)
		const span = (Date.parse(`${LAST_DAY}T00:00:00Z`) - start) / 86_400_000
		return new Date(start + rng.int(0, span) * 86_400_000)
			.toISOString()
			.slice(0, 10)
	}
	const time = () =>
		`${String(rng.int(7, 18)).padStart(2, "0")}:${String(rng.int(0, 59)).padStart(2, "0")}`
	const when = (d = day()) => at(d, time())
	const numberer = (prefix: string, start: number) => {
		let n = start
		return () => {
			do n += rng.int(1, 7)
			while (RESERVED_IDS.includes(`${prefix}-${n}`))
			return `${prefix}-${n}`
		}
	}

	const sources: SourceSpec[] = []
	const add = (spec: Omit<SourceSpec, "phase">) =>
		sources.push({ ...spec, phase: "history" })

	// Tickets are numbered in date order, like a real tracker.
	type TicketPlan = {
		account: Account
		date: string
		topic: Topic
		resolution: string
	}
	const ticketPlans: TicketPlan[] = []
	type JiraPlan = {
		project: string
		summary: string
		date: string
		ticketId?: string
		account?: Account
	}
	const jiraPlans: JiraPlan[] = []

	for (const account of ctx.accounts) {
		const isAnchor = account.id === HALVORSEN.id
		const topics = TICKET_TOPICS.filter((t) =>
			account.productIds.includes(t.product),
		)
		const ticketCount = isAnchor ? 2 : rng.int(1, 4)
		for (const topic of rng.sample(topics, ticketCount)) {
			ticketPlans.push({
				account,
				date: when(),
				topic,
				resolution: rng.pick(RESOLUTIONS),
			})
		}
		const owner = account.ownerId
		const champion = account.championId
		const slug = account.slug
		const facts = [
			trucks(account.fleetSize),
			longDate(account.renewalDate),
			usd(account.arrUsd),
			name(owner),
			name(account.csmId),
		]

		if (!isAnchor) {
			add({
				id: `src-${slug}-overview`,
				kind: "crm_note",
				title: `${account.name}: account overview`,
				date: when(`2026-07-0${rng.int(1, 9)}`),
				authorId: owner,
				participantIds: [owner, account.csmId],
				accountId: account.id,
				productIds: account.productIds,
				facts,
				brief: `Account overview by ${name(owner)}. ${account.name} is a ${account.industry} fleet in ${account.region} running ${productList(account.productIds)} on ${trucks(account.fleetSize)}. Annual recurring revenue ${usd(account.arrUsd)}; renewal due ${longDate(account.renewalDate)}. Champion: ${name(champion)}. Health: ${rng.pick(ACCOUNT_HEALTH)}.`,
				length: "medium",
			})
			const callCount = rng.int(1, 2)
			for (const [i, call] of rng.sample(CALL_TYPES, callCount).entries()) {
				const fact = call.fact(rng.int(0, 99))
				add({
					id: `src-${slug}-call-${i + 1}`,
					kind: "call_transcript",
					title: `${call.title} with ${account.name}`,
					date: when(),
					authorId: account.csmId,
					participantIds: [
						account.csmId,
						owner,
						...account.contactIds.slice(0, 2),
					],
					accountId: account.id,
					productIds: account.productIds,
					facts: [fact],
					brief: `${call.title} between Northstar (${name(account.csmId)}, ${name(owner)}) and ${account.name} (${account.contactIds.slice(0, 2).map(name).join(", ")}). Key number discussed: ${fact}. Cover usage, open issues and next steps in the customer's own words.`,
					length: rng.pick(["medium", "long"] as const),
				})
			}
			if (rng.chance(0.6)) {
				const expanding = rng.chance(0.5)
				const extra = `${rng.int(3, 30) * 10} more trucks`
				add({
					id: `src-${slug}-renewal-prep`,
					kind: "crm_note",
					title: expanding
						? `${account.name}: expansion opportunity`
						: `${account.name}: renewal prep`,
					date: when(),
					authorId: owner,
					participantIds: [owner],
					accountId: account.id,
					productIds: account.productIds,
					facts: expanding ? [extra] : [longDate(account.renewalDate)],
					brief: expanding
						? `${name(owner)} logs that ${account.name} wants to add ${extra} next quarter; next step is a quote.`
						: `${name(owner)} starts renewal prep for ${longDate(account.renewalDate)}: stakeholders, risks, pricing check with deal desk.`,
					length: "short",
				})
			}
		}
		const slackCount = isAnchor ? 1 : rng.int(0, 2)
		for (let i = 0; i < slackCount; i++) {
			const topic = rng.pick(topics)
			add({
				id: `src-${slug}-slack-${i + 1}`,
				kind: "slack_thread",
				title: `#acct-${slug}: ${topic.phrase}`,
				date: when(),
				authorId: account.csmId,
				participantIds: [account.csmId, owner, rng.pick(support).id],
				accountId: account.id,
				productIds: [topic.product],
				facts: [topic.phrase],
				brief: `Short internal thread about ${account.name}: ${topic.detail}. The team agrees who follows up with ${name(champion)}.`,
				length: rng.pick(LENGTHS),
			})
		}
	}

	const nextTicket = numberer("NS", 4100)
	ticketPlans.sort((a, b) => a.date.localeCompare(b.date))
	for (const plan of ticketPlans) {
		const ticketId = nextTicket()
		const engineer = rng.pick(support)
		add({
			id: `src-ticket-${ticketId.toLowerCase()}`,
			kind: "support_ticket",
			title: `${ticketId}: ${plan.topic.phrase} at ${plan.account.name}`,
			date: plan.date,
			authorId: engineer.id,
			participantIds: [rng.pick(plan.account.contactIds), engineer.id],
			accountId: plan.account.id,
			productIds: [plan.topic.product],
			facts: [ticketId, plan.topic.phrase],
			brief: `Ticket ${ticketId} from ${plan.account.name}: ${plan.topic.detail}. Status: ${plan.resolution}.`,
			length: rng.pick(LENGTHS),
		})
		if (plan.resolution === "escalated to engineering") {
			const project =
				plan.topic.product === "dock"
					? "DOCK"
					: plan.topic.product === "predict"
						? "PRED"
						: "TRK"
			jiraPlans.push({
				project,
				summary: `Customer escalation: ${plan.topic.phrase}`,
				date: plan.date.replace(/T.*/, "T19:30:00.000Z"),
				ticketId,
				account: plan.account,
			})
		}
	}

	for (const [project, summaries] of Object.entries(JIRA_TOPICS)) {
		for (const summary of summaries) {
			jiraPlans.push({ project, summary, date: when() })
			if (rng.chance(0.5))
				jiraPlans.push({
					project,
					summary: `Follow-up: ${summary.toLowerCase()}`,
					date: when(),
				})
		}
	}
	const counters: Record<string, () => string> = {
		TRK: numberer("TRK", 2200),
		DOCK: numberer("DOCK", 640),
		PRED: numberer("PRED", 1300),
		ENG: numberer("ENG", 8100),
	}
	jiraPlans.sort((a, b) => a.date.localeCompare(b.date))
	for (const plan of jiraPlans) {
		const issueId = (counters[plan.project] as () => string)()
		const assignee = rng.pick(engineers)
		add({
			id: `src-jira-${issueId.toLowerCase()}`,
			kind: "jira_issue",
			title: `${issueId}: ${plan.summary}`,
			date: plan.date,
			authorId: assignee.id,
			participantIds: [assignee.id, rng.pick(engineers).id],
			accountId: plan.account?.id,
			productIds: [
				plan.project === "DOCK"
					? "dock"
					: plan.project === "PRED"
						? "predict"
						: "track",
			],
			facts: plan.ticketId ? [issueId, plan.ticketId] : [issueId],
			brief: plan.ticketId
				? `Engineering issue ${issueId} opened from support ticket ${plan.ticketId} (${plan.account?.name}). Include reproduction steps, owner, estimate and status.`
				: `Engineering issue ${issueId}: ${plan.summary}. Include context, acceptance criteria, owner and status.`,
			length: rng.pick(LENGTHS),
		})
	}

	for (const doc of INTERNAL_DOCS) {
		const author = rng.pick(ctx.people.filter((p) => p.org === "northstar"))
		add({
			id: `src-doc-${doc.title
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/-$/, "")}`,
			kind: "doc",
			title: doc.title,
			date: when(),
			authorId: author.id,
			participantIds: [author.id],
			productIds: doc.product ? [doc.product] : [],
			facts: doc.facts,
			brief: doc.brief,
			length: "long",
		})
	}

	for (const { channel, team: teamName, topics } of SLACK_CHANNELS) {
		const members = team(teamName)
		for (const topic of topics) {
			for (let i = 0; i < rng.int(2, 3); i++) {
				const crew = rng.sample(members, rng.int(2, 4))
				add({
					id: `src-slack-${channel.slice(1)}-${topic.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${i + 1}`,
					kind: "slack_thread",
					title: `${channel}: ${topic}`,
					date: when(),
					authorId: (crew[0] as Person).id,
					participantIds: crew.map((p) => p.id),
					productIds: [],
					facts: [topic],
					brief: `Internal ${channel} thread about ${topic}${i > 0 ? " (a later follow-up)" : ""}. Realistic back-and-forth with a decision or open question at the end.`,
					length: rng.pick(LENGTHS),
				})
			}
		}
	}

	for (const title of INTERNAL_CALLS) {
		for (let i = 0; i < 3; i++) {
			const crew = rng.sample(
				ctx.people.filter((p) => p.org === "northstar"),
				rng.int(3, 5),
			)
			const d = day()
			const mentioned = rng.sample(ctx.accounts, 3).map((a) => a.name)
			add({
				id: `src-call-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${i + 1}`,
				kind: "call_transcript",
				title: `${title}, ${longDate(d)}`,
				date: when(d),
				authorId: (crew[0] as Person).id,
				participantIds: crew.map((p) => p.id),
				productIds: [],
				facts: [title],
				brief: `Internal meeting transcript: ${title}. Accounts discussed: ${mentioned.join(", ")}. Use concrete numbers and owners; end with action items.`,
				length: "long",
			})
		}
	}

	return sources
}
