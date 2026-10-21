import { describe, expect, it } from "vitest"
import { runRoleAgents } from "./runner.js"
import { buildRolePlans, type PinnedEvent } from "./story.js"
import type { AgentRole } from "./config.js"
import { FakeCollection } from "../seeding/testing/fakes.js"
import { createRunManifests, type RunManifestDoc } from "../seeding/manifest.js"
import {
	fakeAgentClients,
	fakeModelBudget,
	scriptedModel,
	type ScriptedModel,
	type ScriptedTurn,
} from "./testing/fakes.js"
import {
	ACCOUNT_SLUG,
	REPLAY_SOURCE_IDS,
	RISK_SLUG,
	makeDemoRecords,
	makeDemoWorld,
} from "./testing/demo-world.js"

const SLOT = { index: 1, scopeRef: "demo-run-1", agentId: "demo-run-1" }
const RUN_ID = "run-1"

type Manifests = ReturnType<typeof createRunManifests>
type RunInput = Parameters<typeof runRoleAgents>[0]

function makeControl(): {
	collection: FakeCollection<RunManifestDoc>
	manifests: Manifests
} {
	const collection = new FakeCollection<RunManifestDoc>([])
	const manifests = createRunManifests(collection)
	return { collection, manifests }
}

async function readyRun(manifests: Manifests): Promise<void> {
	await manifests.createRun({
		runId: RUN_ID,
		slotIndex: SLOT.index,
		scopeRef: SLOT.scopeRef,
		agentId: SLOT.agentId,
		corpus: {
			sha256: "abc123",
			records: 8,
			eventsPlanned: 8,
			pagesPlanned: 1,
			replaySourceIds: [...REPLAY_SOURCE_IDS],
		},
		limitSources: undefined,
	})
	await manifests.markReady(RUN_ID)
}

function fakePool() {
	const used: number[] = []
	return {
		pool: {
			markUsed: async (index: number) => {
				used.push(index)
				return { index }
			},
		},
		used,
	}
}

function writeEventTurns(events: PinnedEvent[]) {
	return events.map((event) => ({
		toolName: "mdbrain_write_event",
		input: {
			role: event.role,
			body: event.body,
			idempotencyKey: event.idempotencyKey,
		},
	}))
}

function happyTurns(
	plans: ReturnType<typeof buildRolePlans>,
): Record<AgentRole, ScriptedTurn[]> {
	return {
		support: [
			{ toolCalls: writeEventTurns(plans.support.events) },
			{
				toolCalls: [
					{ toolName: "mdbrain_wiki_apply", input: { ...plans.support.page } },
				],
			},
			{ text: "support done" },
		],
		account: [
			{
				toolCalls: [
					{
						toolName: "mdbrain_wiki_get",
						input: {
							slug: RISK_SLUG,
							scope: "workspace",
							scopeRef: SLOT.scopeRef,
						},
					},
				],
			},
			{ toolCalls: writeEventTurns(plans.account.events) },
			{ text: "account done" },
		],
		product: [
			{
				toolCalls: [
					{
						toolName: "mdbrain_wiki_get",
						input: {
							slug: RISK_SLUG,
							scope: "workspace",
							scopeRef: SLOT.scopeRef,
						},
					},
					{
						toolName: "mdbrain_wiki_get",
						input: {
							slug: ACCOUNT_SLUG,
							scope: "workspace",
							scopeRef: SLOT.scopeRef,
						},
					},
				],
			},
			{
				toolCalls: [
					...writeEventTurns(plans.product.events),
					{ toolName: "mdbrain_add", input: { ...plans.product.proposal } },
				],
			},
			{ text: "product done" },
		],
	}
}

async function runComplete(
	overrides: Partial<Parameters<typeof runRoleAgents>[0]> = {},
) {
	const { manifests } = makeControl()
	await readyRun(manifests)
	const plans = buildRolePlans({
		world: makeDemoWorld(),
		records: makeDemoRecords(),
		runId: RUN_ID,
		scopeRef: SLOT.scopeRef,
	})
	const turns = happyTurns(plans)
	const models: Record<AgentRole, ScriptedModel> = {
		support: scriptedModel(turns.support!),
		account: scriptedModel(turns.account!),
		product: scriptedModel(turns.product!),
	}
	const clients = fakeAgentClients({ pinnedAgentId: SLOT.agentId })
	const { budget } = fakeModelBudget({ ceiling: 1_000_000 })
	const { pool, used } = fakePool()
	const base = {
		manifests,
		pool,
		runId: RUN_ID,
		slot: SLOT,
		clients: clients.clients,
		modelFor: (role: AgentRole) => models[role]!,
		budget,
		ceilings: { steps: 8, taskDeadlineMs: 5000, tokens: 1_000_000 },
		world: makeDemoWorld(),
		records: makeDemoRecords(),
	}
	const outcome = await runRoleAgents({ ...base, ...overrides } as RunInput)
	return { outcome, manifests, clients, models, used }
}

