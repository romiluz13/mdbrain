import { CAST, HALVORSEN } from "./cast.js"
import { at, longDate, usd, trucks } from "./format.js"
import type { Account, SourceSpec, Storyline } from "./types.js"

export type StorylineContext = {
	// Three other Predict ETA customers hit by the same defect.
	drift: [Account, Account, Account]
	// The account whose renewal used the outdated discount rule.
	pricing: Account
}

// Ticket and issue numbers the generic generator must not reuse.
export const RESERVED_IDS = [
	"NS-4871",
	"NS-4955",
	"NS-4979",
	"NS-5034",
	"NS-5120",
	"NS-5188",
	"PRED-1412",
	"PRED-1467",
]

const H = HALVORSEN
const C = CAST

export function storylineSources(ctx: StorylineContext): SourceSpec[] {
	const [driftA, driftB, driftC] = ctx.drift
	const contact = (account: Account) => account.contactIds[0] as string
	const s = (
		spec: Omit<SourceSpec, "productIds" | "phase"> &
			Partial<Pick<SourceSpec, "productIds" | "phase">>,
	): SourceSpec => ({ productIds: [], phase: "history", ...spec })

	return [
		// renewal-risk
		s({
			id: "src-renewal-01",
			kind: "crm_note",
			storyline: "renewal-risk",
			title: `${H.name}: Q3 account plan`,
			date: at("2026-07-21", "09:40"),
			authorId: C.ae.id,
			participantIds: [C.ae.id, C.csm.id],
			accountId: H.id,
			productIds: H.productIds,
			facts: [
				trucks(H.fleetSize),
				longDate(H.renewalDate),
				usd(H.arrUsd),
				C.ae.name,
				C.csm.name,
				C.champion.name,
			],
			brief: `Camille Moreau's account plan for the quarter. ${H.name} runs Northstar Track, Predict ETA and Dock Scheduler across ${trucks(H.fleetSize)}; the renewal is due ${longDate(H.renewalDate)} with ${usd(H.arrUsd)} in annual recurring revenue. Goal: close early on a three-year term. Tobias Brandvold (VP Operations) is the champion. The risk list is short: procurement may push on price.`,
			length: "long",
		}),
		s({
			id: "src-renewal-02",
			kind: "call_transcript",
			storyline: "renewal-risk",
			title: `${H.name} renewal call`,
			date: at("2026-08-14", "13:00"),
			authorId: C.ae.id,
			participantIds: [C.ae.id, C.champion.id, C.procurement.id, C.csm.id],
			accountId: H.id,
			productIds: H.productIds,
			facts: ["verbal commit", "three-year term"],
			brief:
				"Tobias says operations are happy with Track and Dock Scheduler and gives a verbal commit to renew on a three-year term. Lars Eskeland asks whether Predict ETA pricing is changing and wants a written quote before October. Nobody from dispatch is on the call; Predict ETA accuracy does not come up.",
			length: "long",
		}),
		s({
			id: "src-renewal-03",
			kind: "crm_note",
			storyline: "renewal-risk",
			title: `${H.name}: verbal commit logged`,
			date: at("2026-08-18", "16:20"),
			authorId: C.ae.id,
			participantIds: [C.ae.id],
			accountId: H.id,
			facts: ["verbal commit", "on track for November signature"],
			brief:
				"Camille logs Tobias's verbal commit, moves the forecast category to Commit and marks the renewal healthy and on track for November signature. Next step: paper process with Lars Eskeland.",
			length: "short",
		}),
		s({
			id: "src-renewal-04",
			kind: "support_ticket",
			storyline: "renewal-risk",
			title: "Severity 1 escalation: Halvorsen dispatch overriding ETAs",
			date: at("2026-09-10", "08:05"),
			authorId: C.supportLead.id,
			participantIds: [C.dispatch.id, C.supportLead.id, C.supportEng.id],
			accountId: H.id,
			productIds: ["predict"],
			facts: ["NS-5120", "Severity 1", "PRED-1467"],
			brief:
				"Ingrid Solberg escalates: her dispatchers now override Predict ETA by hand on every multi-stop route out of the Oslo terminal. Noa Segal raises the ticket to Severity 1 and links it to PRED-1467. Ingrid says she will raise it at renewal time.",
			length: "medium",
		}),
		s({
			id: "src-renewal-05",
			kind: "slack_thread",
			storyline: "renewal-risk",
			phase: "replay",
			title: "#acct-halvorsen: support view on the renewal",
			date: at("2026-09-25", "10:15"),
			authorId: C.supportLead.id,
			participantIds: [C.supportLead.id, C.csm.id, C.ae.id],
			accountId: H.id,
			facts: ["open ETA drift escalations", "NS-5120"],
			brief:
				"Noa posts that from support's side the Halvorsen renewal is at risk: open ETA drift escalations (NS-5120 and two follow-ups) are unresolved and dispatch has stopped trusting the product. Camille replies that CRM still shows Commit from Tobias's verbal. Arjun suggests a written recovery plan.",
			length: "medium",
		}),

		// eta-drift
		s({
			id: "src-drift-01",
			kind: "jira_issue",
			storyline: "eta-drift",
			title: "PRED-1412: Ship ETA model v4.2 with multi-stop dwell features",
			date: at("2026-07-08", "11:00"),
			authorId: C.ml.id,
			participantIds: [C.ml.id, C.pm.id],
			productIds: ["predict"],
			facts: ["PRED-1412", "ETA model v4.2", "July 14"],
			brief:
				"Oskar Thorsby's ticket to ship ETA model v4.2, which adds a dwell-time feature for stops at shared docks. Rollout to all customers on July 14. Acceptance: offline accuracy on the standard benchmark.",
			length: "medium",
		}),
		s({
			id: "src-drift-02",
			kind: "doc",
			storyline: "eta-drift",
			title: "Release notes: Predict ETA model v4.2",
			date: at("2026-07-14", "15:30"),
			authorId: C.writer.id,
			participantIds: [C.writer.id, C.pm.id],
			productIds: ["predict"],
			facts: [
				"ETA model v4.2",
				"July 14",
				"dwell-time feature",
				"12% lower mean absolute error",
			],
			brief:
				"Customer-facing release notes dated July 14: ETA model v4.2 rolled out to all customers on July 14, adds a dwell-time feature and shows 12% lower mean absolute error on the benchmark. No customer action needed.",
			length: "medium",
		}),
		s({
			id: "src-drift-03",
			kind: "support_ticket",
			storyline: "eta-drift",
			title: "Late ETAs on multi-stop routes out of the Oslo terminal",
			date: at("2026-07-29", "07:50"),
			authorId: C.supportEng.id,
			participantIds: [C.dispatch.id, C.supportEng.id],
			accountId: H.id,
			productIds: ["predict"],
			facts: ["NS-4871", "38 minutes", "multi-stop routes"],
			brief:
				"Ingrid Solberg reports that since mid-July trucks on multi-stop routes arrive about 38 minutes later than Predict ETA showed. No alert fired. Emeka Ibekwe asks for route samples and tags the ticket for the ETA team.",
			length: "medium",
		}),
		s({
			id: "src-drift-04",
			kind: "support_ticket",
			storyline: "eta-drift",
			title: "ETAs optimistic on routes with three or more stops",
			date: at("2026-08-06", "14:25"),
			authorId: C.supportEng.id,
			participantIds: [contact(driftA), C.supportEng.id],
			accountId: driftA.id,
			productIds: ["predict"],
			facts: ["NS-4955", "multi-stop routes"],
			brief: `A planner at ${driftA.name} reports Predict ETA running early on multi-stop routes; customers are waiting at docks. Emeka links it to NS-4871.`,
			length: "medium",
		}),
		s({
			id: "src-drift-05",
			kind: "support_ticket",
			storyline: "eta-drift",
			title: "Arrival predictions drifting late on milk runs",
			date: at("2026-08-10", "09:05"),
			authorId: C.supportEng.id,
			participantIds: [contact(driftB), C.supportEng.id],
			accountId: driftB.id,
			productIds: ["predict"],
			facts: ["NS-4979", "multi-stop routes"],
			brief: `${driftB.name}'s transport lead says arrival predictions drift late through the day on multi-stop routes (milk runs). Started in July.`,
			length: "short",
		}),
		s({
			id: "src-drift-06",
			kind: "slack_thread",
			storyline: "eta-drift",
			title: "#support-escalations: is this an ETA drift pattern?",
			date: at("2026-08-12", "12:40"),
			authorId: C.supportLead.id,
			participantIds: [C.supportLead.id, C.supportEng.id, C.pm.id],
			productIds: ["predict"],
			facts: ["three accounts", "ETA model v4.2"],
			brief: `Noa Segal notices NS-4871 (${H.name}), NS-4955 (${driftA.name}) and NS-4979 (${driftB.name}): three accounts with late ETAs on multi-stop routes since the ETA model v4.2 rollout. Leila Haddad says no monitoring alert fired because the accuracy dashboard samples single-stop routes; she asks the ML team to look.`,
			length: "medium",
		}),
		s({
			id: "src-drift-07",
			kind: "jira_issue",
			storyline: "eta-drift",
			title: "PRED-1467: ETA drift on multi-stop routes after model v4.2",
			date: at("2026-08-19", "10:10"),
			authorId: C.ml.id,
			participantIds: [C.ml.id, C.pm.id, C.supportLead.id],
			productIds: ["predict"],
			facts: ["PRED-1467", "dwell-time feature", "multi-stop routes"],
			brief:
				"Oskar's analysis: the v4.2 dwell-time feature double counts dwell at stops that share a dock, so error grows with the number of stops on multi-stop routes. Monitoring missed it because the accuracy dashboard samples single-stop routes. Fix needs a retrain; target late September. Linked tickets NS-4871, NS-4955, NS-4979.",
			length: "long",
		}),
		s({
			id: "src-drift-08",
			kind: "support_ticket",
			storyline: "eta-drift",
			title: "Planner complaints: arrival predictions running late",
			date: at("2026-08-27", "16:45"),
			authorId: C.supportEng.id,
			participantIds: [contact(driftC), C.supportEng.id],
			accountId: driftC.id,
			productIds: ["predict"],
			facts: ["NS-5034", "multi-stop routes"],
			brief: `${driftC.name} reports planner complaints about late predictions on multi-stop routes. Emeka links it to PRED-1467.`,
			length: "short",
		}),
		s({
			id: "src-drift-09",
			kind: "call_transcript",
			storyline: "eta-drift",
			title: `${H.name} weekly operations call`,
			date: at("2026-09-03", "08:30"),
			authorId: C.csm.id,
			participantIds: [C.dispatch.id, C.csm.id, C.supportEng.id],
			accountId: H.id,
			productIds: ["predict"],
			facts: ["38 minutes", "PRED-1467"],
			brief:
				"Ingrid says her dispatchers stopped trusting ETAs on multi-stop routes; drift is still around 38 minutes on the worst routes. Emeka shares PRED-1467 status. Arjun promises weekly written updates.",
			length: "long",
		}),
		s({
			id: "src-drift-10",
			kind: "support_ticket",
			storyline: "eta-drift",
			phase: "replay",
			title: "Customer plans to switch off Predict ETA",
			date: at("2026-09-22", "07:35"),
			authorId: C.supportLead.id,
			participantIds: [contact(driftA), C.supportLead.id],
			accountId: driftA.id,
			productIds: ["predict"],
			facts: ["NS-5188", "switch off Predict ETA"],
			brief: `${driftA.name}'s operations lead says they will switch off Predict ETA next month and question the renewal unless multi-stop accuracy is fixed. References NS-4955.`,
			length: "medium",
		}),
		s({
			id: "src-drift-11",
			kind: "slack_thread",
			storyline: "eta-drift",
			phase: "replay",
			title: "#cs-leadership: renewals citing ETA accuracy",
			date: at("2026-09-24", "15:20"),
			authorId: C.csm.id,
			participantIds: [C.csm.id, C.cro.id, C.supportLead.id, C.pm.id],
			productIds: ["predict"],
			facts: ["two renewals", "mid-October"],
			brief: `Arjun Chaudry lists two renewals (${H.name} and ${driftA.name}) that now cite ETA accuracy. Daniel Okafor asks whether anyone tracks this as one pattern. Leila Haddad says the retrained model slips to mid-October.`,
			length: "medium",
		}),

		// pricing-change
		s({
			id: "src-pricing-01",
			kind: "doc",
			storyline: "pricing-change",
			title: "Pricing and discount policy, H2 2026",
			date: at("2026-07-01", "08:00"),
			authorId: C.pricing.id,
			participantIds: [C.pricing.id, C.cfo.id],
			productIds: ["track", "predict", "dock"],
			facts: ["per truck per month", "up to 25%", "VP Sales"],
			brief:
				"Official policy for account teams. Every product is priced per truck per month: Northstar Track $14, Predict ETA $9, Dock Scheduler $6. Account executives may discount up to 10% on their own; discounts up to 25% are approved by the VP Sales; anything larger goes to the CFO.",
			length: "long",
		}),
		s({
			id: "src-pricing-02",
			kind: "slack_thread",
			storyline: "pricing-change",
			title: "#deal-desk: Predict ETA pricing decision",
			date: at("2026-08-20", "17:05"),
			authorId: C.pricing.id,
			participantIds: [C.pricing.id, C.cfo.id, C.vpSales.id, C.cro.id],
			productIds: ["predict"],
			facts: ["per active asset", "September 1", "above 15%", "CFO approval"],
			brief:
				"Priya Kaplan summarizes the pricing review: from September 1 Predict ETA is priced per active asset instead of per truck, and any discount above 15% needs CFO approval. Ruth Lindqvist confirms. Henrik Dahlgren asks who updates the policy doc; Priya says she will get to it.",
			length: "medium",
		}),
		s({
			id: "src-pricing-03",
			kind: "crm_note",
			storyline: "pricing-change",
			title: `${ctx.pricing.name}: renewal closed`,
			date: at("2026-09-09", "11:30"),
			authorId: ctx.pricing.ownerId,
			participantIds: [ctx.pricing.ownerId, C.vpSales.id],
			accountId: ctx.pricing.id,
			productIds: ctx.pricing.productIds,
			facts: ["22% discount", "approved by Henrik Dahlgren"],
			brief: `The account executive logs the ${ctx.pricing.name} renewal as closed with a 22% discount approved by Henrik Dahlgren, citing the H2 pricing and discount policy.`,
			length: "short",
		}),
		s({
			id: "src-pricing-04",
			kind: "doc",
			storyline: "pricing-change",
			phase: "replay",
			title: "Pricing FAQ for account teams",
			date: at("2026-09-21", "09:00"),
			authorId: C.writer.id,
			participantIds: [C.writer.id],
			productIds: ["track", "predict", "dock"],
			facts: ["per truck per month", "up to 25%"],
			brief:
				"FAQ written from the H2 pricing and discount policy doc: every product per truck per month, VP Sales approves discounts up to 25%. It says nothing about the September 1 change.",
			length: "medium",
		}),
		s({
			id: "src-pricing-05",
			kind: "slack_thread",
			storyline: "pricing-change",
			phase: "replay",
			title: "#revops: discount approvals since September 1",
			date: at("2026-09-23", "13:50"),
			authorId: C.revops.id,
			participantIds: [C.revops.id, C.cfo.id, C.pricing.id],
			facts: ["22% discount", "CFO approval"],
			brief: `Selin Yilmaz flags that the ${ctx.pricing.name} renewal closed on September 9 with a 22% discount approved only by the VP Sales, although since September 1 discounts above 15% need CFO approval. She asks which document is right. Priya admits the policy doc was never updated.`,
			length: "medium",
		}),

		// champion-leaving
		s({
			id: "src-champion-01",
			kind: "slack_thread",
			storyline: "champion-leaving",
			title: "#acct-halvorsen: quiet champion",
			date: at("2026-09-08", "16:00"),
			authorId: C.csm.id,
			participantIds: [C.csm.id, C.ae.id],
			accountId: H.id,
			facts: ["reorg"],
			brief:
				"Arjun mentions Tobias skipped two syncs and he heard Halvorsen is planning an operations reorg. Camille is not worried: the verbal commit stands.",
			length: "short",
		}),
		s({
			id: "src-champion-02",
			kind: "crm_note",
			storyline: "champion-leaving",
			phase: "replay",
			title: `${H.name}: champion change`,
			date: at("2026-09-26", "12:10"),
			authorId: C.ae.id,
			participantIds: [C.ae.id, C.champion.id, C.dispatch.id],
			accountId: H.id,
			facts: ["end of October", "Ingrid Solberg"],
			brief:
				"Tobias tells Camille he is leaving Halvorsen at the end of October. Ingrid Solberg, Head of Dispatch, will own the Northstar relationship; she is the person most frustrated by the ETA drift. Camille moves the forecast from Commit to Best Case.",
			length: "medium",
		}),
		s({
			id: "src-champion-03",
			kind: "call_transcript",
			storyline: "champion-leaving",
			phase: "replay",
			title: "Intro call with Ingrid Solberg",
			date: at("2026-09-28", "09:00"),
			authorId: C.ae.id,
			participantIds: [C.ae.id, C.csm.id, C.dispatch.id],
			accountId: H.id,
			productIds: H.productIds,
			facts: ["written recovery plan", "October 9"],
			brief:
				"Ingrid says she will sign nothing until Northstar delivers a written recovery plan for multi-stop ETA accuracy. Arjun commits to sending the plan by October 9. Camille asks about timing for the November signature; Ingrid will not commit.",
			length: "long",
		}),
	]
}

export function storylineIndex(sources: SourceSpec[]): Storyline[] {
	const ids = (id: Storyline["id"]) =>
		sources.filter((s) => s.storyline === id).map((s) => s.id)
	return [
		{
			id: "renewal-risk",
			title: "Is the Halvorsen renewal safe?",
			summary:
				"Sales logs a verbal commit and calls the renewal healthy; support sees unresolved Severity 1 escalations.",
			sourceIds: ids("renewal-risk"),
		},
		{
			id: "eta-drift",
			title: "Silent ETA drift",
			summary:
				"ETA model v4.2 drifts late on multi-stop routes; monitoring misses it and it spreads across accounts into renewals.",
			sourceIds: ids("eta-drift"),
		},
		{
			id: "pricing-change",
			title: "A pricing change decided in Slack",
			summary:
				"Deal desk changes Predict ETA pricing and discount approvals in Slack; the policy doc and FAQ still say otherwise.",
			sourceIds: ids("pricing-change"),
		},
		{
			id: "champion-leaving",
			title: "The champion leaves",
			summary:
				"Tobias Brandvold leaves Halvorsen; the new owner is the person most hurt by the ETA drift.",
			sourceIds: ids("champion-leaving"),
		},
	]
}
