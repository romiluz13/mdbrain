import { CAST, COMPANY, HALVORSEN, PRODUCTS } from "./cast.js"
import { TEAMS } from "./catalog.js"
import { longDate, slugify, trucks, usd } from "./format.js"
import type {
	Account,
	ClaimSpec,
	ContradictionSpec,
	PageSpec,
	Person,
	SourceSpec,
} from "./types.js"

type Ctx = { accounts: Account[]; people: Person[]; sources: SourceSpec[] }

export const PRODUCT_SLUG: Record<string, string> = {
	track: "products/northstar-track",
	predict: "products/predict-eta",
	dock: "products/dock-scheduler",
}
const COMPANY_SLUG = "company/northstar-systems"
const HEALTH_CLAIM_ID = "halvorsen-freight-group-renewal-health"
export const accountSlug = (a: Account) => `accounts/${a.slug}`
export const personSlug = (p: Person) => `people/${p.id.replace(/^per-/, "")}`
const teamSlug = (team: string) => `teams/${slugify(team)}`

const claim = (
	id: string,
	text: string,
	sourceId: string,
	anchor: string,
): ClaimSpec => ({
	id,
	text,
	confidence: 0.9,
	evidence: [{ sourceId, anchor }],
})

function body(
	title: string,
	summary: string,
	claims: ClaimSpec[],
	related: string[],
): string {
	const facts = claims.map((c) => `- ${c.text}`).join("\n")
	const links = related.map((slug) => `- [[${slug}]]`).join("\n")
	return [
		`# ${title}`,
		summary,
		facts && `## Key facts\n\n${facts}`,
		links && `## Related\n\n${links}`,
	]
		.filter(Boolean)
		.join("\n\n")
}

function page(spec: Omit<PageSpec, "body">): PageSpec {
	return {
		...spec,
		body: body(
			spec.title,
			spec.summary,
			spec.claims,
			spec.relationships.map((r) => r.targetPageSlug),
		),
	}
}