describe("runRoleAgents", () => {
	it("runs the three roles to a complete run and consumes the slot", async () => {
		const { outcome, manifests, clients, used } = await runComplete()
		expect(outcome.state).toBe("complete")
		expect(outcome.failureReason).toBeUndefined()
		expect(outcome.phases.map((phase) => phase.name)).toEqual([
			"replay-support",
			"staging-account",
			"proposal-product",
			"confirm-step-events",
		])
		expect(outcome.reusedPage).toEqual({
			slug: RISK_SLUG,
			writtenBy: "support",
			readBy: "account",
		})
		expect(outcome.pendingProposal).toEqual({
			title: "Silent ETA drift",
			slug: "syntheses/silent-eta-drift",
		})
		expect(outcome.stepsRecorded).toBe(9)
		expect(outcome.usage).toEqual({
			uncachedInput: 900,
			cacheRead: 270,
			cacheWrite: 450,
			output: 180,
		})

		const doc = await manifests.get(RUN_ID)
		expect(doc?.state).toBe("used")
		expect(doc?.agentRun?.state).toBe("complete")
		expect(doc?.agentRun?.usage).toEqual(outcome.usage)
		expect(doc?.agentRun?.reusedPage).toEqual(outcome.reusedPage)
		expect(doc?.agentRun?.pendingProposal).toEqual(outcome.pendingProposal)
		expect(used).toEqual([SLOT.index])

		const logs = clients.logs
		// 7 replay events + 1 account note + 9 step events
		expect(logs.filter((log) => log.method === "writeEvent")).toHaveLength(17)
		const applySeq = logs.find((log) => log.method === "wikiApply")?.seq
		const accountReadSeq = logs
			.filter((log) => log.method === "wikiGet" && log.role === "account")
			.map((log) => log.seq)[0]
		expect(applySeq!).toBeLessThan(accountReadSeq!)
		expect(
			logs.filter(
				(log) => log.role === "product" && log.method === "wikiApply",
			),
		).toEqual([])
		const add = logs.find((log) => log.method === "add")
		expect(add?.input).toMatchObject({
			promotionPolicy: "wiki",
			wikiPromotion: { page: { title: "Silent ETA drift" } },
		})
	})

	it("stops a looping task at the steps ceiling and marks the run incomplete", async () => {
		const { manifests } = makeControl()
		await readyRun(manifests)
		const looping = scriptedModel(
			[
				{
					toolCalls: [
						{
							toolName: "mdbrain_wiki_get",
							input: {
								slug: ACCOUNT_SLUG,
								scope: "workspace",
								scopeRef: SLOT.scopeRef,
							},
						},
					],
				},
			],
			{ repeatLast: true },
		)
		const { clients } = fakeAgentClients()
		const { budget } = fakeModelBudget({ ceiling: 1_000_000 })
		const { pool, used } = fakePool()
		const outcome = await runRoleAgents({
			manifests,
			pool,
			runId: RUN_ID,
			slot: SLOT,
			clients,
			modelFor: () => looping,
			budget,
			ceilings: { steps: 3, taskDeadlineMs: 5000, tokens: 1_000_000 },
			world: makeDemoWorld(),
			records: makeDemoRecords(),
		})
		expect(outcome.state).toBe("incomplete")
		expect(outcome.failureReason).toMatch(/steps|pinned|replay/)
		expect(looping.doGenerateCalls).toBe(3)
		expect(outcome.stepCounts.support).toBe(3)
		const doc = await manifests.get(RUN_ID)
		expect(doc?.state).toBe("ready")
		expect(doc?.agentRun?.state).toBe("incomplete")
		expect(used).toEqual([])
	})

	it("aborts a task that exceeds its deadline and marks the run incomplete", async () => {
		const { manifests } = makeControl()
		await readyRun(manifests)
		const slow = scriptedModel([{ text: "too slow" }], { delayMs: 150 })
		const { clients } = fakeAgentClients()
		const { budget } = fakeModelBudget({ ceiling: 1_000_000 })
		const { pool, used } = fakePool()
		const outcome = await runRoleAgents({
			manifests,
			pool,
			runId: RUN_ID,
			slot: SLOT,
			clients,
			modelFor: () => slow,
			budget,
			ceilings: { steps: 8, taskDeadlineMs: 30, tokens: 1_000_000 },
			world: makeDemoWorld(),
			records: makeDemoRecords(),
		})
		expect(outcome.state).toBe("incomplete")
		expect(outcome.failureReason).toMatch(/deadline/)
		expect(slow.doGenerateCalls).toBeLessThanOrEqual(1)
		const doc = await manifests.get(RUN_ID)
		expect(doc?.agentRun?.state).toBe("incomplete")
		expect(doc?.state).toBe("ready")
		expect(used).toEqual([])
	})

	it("refuses to exceed the run token ceiling and marks the run incomplete", async () => {
		const { manifests } = makeControl()
		await readyRun(manifests)
		const model = scriptedModel([{ text: "one call" }])
		const { clients } = fakeAgentClients()
		const { budget, reserves } = fakeModelBudget({ ceiling: 1 })
		const { pool, used } = fakePool()
		const outcome = await runRoleAgents({
			manifests,
			pool,
			runId: RUN_ID,
			slot: SLOT,
			clients,
			modelFor: () => model,
			budget,
			ceilings: { steps: 8, taskDeadlineMs: 5000, tokens: 1 },
			world: makeDemoWorld(),
			records: makeDemoRecords(),
		})
		expect(outcome.state).toBe("incomplete")
		expect(outcome.failureReason).toMatch(/budget/)
		expect(model.doGenerateCalls).toBe(0)
		expect(reserves[0]).toMatchObject({ key: "agents:run-1", ceiling: 1 })
		const doc = await manifests.get(RUN_ID)
		expect(doc?.agentRun?.state).toBe("incomplete")
		expect(used).toEqual([])
	})

	it("fails staging at once with the API's reason when the account read is refused", async () => {
		const { manifests } = makeControl()
		await readyRun(manifests)
		const plans = buildRolePlans({
			world: makeDemoWorld(),
			records: makeDemoRecords(),
			runId: RUN_ID,
			scopeRef: SLOT.scopeRef,
		})
		const turns = happyTurns(plans)
		const models: Record<AgentRole, ScriptedModel> = {
			support: scriptedModel(turns.support!),
			account: scriptedModel(turns.account!),
			product: scriptedModel(turns.product!),
		}
		const clients = fakeAgentClients({ pinnedAgentId: "another-agent" })
		const { budget } = fakeModelBudget({ ceiling: 1_000_000 })
		const { pool } = fakePool()
		const started = Date.now()
		const outcome = await runRoleAgents({
			manifests,
			pool,
			runId: RUN_ID,
			slot: SLOT,
			clients: clients.clients,
			modelFor: (role: AgentRole) => models[role]!,
			budget,
			ceilings: { steps: 8, taskDeadlineMs: 5000, tokens: 1_000_000 },
			world: makeDemoWorld(),
			records: makeDemoRecords(),
			stagingDeadlineMs: 2000,
			pollIntervalMs: 5,
		})
		expect(outcome.state).toBe("incomplete")
		expect(outcome.failureReason).toMatch(/403/)
		expect(outcome.failureReason).toMatch(/agentId is required/)
		expect(Date.now() - started).toBeLessThan(2000)
	})

	it("marks the run incomplete when the account role cannot read the support page in time", async () => {
		const { manifests } = makeControl()
		await readyRun(manifests)
		const plans = buildRolePlans({
			world: makeDemoWorld(),
			records: makeDemoRecords(),
			runId: RUN_ID,
			scopeRef: SLOT.scopeRef,
		})
		const turns = happyTurns(plans)
		const models: Record<AgentRole, ScriptedModel> = {
			support: scriptedModel(turns.support!),
			account: scriptedModel(turns.account!),
			product: scriptedModel(turns.product!),
		}
		const clients = fakeAgentClients({
			refuseWikiGetFor: { account: [RISK_SLUG] },
		})
		const { budget } = fakeModelBudget({ ceiling: 1_000_000 })
		const { pool, used } = fakePool()
		const outcome = await runRoleAgents({
			manifests,
			pool,
			runId: RUN_ID,
			slot: SLOT,
			clients: clients.clients,
			modelFor: (role: AgentRole) => models[role]!,
			budget,
			ceilings: { steps: 8, taskDeadlineMs: 5000, tokens: 1_000_000 },
			world: makeDemoWorld(),
			records: makeDemoRecords(),
			stagingDeadlineMs: 40,
			pollIntervalMs: 5,
		})
		expect(outcome.state).toBe("incomplete")
		expect(outcome.failureReason).toMatch(/staging/)
		expect(models.support.doGenerateCalls).toBe(3)
		expect(models.account.doGenerateCalls).toBe(0)
		expect(models.product.doGenerateCalls).toBe(0)
		const doc = await manifests.get(RUN_ID)
		expect(doc?.agentRun?.state).toBe("incomplete")
		expect(doc?.state).toBe("ready")
		expect(used).toEqual([])
		// the support step events still landed before the manifest flip
		expect(
			clients.logs.filter(
				(log) =>
					log.method === "writeEvent" &&
					String(log.input.idempotencyKey).startsWith("agents:run-1:step:"),
			),
		).toHaveLength(3)
	})
})

