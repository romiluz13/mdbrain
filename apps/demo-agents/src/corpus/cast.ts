import type { Account, Person, Product } from "./types.js"

export const COMPANY = {
	name: "Northstar Systems",
	summary:
		"Northstar Systems (fictional) sells logistics-visibility software to freight and distribution fleets: live tracking, predicted arrival times and dock scheduling. About 250 employees, about 60 customer accounts.",
}

export const PRODUCTS: Product[] = [
	{
		id: "track",
		name: "Northstar Track",
		summary: "Live shipment and truck tracking from ELD and telematics feeds.",
	},
	{
		id: "predict",
		name: "Predict ETA",
		summary: "Machine-learned arrival-time predictions for every stop.",
	},
	{
		id: "dock",
		name: "Dock Scheduler",
		summary: "Dock appointment booking and yard flow for warehouses.",
	},
]

// Per truck per month, list price in USD.
export const LIST_PRICE: Record<string, number> = {
	track: 14,
	predict: 9,
	dock: 6,
}

const ns = (id: string, name: string, title: string, team: string): Person => ({
	id,
	name,
	title,
	org: "northstar",
	team,
})

export const CAST = {
	ceo: ns(
		"per-mira-achterberg",
		"Mira Achterberg",
		"Chief Executive Officer",
		"Leadership",
	),
	cro: ns(
		"per-daniel-okafor",
		"Daniel Okafor",
		"Chief Revenue Officer",
		"Leadership",
	),
	cfo: ns(
		"per-ruth-lindqvist",
		"Ruth Lindqvist",
		"Chief Financial Officer",
		"Finance",
	),
	vpSales: ns(
		"per-henrik-dahlgren",
		"Henrik Dahlgren",
		"VP Sales, EMEA",
		"Sales",
	),
	ae: ns(
		"per-camille-moreau",
		"Camille Moreau",
		"Senior Account Executive",
		"Sales",
	),
	csm: ns(
		"per-arjun-chaudry",
		"Arjun Chaudry",
		"Customer Success Manager",
		"Customer Success",
	),
	supportLead: ns(
		"per-noa-segal",
		"Noa Segal",
		"Support Lead, Tier 2",
		"Support",
	),
	supportEng: ns(
		"per-emeka-ibekwe",
		"Emeka Ibekwe",
		"Support Engineer",
		"Support",
	),
	pm: ns(
		"per-leila-haddad",
		"Leila Haddad",
		"Product Manager, Predict ETA",
		"Product",
	),
	ml: ns(
		"per-oskar-thorsby",
		"Oskar Thorsby",
		"Staff ML Engineer, ETA models",
		"Engineering",
	),
	pricing: ns(
		"per-priya-kaplan",
		"Priya Kaplan",
		"Head of Pricing and Packaging",
		"Finance",
	),
	writer: ns("per-theo-wexley", "Theo Wexley", "Technical Writer", "Product"),
	revops: ns(
		"per-selin-yilmaz",
		"Selin Yilmaz",
		"Revenue Operations Manager",
		"Sales",
	),
	champion: {
		id: "per-tobias-brandvold",
		name: "Tobias Brandvold",
		title: "VP Operations",
		org: "acct-halvorsen-freight-group",
	} satisfies Person,
	dispatch: {
		id: "per-ingrid-solberg",
		name: "Ingrid Solberg",
		title: "Head of Dispatch",
		org: "acct-halvorsen-freight-group",
	} satisfies Person,
	procurement: {
		id: "per-lars-eskeland",
		name: "Lars Eskeland",
		title: "Procurement Director",
		org: "acct-halvorsen-freight-group",
	} satisfies Person,
}

export const HALVORSEN: Account = {
	id: "acct-halvorsen-freight-group",
	slug: "halvorsen-freight-group",
	name: "Halvorsen Freight Group",
	industry: "grocery distribution",
	region: "Nordics",
	fleetSize: 4200,
	productIds: ["track", "predict", "dock"],
	arrUsd: 1_260_000,
	renewalDate: "2026-11-14",
	ownerId: CAST.ae.id,
	csmId: CAST.csm.id,
	contactIds: [CAST.champion.id, CAST.dispatch.id, CAST.procurement.id],
	championId: CAST.champion.id,
}