export function buildPages(ctx: Ctx): {
	pages: PageSpec[]
	contradiction: ContradictionSpec
} {
	const sourcesFor = (accountId: string, kind: SourceSpec["kind"]) =>
		ctx.sources.filter(
			(s) =>
				s.accountId === accountId && s.kind === kind && s.phase === "history",
		)
	const byName = new Map(ctx.people.map((p) => [p.id, p]))
	const doc = (title: string) => `src-doc-${slugify(title)}`

	const pages: PageSpec[] = [
		page({
			slug: COMPANY_SLUG,
			kind: "entity",
			type: "company",
			title: COMPANY.name,
			summary: COMPANY.summary,
			tags: ["company"],
			claims: [
				claim(
					"northstar-sla",
					"Northstar commits to 99.9% monthly uptime for Track and Dock Scheduler.",
					doc("SLA definitions"),
					"99.9% monthly uptime",
				),
				claim(
					"northstar-retention",
					"Northstar keeps position history for 13 months.",
					doc("Data retention policy"),
					"13 months",
				),
				claim(
					"northstar-soc2",
					"Northstar holds a SOC 2 Type II report.",
					doc("Security questionnaire standard answers"),
					"SOC 2 Type II",
				),
			],
			relationships: [],
		}),
		page({
			slug: PRODUCT_SLUG.track as string,
			kind: "entity",
			type: "product",
			title: "Northstar Track",
			summary: PRODUCTS[0]?.summary ?? "",
			tags: ["product"],
			claims: [
				claim(
					"track-9-3-links",
					"Northstar Track 9.3 adds shareable tracking links for consignees.",
					doc("Release notes: Northstar Track 9.3"),
					"shareable tracking links",
				),
				claim(
					"track-eld-updates",
					"ELD partners must send 30-second position updates to Northstar Track.",
					doc("ELD integration guide"),
					"30-second position",
				),
			],
			relationships: [{ targetPageSlug: COMPANY_SLUG, kind: "product-of" }],
		}),
		page({
			slug: PRODUCT_SLUG.predict as string,
			kind: "entity",
			type: "product",
			title: "Predict ETA",
			summary: PRODUCTS[1]?.summary ?? "",
			tags: ["product"],
			claims: [
				claim(
					"predict-model",
					"Predict ETA uses a gradient-boosted model over live position, traffic and historical dwell time.",
					doc("How Predict ETA works"),
					"gradient-boosted",
				),
				claim(
					"predict-v4-2-mae",
					"ETA model v4.2 showed 12% lower mean absolute error on the benchmark.",
					"src-drift-02",
					"12% lower mean absolute error",
				),
			],
			relationships: [{ targetPageSlug: COMPANY_SLUG, kind: "product-of" }],
		}),
		page({
			slug: PRODUCT_SLUG.dock as string,
			kind: "entity",
			type: "product",
			title: "Dock Scheduler",
			summary: PRODUCTS[2]?.summary ?? "",
			tags: ["product"],
			claims: [
				claim(
					"dock-4-1-no-show",
					"Dock Scheduler 4.1 flags carrier no-show patterns.",
					doc("Release notes: Dock Scheduler 4.1"),
					"carrier no-show",
				),
			],
			relationships: [{ targetPageSlug: COMPANY_SLUG, kind: "product-of" }],
		}),
		page({
			slug: "concepts/eta-model-v4-2",
			kind: "concept",
			type: "model-release",
			title: "ETA model v4.2",
			summary: "The Predict ETA model release that added a dwell-time feature.",
			tags: ["predict-eta", "release"],
			claims: [
				claim(
					"eta-v4-2-rollout",
					"ETA model v4.2 rolled out to all customers on July 14.",
					"src-drift-02",
					"July 14",
				),
				claim(
					"eta-v4-2-dwell",
					"ETA model v4.2 adds a dwell-time feature for stops at shared docks.",
					"src-drift-02",
					"dwell-time feature",
				),
			],
			relationships: [
				{ targetPageSlug: PRODUCT_SLUG.predict as string, kind: "version-of" },
			],
		}),
		page({
			slug: "policies/pricing-and-discounts",
			kind: "procedure",
			type: "policy",
			title: "Pricing and discount policy",
			summary: "How Northstar prices its products and who approves discounts.",
			tags: ["pricing", "policy"],
			claims: [
				claim(
					"pricing-unit",
					"Northstar prices every product per truck per month.",
					"src-pricing-01",
					"per truck per month",
				),
				claim(
					"pricing-discount-approval",
					"The VP Sales approves discounts up to 25%.",
					"src-pricing-01",
					"up to 25%",
				),
			],
			relationships: Object.values(PRODUCT_SLUG).map((slug) => ({
				targetPageSlug: slug,
				kind: "prices",
			})),
		}),
		...[
			[
				"processes/support-escalation",
				"Support escalation",
				"Severity 1 tickets get a first response within 30 minutes.",
				"Support escalation runbook",
				"within 30 minutes",
			],
			[
				"processes/renewal-playbook",
				"Renewal playbook",
				"Account teams start renewals 120 days out with a mutual action plan.",
				"Renewal playbook",
				"120 days",
			],
			[
				"processes/large-fleet-onboarding",
				"Large fleet onboarding",
				"Fleets over 1,000 trucks follow a six-week rollout.",
				"Onboarding playbook for fleets over 1,000 trucks",
				"six-week rollout",
			],
			[
				"concepts/customer-health-score",
				"Customer health score",
				"The customer health score counts weekly active dispatchers and open Severity 1 tickets.",
				"Customer health score definition",
				"weekly active dispatchers",
			],
			[
				"incidents/carrier-api-outage-2026-07-22",
				"Carrier API outage, July 22",
				"The carrier API outage on July 22 lasted 47 minutes.",
				"Incident review: carrier API outage on July 22",
				"47 minutes",
			],
		].map(([slug, title, text, docTitle, anchor]) =>
			page({
				slug: slug as string,
				kind: (slug as string).startsWith("processes/")
					? "procedure"
					: "concept",
				type: (slug as string).split("/")[0] as string,
				title: title as string,
				summary: text as string,
				tags: [(slug as string).split("/")[0] as string],
				claims: [
					claim(
						slugify(slug as string),
						text as string,
						doc(docTitle as string),
						anchor as string,
					),
				],
				relationships: [{ targetPageSlug: COMPANY_SLUG, kind: "part-of" }],
			}),
		),
		...["Leadership", ...TEAMS.map((t) => t.team)].map((team) =>
			page({
				slug: teamSlug(team),
				kind: "entity",
				type: "team",
				title: `${team} team`,
				summary: `Northstar's ${team} team (${ctx.people.filter((p) => p.team === team).length} people).`,
				tags: ["team"],
				claims: [],
				relationships: [{ targetPageSlug: COMPANY_SLUG, kind: "part-of" }],
			}),
		),
	]

	// Person pages: the named cast and every account owner and CSM.
	const owners = new Map<string, { ae: Account[]; csm: Account[] }>()
	for (const a of ctx.accounts) {
		for (const [id, role] of [
			[a.ownerId, "ae"],
			[a.csmId, "csm"],
		] as const) {
			const entry = owners.get(id) ?? { ae: [], csm: [] }
			entry[role].push(a)
			owners.set(id, entry)
		}
	}
	const overviewOf = (a: Account) =>
		a.id === HALVORSEN.id ? "src-renewal-01" : `src-${a.slug}-overview`
	const cast = Object.values(CAST)
	const personIds = new Set([...cast.map((p) => p.id), ...owners.keys()])
	for (const id of personIds) {
		const person = byName.get(id) as Person
		const roles = owners.get(id)
		const claims: ClaimSpec[] = []
		const relationships: PageSpec["relationships"] = []
		for (const [role, label] of [
			["ae", "account executive"],
			["csm", "customer success manager"],
		] as const) {
			const list = roles?.[role] ?? []
			if (!list.length) continue
			const names = list.map((a) => a.name)
			const joined =
				names.length > 1
					? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
					: names[0]
			claims.push({
				id: `${slugify(person.name)}-${role}-accounts`,
				text: `${person.name} is the ${label} for ${joined}.`,
				confidence: 0.9,
				evidence: list.map((a) => ({
					sourceId: overviewOf(a),
					anchor: person.name,
				})),
			})
		}
		if (person.org === "northstar") {
			relationships.push({
				targetPageSlug: teamSlug(person.team ?? "Leadership"),
				kind: "member-of",
			})
		} else {
			relationships.push({
				targetPageSlug: accountSlug(HALVORSEN),
				kind: "works-at",
			})
		}
		if (id === CAST.champion.id) {
			claims.push(
				claim(
					"tobias-brandvold-champion",
					`Tobias Brandvold is the champion for Northstar at ${HALVORSEN.name}.`,
					"src-renewal-01",
					CAST.champion.name,
				),
			)
		}
		pages.push(
			page({
				slug: personSlug(person),
				kind: "entity",
				type: "person",
				title: person.name,
				summary: `${person.title}, ${person.org === "northstar" ? COMPANY.name : HALVORSEN.name}.`,
				tags: ["person"],
				claims,
				relationships,
			}),
		)
	}

	for (const a of ctx.accounts) {
		const overview = overviewOf(a)
		const claims = [
			claim(
				`${a.slug}-fleet`,
				`${a.name} runs ${trucks(a.fleetSize)} on Northstar.`,
				overview,
				trucks(a.fleetSize),
			),
			claim(
				`${a.slug}-renewal`,
				`${a.name}'s renewal is due on ${longDate(a.renewalDate)}.`,
				overview,
				longDate(a.renewalDate),
			),
			claim(
				`${a.slug}-arr`,
				`${a.name} brings ${usd(a.arrUsd)} in annual recurring revenue.`,
				overview,
				usd(a.arrUsd),
			),
		]
		const tickets = sourcesFor(a.id, "support_ticket").slice(0, 2)
		for (const t of tickets) {
			const [ticketId, phrase] = t.facts
			const about = t.storyline ? `: ${t.title}` : ` covers ${phrase}`
			claims.push(
				claim(
					`${a.slug}-${slugify(ticketId as string)}`,
					`Support ticket ${ticketId} for ${a.name}${about}.`,
					t.id,
					ticketId as string,
				),
			)
		}
		if (a.id === HALVORSEN.id) {
			claims.push(
				claim(
					HEALTH_CLAIM_ID,
					"The Halvorsen Freight Group renewal is healthy and on track for November signature.",
					"src-renewal-03",
					"on track for November signature",
				),
			)
		}
		const relationships: PageSpec["relationships"] = [
			...a.productIds.map((p) => ({
				targetPageSlug: PRODUCT_SLUG[p] as string,
				kind: "uses",
			})),
			{
				targetPageSlug: personSlug(byName.get(a.ownerId) as Person),
				kind: "owned-by",
			},
			{
				targetPageSlug: personSlug(byName.get(a.csmId) as Person),
				kind: "managed-by",
			},
		]
		if (a.id === HALVORSEN.id)
			relationships.push({
				targetPageSlug: personSlug(CAST.champion),
				kind: "champion",
			})
		pages.push(
			page({
				slug: accountSlug(a),
				kind: "entity",
				type: "customer-account",
				title: a.name,
				summary: `${a.industry[0]?.toUpperCase()}${a.industry.slice(1)} fleet in ${a.region}; customer of ${COMPANY.name}.`,
				tags: ["customer", slugify(a.region)],
				claims,
				relationships,
			}),
		)
	}

	const incoming = page({
		slug: "risks/halvorsen-renewal-support-view",
		kind: "synthesis",
		type: "risk-assessment",
		title: "Halvorsen renewal: support view",
		summary: "Support's assessment of the Halvorsen Freight Group renewal.",
		tags: ["risk", "renewal"],
		claims: [
			claim(
				"halvorsen-renewal-support-view",
				"The Halvorsen Freight Group renewal is not on track for November signature: open ETA drift escalations remain unresolved.",
				"src-renewal-05",
				"open ETA drift escalations",
			),
		],
		relationships: [
			{ targetPageSlug: accountSlug(HALVORSEN), kind: "assesses" },
		],
	})
	return {
		pages,
		contradiction: {
			targetPageSlug: accountSlug(HALVORSEN),
			targetClaimId: HEALTH_CLAIM_ID,
			incoming,
		},
	}
}