describe("runRoleAgents evidence", () => {
	function plans() {
		return buildRolePlans({
			world: makeDemoWorld(),
			records: makeDemoRecords(),
			runId: RUN_ID,
			scopeRef: SLOT.scopeRef,
		})
	}

	function evidenceOf(
		fake: ReturnType<typeof fakeAgentClients>,
		claimId: string,
	) {
		const page = fake.pages[RISK_SLUG] as
			| {
					claims: Array<{
						id: string
						evidence?: Array<{ kind: string; sourceId: string; note: string }>
					}>
			  }
			| undefined
		return page?.claims.find((claim) => claim.id === claimId)?.evidence
	}

	function renewalKey(): string | undefined {
		return plans().support.events.find(
			(event) => event.sourceId === "src-renewal-05",
		)?.idempotencyKey
	}

	it("lands the incoming page's claim with event evidence resolved from this run's writes", async () => {
		const { clients } = await runComplete()
		const evidence = evidenceOf(clients, "halvorsen-renewal-support-risk")
		expect(evidence).toEqual([
			{
				kind: "event",
				sourceId: expect.any(String),
				note: "body of src-renewal-05",
			},
		])
		const receipt = clients.receipts.find(
			(entry) => entry.input.idempotencyKey === renewalKey(),
		)
		expect(evidence?.[0]?.sourceId).toBe(receipt?.eventId)
	})

	it("ends the run incomplete with the fail-closed reason when a cited source's event never landed", async () => {
		const built = plans()
		const turns = happyTurns(built)
		const supportTurns = [
			{
				toolCalls: writeEventTurns(
					built.support.events.filter(
						(event) => event.sourceId !== "src-renewal-05",
					),
				),
			},
			{
				toolCalls: [
					{ toolName: "mdbrain_wiki_apply", input: { ...built.support.page } },
				],
			},
			{ text: "support done" },
		]
		const { outcome, clients, used, manifests } = await runComplete({
			modelFor: (role) =>
				scriptedModel(role === "support" ? supportTurns : turns[role]!),
		})
		expect(outcome.state).toBe("incomplete")
		expect(outcome.failureReason).toMatch(
			/fail-closed: page risks\/halvorsen-renewal-support-view cites src-renewal-05/,
		)
		expect(clients.pages[RISK_SLUG]).toBeUndefined()
		expect(used).toEqual([])
		const doc = await manifests.get(RUN_ID)
		expect(doc?.state).toBe("ready")
		expect(doc?.agentRun?.state).toBe("incomplete")
	})

	it("cites the first event id when a replay write is retried as an idempotent duplicate", async () => {
		const built = plans()
		const turns = happyTurns(built)
		const renewal = built.support.events.filter(
			(event) => event.sourceId === "src-renewal-05",
		)
		const retryTurns = [
			{
				toolCalls: [
					...writeEventTurns(renewal),
					...writeEventTurns(renewal),
					...writeEventTurns(
						built.support.events.filter(
							(event) => event.sourceId !== "src-renewal-05",
						),
					),
				],
			},
			{
				toolCalls: [
					{ toolName: "mdbrain_wiki_apply", input: { ...built.support.page } },
				],
			},
			{ text: "support done" },
		]
		const { outcome, clients } = await runComplete({
			modelFor: (role) =>
				scriptedModel(role === "support" ? retryTurns : turns[role]!),
		})
		expect(outcome.state).toBe("complete")
		const receipts = clients.receipts.filter(
			(entry) => entry.input.idempotencyKey === renewalKey(),
		)
		expect(receipts).toHaveLength(2)
		expect(receipts[1]?.chunkCreated).toBe(false)
		expect(receipts[1]?.eventId).toBe(receipts[0]?.eventId)
		const evidence = evidenceOf(clients, "halvorsen-renewal-support-risk")
		expect(evidence?.[0]?.sourceId).toBe(receipts[0]?.eventId)
	})
})
