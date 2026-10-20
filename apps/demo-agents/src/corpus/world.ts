import { CAST, COMPANY, HALVORSEN, LIST_PRICE, PRODUCTS } from "./cast.js"
import { CONTACT_TITLES, TEAMS } from "./catalog.js"
import { slugify } from "./format.js"
import {
	COMPANY_STEMS,
	COMPANY_SUFFIXES,
	FIRST_NAMES,
	INDUSTRIES,
	LAST_NAMES,
	REGIONS,
	isScreenedName,
} from "./names.js"
import { buildPages } from "./pages.js"
import { type Rng, createRng } from "./rng.js"
import { genericSources } from "./sources.js"
import { storylineIndex, storylineSources } from "./storylines.js"
import type { Account, Person, World } from "./types.js"

const ACCOUNT_COUNT = 60

// Generated people never share a surname with the named cast, so a reader
// does not mistake them for relatives or the same person.
function nameMaker(rng: Rng, taken: string[]) {
	const used = new Set(taken)
	const castSurnames = new Set(taken.map((n) => n.split(" ").at(-1)))
	const lastNames = LAST_NAMES.filter((n) => !castSurnames.has(n))
	return () => {
		for (;;) {
			const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(lastNames)}`
			if (!used.has(name)) {
				used.add(name)
				return name
			}
		}
	}
}

const personId = (name: string) => `per-${slugify(name)}`

function northstarStaff(rng: Rng, nextName: () => string) {
	const fixed = [
		CAST.ceo,
		CAST.cro,
		CAST.cfo,
		CAST.vpSales,
		CAST.ae,
		CAST.csm,
		CAST.supportLead,
		CAST.supportEng,
		CAST.pm,
		CAST.ml,
		CAST.pricing,
		CAST.writer,
		CAST.revops,
	]
	const make = (title: string, team: string): Person => {
		const name = nextName()
		return { id: personId(name), name, title, org: "northstar", team }
	}
	const aes = [
		CAST.ae,
		...Array.from({ length: 7 }, () => make("Account Executive", "Sales")),
	]
	const csms = [
		CAST.csm,
		...Array.from({ length: 5 }, () =>
			make("Customer Success Manager", "Customer Success"),
		),
	]
	const staff = TEAMS.flatMap(({ team, size, titles }) =>
		Array.from({ length: size }, () => make(rng.pick(titles), team)),
	)
	const unique = [
		...new Map(
			[...fixed, ...aes, ...csms, ...staff].map((p) => [p.id, p]),
		).values(),
	]
	return { people: unique, aes, csms }
}

function isoDayBetween(rng: Rng, from: string, to: string): string {
	const start = Date.parse(`${from}T00:00:00Z`)
	const days = Math.round((Date.parse(`${to}T00:00:00Z`) - start) / 86_400_000)
	return new Date(start + rng.int(0, days) * 86_400_000)
		.toISOString()
		.slice(0, 10)
}

function generatedAccounts(
	rng: Rng,
	nextName: () => string,
	aes: Person[],
	csms: Person[],
): { accounts: Account[]; contacts: Person[] } {
	const accounts: Account[] = []
	const contacts: Person[] = []
	const usedNames = new Set([HALVORSEN.name])
	for (const stem of rng.sample(COMPANY_STEMS, COMPANY_STEMS.length)) {
		if (accounts.length === ACCOUNT_COUNT - 1) break
		const name = `${stem} ${rng.pick(COMPANY_SUFFIXES)}`
		if (usedNames.has(name) || !isScreenedName(name)) continue
		usedNames.add(name)
		const slug = slugify(name)
		const id = `acct-${slug}`
		const fleetSize = rng.int(8, 300) * 10
		const productIds = [
			"track",
			...(rng.chance(0.6) ? ["predict"] : []),
			...(rng.chance(0.4) ? ["dock"] : []),
		]
		const perTruck = productIds.reduce(
			(sum, p) => sum + (LIST_PRICE[p] ?? 0),
			0,
		)
		const contactCount = 2 + (rng.chance(0.6) ? 1 : 0)
		const titles = rng.sample(CONTACT_TITLES, contactCount)
		const accountContacts = titles.map((title): Person => {
			const personName = nextName()
			return { id: personId(personName), name: personName, title, org: id }
		})
		contacts.push(...accountContacts)
		const index = accounts.length
		accounts.push({
			id,
			slug,
			name,
			industry: rng.pick(INDUSTRIES),
			region: rng.pick(REGIONS),
			fleetSize,
			productIds,
			arrUsd: Math.round((fleetSize * perTruck * 12) / 1000) * 1000,
			renewalDate: isoDayBetween(rng, "2026-10-01", "2027-06-30"),
			ownerId: (aes[(index + 1) % aes.length] as Person).id,
			csmId: (csms[(index + 1) % csms.length] as Person).id,
			contactIds: accountContacts.map((c) => c.id),
			championId: (accountContacts[0] as Person).id,
		})
	}
	if (accounts.length !== ACCOUNT_COUNT - 1)
		throw new Error("not enough screened company names")
	return { accounts, contacts }
}

export function buildWorld(seed: number): World {
	const rng = createRng(seed)
	const fixedNames = Object.values(CAST).map((p) => p.name)
	const nextName = nameMaker(rng, fixedNames)
	const { people: staff, aes, csms } = northstarStaff(rng, nextName)
	const generated = generatedAccounts(rng, nextName, aes, csms)
	const accounts = [HALVORSEN, ...generated.accounts]
	const people = [
		...staff,
		CAST.champion,
		CAST.dispatch,
		CAST.procurement,
		...generated.contacts,
	]

	const predictCustomers = generated.accounts.filter((a) =>
		a.productIds.includes("predict"),
	)
	const [driftA, driftB, driftC] = rng.sample(predictCustomers, 3) as [
		Account,
		Account,
		Account,
	]
	const drift = new Set([driftA.id, driftB.id, driftC.id])
	const pricing = rng.pick(generated.accounts.filter((a) => !drift.has(a.id)))
	pricing.renewalDate = "2026-09-30"

	const story = storylineSources({ drift: [driftA, driftB, driftC], pricing })
	const sources = [...story, ...genericSources(rng, { accounts, people })].sort(
		(a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
	)
	const { pages, contradiction } = buildPages({ accounts, people, sources })
	return {
		seed,
		company: COMPANY,
		products: PRODUCTS,
		people,
		accounts,
		sources,
		pages,
		storylines: storylineIndex(story),
		contradiction,
	}
}
