import type { MdbrainClient, MdbrainWikiPromotion } from "@mdbrain/client"
import { ROLE_LABELS, type AgentRole } from "./config.js"
import { eventKey } from "../seeding/ids.js"
import type { RenderedRecord, World } from "../corpus/types.js"

/** A held-back source the role must replay as a memory event, pinned to
 * the seeded idempotency key and the rendered body (the same evidence
 * mapping the seeder uses). */
export type PinnedEvent = {
	sourceId: string
	role: "user" | "assistant" | "system" | "tool"
	body: string
	idempotencyKey: string
}

/** Exact wikiApply payload the support role must land. */
export type PinnedPage = Parameters<MdbrainClient["wikiApply"]>[0]

/** Exact mdbrain_add proposal the product lead must send. */
export type PinnedProposal = {
	content: string
	idempotencyKey: string
	promotionPolicy: "wiki"
	wikiPromotion: MdbrainWikiPromotion
}

export type RolePlan = {
	role: AgentRole
	system: string
	prompt: string
	events: PinnedEvent[]
	/** Wiki slugs the role must read before it finishes. */
	reads: string[]
	page?: PinnedPage
	proposal?: PinnedProposal
}

/** Which role owns a storyline: support owns renewal risk and ETA drift,
 * the account manager owns the champion leaving, the product lead owns
 * pricing. */
export function roleForStoryline(storyline: string): AgentRole {
	switch (storyline) {
		case "renewal-risk":
		case "eta-drift":
			return "support"
		case "champion-leaving":
			return "account"
		case "pricing-change":
			return "product"
		default:
			throw new Error(`unknown storyline: ${storyline}`)
	}
}

