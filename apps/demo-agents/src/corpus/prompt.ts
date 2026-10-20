import { CAST, COMPANY, LIST_PRICE, PRODUCTS } from "./cast.js"
import { TEAMS } from "./catalog.js"
import { longDate, trucks } from "./format.js"
import type { SourceSpec, World } from "./types.js"

// Haiku 5.5 always thinks before answering (even at low effort) and that
// thinking counts toward the cap, so caps leave room for it above the text.
export const OUTPUT_TOKENS: Record<SourceSpec["length"], number> = {
	short: 1200,
	medium: 1800,
	long: 2800,
}
export const MAX_REPLY_WORDS: Record<SourceSpec["length"], number> = {
	short: 150,
	medium: 350,
	long: 700,
}
const WORDS: Record<SourceSpec["length"], string> = {
	short: "80 to 150 words",
	medium: "200 to 350 words",
	long: "450 to 700 words",
}

const FORMATS: Record<SourceSpec["kind"], string> = {
	crm_note:
		"A CRM activity note as an account executive or CSM types it: a subject line, then terse notes, bullet points allowed, next steps at the end.",
	support_ticket:
		"A support ticket: header lines (Ticket, Requester, Priority, Status, Product), then the customer's description and a short thread of replies, each starting with the writer's name and a timestamp.",
	slack_thread:
		"A Slack thread: one message per line as `[HH:MM] Full Name: message`. Casual, abbreviations and emoji codes are fine, people reply to each other.",
	call_transcript:
		"A call transcript: a header (title, date, attendees), then speaker turns as `Full Name: words`. Spoken language with false starts and interruptions; close with agreed next steps.",
	doc: "An internal document in Markdown with a title, short intro and sections. Clear and specific.",
	jira_issue:
		"A Jira issue: fields (Key, Type, Priority, Status, Assignee, Reporter, Component), a description with context and acceptance criteria, then two to four comments with names.",
}

// The system prompt is identical for every record so the provider can cache it.
export function systemPrompt(world: World): string {
	const products = PRODUCTS.map(
		(p) =>
			`- ${p.name} (list price $${LIST_PRICE[p.id]} per truck per month): ${p.summary}`,
	).join("\n")
	const cast = Object.values(CAST)
		.map(
			(p) =>
				`- ${p.name}, ${p.title}${p.org === "northstar" ? "" : ` at ${world.accounts[0]?.name}`}`,
		)
		.join("\n")
	const teams = TEAMS.map((t) => `${t.team} (${t.size})`).join(", ")
	const formats = Object.entries(FORMATS)
		.map(([kind, f]) => `- ${kind}: ${f}`)
		.join("\n")
	return `You write realistic internal business records for a fictional company, used as synthetic data in a product demo.

# The company
${COMPANY.summary}
Offices in Oslo and Toronto. Teams: Leadership, ${teams}. The quarter is Q3 2026 (July to September).

# Products
${products}

# People who recur across records
${cast}

# Formats
${formats}

# Rules
1. Write only the record itself. No preamble, no commentary, no closing remarks about the task.
2. Every string listed under "Must contain verbatim" must appear exactly as written, at least once, in natural context.
3. Use only the people, companies and products named in this prompt or the request. Refer to anyone else by role ("a driver", "the carrier", "their IT team"); never invent other named people or companies.
4. Never mention real companies, real products, real people or real brands, including competitors, telematics vendors and software tools; describe them generically.
5. Stay consistent with the brief: do not add events, numbers or decisions that change the story. Small realistic texture (a typo, a side remark, a dock number) is welcome.
6. Vary voice by author: engineers are precise, sales are upbeat, frustrated customers sound frustrated.
7. Use American English and the date given in the request. Mention no other calendar date unless the brief or the verbatim strings contain it; say "last week" or "next quarter" instead.`
}

export function recordPrompt(world: World, spec: SourceSpec): string {
	const people = new Map(world.people.map((p) => [p.id, p]))
	const account = world.accounts.find((a) => a.id === spec.accountId)
	const describe = (id: string) => {
		const p = people.get(id)
		if (!p) return id
		const org =
			p.org === "northstar"
				? COMPANY.name
				: world.accounts.find((a) => a.id === p.org)?.name
		return `${p.name} (${p.title}, ${org})`
	}
	const participants = spec.participantIds.filter((id) => id !== spec.authorId)
	const lines = [
		`Record type: ${spec.kind}`,
		`Title: ${spec.title}`,
		`Date: ${longDate(spec.date.slice(0, 10))}, ${spec.date.slice(11, 16)} UTC`,
		`Author: ${describe(spec.authorId)}`,
		participants.length
			? `Also involved: ${participants.map(describe).join("; ")}`
			: "",
		account
			? `Customer account: ${account.name}, ${account.industry}, ${account.region}, ${trucks(account.fleetSize)}, products: ${account.productIds.map((id) => PRODUCTS.find((p) => p.id === id)?.name).join(", ")}`
			: "",
		`What happens: ${spec.brief}`,
		`Must contain verbatim: ${spec.facts.map((f) => `"${f}"`).join(", ")}`,
		`Length: ${WORDS[spec.length]}`,
	]
	return lines.filter(Boolean).join("\n")
}