export function buildRolePlans(input: {
	world: World
	records: Map<string, RenderedRecord>
	runId: string
	scopeRef: string
}): Record<AgentRole, RolePlan> {
	const events: Record<AgentRole, PinnedEvent[]> = {
		support: [],
		account: [],
		product: [],
	}
	for (const source of input.world.sources) {
		if (source.phase !== "replay") continue
		if (!source.storyline) {
			throw new Error(`replay source ${source.id} has no storyline`)
		}
		events[roleForStoryline(source.storyline)].push(
			replayEvent(input.records, input.scopeRef, source.id),
		)
	}
	const incoming = input.world.contradiction.incoming
	const page: PinnedPage = {
		kind: incoming.kind,
		title: incoming.title,
		slug: incoming.slug,
		summary: incoming.summary,
		body: incoming.body,
		frontmatter: { type: incoming.type, tags: incoming.tags },
		claims: incoming.claims.map((claim) => ({
			id: claim.id,
			text: claim.text,
			confidence: claim.confidence,
		})),
		relationships: incoming.relationships.map((relationship) => ({
			targetPageSlug: relationship.targetPageSlug,
			targetTitle: titleForSlug(input.world, relationship.targetPageSlug),
			kind: relationship.kind,
		})),
		scope: "workspace",
		scopeRef: input.scopeRef,
		trustTier: "standard",
	}
	// Staging (ticket 10): the account role reads the support role's
	// completed revision and answers with one cross-role memory note.
	events.account.push({
		sourceId: "account-note",
		role: "user",
		body: `Cross-role note after reading ${incoming.slug}: the account team confirms the champion context and folds the renewal risk into the account history.`,
		idempotencyKey: `agents:${input.runId}:account-note`,
	})
	const proposal: PinnedProposal = {
		content:
			"Proposal: synthesize the eta-drift storyline into a wiki page. Support tickets and threads show ETA commitments slipping with no one reopening the commitment.",
		idempotencyKey: `agents:${input.runId}:proposal:silent-eta-drift`,
		promotionPolicy: "wiki",
		wikiPromotion: {
			page: {
				kind: "synthesis",
				title: "Silent ETA drift",
				slug: "syntheses/silent-eta-drift",
				summary:
					"ETA commitments drift silently between support tickets and threads.",
				body: "Across the replayed support tickets and threads, ETA commitments slipped repeatedly without anyone reopening the original commitment. The pattern is visible only when the tickets are read together.",
				frontmatter: { type: "synthesis" },
				claims: [
					{
						id: "silent-eta-drift-pattern",
						text: "ETA commitments drift silently between support tickets and threads.",
						confidence: 0.7,
					},
				],
				scope: "workspace",
				scopeRef: input.scopeRef,
				trustTier: "standard",
			},
		},
	}
	const eventLines = (list: PinnedEvent[]) =>
		list.map(
			(event) =>
				`   mdbrain_write_event ${JSON.stringify({
					role: event.role,
					body: event.body,
					idempotencyKey: event.idempotencyKey,
				})}`,
		)
	const readRisk = `   mdbrain_wiki_get ${JSON.stringify({
		slug: incoming.slug,
		scope: "workspace",
		scopeRef: input.scopeRef,
	})}`
	const support: RolePlan = {
		role: "support",
		system: systemPrompt(input.world, "support"),
		prompt: [
			"Replay the held-back support sources into the run workspace, then publish the support-side risk page. Use the tools; send these exact payloads.",
			"",
			"1. Write each held-back source as a memory event, in order:",
			...eventLines(events.support),
			"",
			"2. Publish the risk page with mdbrain_wiki_apply, exactly this payload:",
			`   ${JSON.stringify(page)}`,
			"",
			'3. When every write has landed, reply with one line starting "done".',
		].join("\n"),
		events: events.support,
		reads: [],
		page,
	}
	const account: RolePlan = {
		role: "account",
		system: systemPrompt(input.world, "account"),
		prompt: [
			"The Support Lead has published a risk page about the renewal. Read it, replay your held-back account sources, and add one cross-role note from the account side.",
			"",
			"1. Read the risk page with mdbrain_wiki_get, exactly:",
			readRisk,
			"",
			"2. Write each held-back source and the final account note as memory events, in order:",
			...eventLines(events.account),
			"",
			"3. Reply with one line: what the risk page means for the account.",
		].join("\n"),
		events: events.account,
		reads: [incoming.slug],
	}
	const product: RolePlan = {
		role: "product",
		system: systemPrompt(input.world, "product"),
		prompt: [
			"The Support Lead published a risk page and the Account Manager confirmed it from the account side. Read the risk page, replay your held-back pricing sources, and leave the Silent ETA drift synthesis as a pending proposal.",
			"",
			"1. Read the risk page with mdbrain_wiki_get, exactly:",
			readRisk,
			"",
			"2. Write each held-back source as a memory event, in order:",
			...eventLines(events.product),
			"",
			"3. Propose the synthesis page with mdbrain_add, exactly this payload:",
			`   ${JSON.stringify(proposal)}`,
			"",
			"Do not apply any wiki page directly; the proposal waits for an administrator.",
		].join("\n"),
		events: events.product,
		reads: [incoming.slug],
		proposal,
	}
	return { support, account, product }
}

function replayEvent(
	records: Map<string, RenderedRecord>,
	scopeRef: string,
	sourceId: string,
): PinnedEvent {
	const record = records.get(sourceId)
	if (!record) {
		throw new Error(`no rendered record for replay source ${sourceId}`)
	}
	return {
		sourceId,
		role: "user",
		body: record.body,
		idempotencyKey: eventKey(scopeRef, sourceId),
	}
}

function systemPrompt(world: World, role: AgentRole): string {
	return [
		`You are the ${ROLE_LABELS[role]} at ${world.company.name}, ${world.company.summary}.`,
		"You work through mdbrain's MCP tools against the run's workspace: every write is recorded as memory, and a wiki page you publish is read by the next role.",
		"Use the tools for every read and write, never invent facts, and send the payloads you are given verbatim.",
	].join(" ")
}

function titleForSlug(world: World, slug: string): string {
	const page = world.pages.find((candidate) => candidate.slug === slug)
	if (page) return page.title
	const tail = slug.split("/").pop() ?? slug
	return tail
		.split("-")
		.map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
		.join(" ")
}
