import type { CreateRunManifestInput } from "./manifest.js"
import type { LoadPlan, PlannedPage } from "./plan.js"
import { isDuplicateSlug, withRetries, type RetryOptions } from "./retries.js"

/** Token-bucket gate shared by every API call the seeder makes. The live
 * runner wires a real pacer at ~90 starts/minute; tests inject a counter. */
export type Pacer = { take(): Promise<void> }

export type SeedRequestOptions = { timeoutMs?: number; signal?: AbortSignal }

/** Narrow structural port of the client surface the seeder uses. The real
 * MdbrainClient satisfies it; tests use FakeSeedClient. */
/** The exact writeEvent input the HTTP client accepts, mirrored so the
 * real MdbrainClient satisfies SeedClient structurally. */
export type SeedWriteEventInput = {
	role: "user" | "assistant" | "system" | "tool"
	body: string
	idempotencyKey: string
	requestId?: string
	agentId?: string
	sessionId?: string
	timestamp?: string
	metadata?: Record<string, string | number | boolean | null>
	scope?: "session" | "user" | "agent" | "workspace" | "tenant" | "global"
	scopeRef?: string
	promotionPolicy?: "none" | "wiki"
	wikiPromotion?: unknown
}

export interface SeedClient {
	writeEvent(
		input: SeedWriteEventInput,
		requestOptions?: SeedRequestOptions,
	): Promise<{ ok: true; eventId: string; chunkCreated: boolean }>
	wikiCreate(
		input: {
			kind: string
			title: string
			slug: string
			summary: string
			body: string
			frontmatter: { type: string } & Record<string, unknown>
			scope: string
			scopeRef: string
			trustTier: string
			claims?: {
				id: string
				text: string
				confidence?: number
				evidence?: { kind: "event"; sourceId: string; note: string }[]
			}[]
			relationships?: {
				targetPageSlug: string
				targetTitle: string
				kind: string
			}[]
			agentId?: string
		},
		requestOptions?: SeedRequestOptions,
	): Promise<{ slug: string; revision?: number }>
	wikiGet(
		input: { slug: string; scope: string; scopeRef: string; format?: "json" },
		requestOptions?: SeedRequestOptions,
	): Promise<{ slug: string; revision?: number }>
}

/** Resume ledger: the run manifest read back through the same port the
 * manifest store implements. */
/** Resume snapshot the engine reads back from the ledger. */
export type SeedLedgerSnapshot = {
	eventsWritten: { sourceId: string; eventId: string }[]
	pagesWritten: string[]
}

export interface SeedLedger {
	/** Creates the manifest for this run; returns null when it already
	 * exists (a resume). */
	createRun(input: CreateRunManifestInput): Promise<SeedLedgerSnapshot | null>
	get(runId: string): Promise<SeedLedgerSnapshot | null>
	recordEvent(
		runId: string,
		sourceId: string,
		eventId: string,
	): Promise<unknown>
	recordPage(runId: string, slug: string): Promise<unknown>
	/** Rewrites the event references in deterministic plan order once the
	 * concurrent event phase settles. */
	orderEvents(
		runId: string,
		refs: { sourceId: string; eventId: string }[],
	): Promise<unknown>
}

export type SeedSlotOptions = {
	client: SeedClient
	ledger: SeedLedger
	runId: string
	agentId: string
	scopeRef: string
	/** Manifest identity/boundaries recorded when the engine starts (or
	 * re-attached on resume). */
	manifestInit: Omit<CreateRunManifestInput, "runId" | "scopeRef" | "agentId">
	/** Default "workspace" — the whole demo corpus lives in one workspace
	 * slot per run. */
	scope?: "session" | "user" | "agent" | "workspace" | "tenant" | "global"
	/** Default "standard", matching the scoped-key principal tier. */
	trustTier?: string
	pacer?: Pacer
	sleep?: (ms: number) => Promise<void>
	/** Default 5 retries for 429/503/retryable envelopes. */
	maxRetries?: number
	/** Default 1000ms backoff when the envelope carries no retryAfterMs. */
	retryDelayMs?: number
	/** Per-request deadline passed to the client (the brief's 180s). */
	requestTimeoutMs?: number
	/** Upper bound on writeEvent calls in flight (default 1, sequential). */
	concurrency?: number
}

export type SeedSlotSummary = {
	eventsWritten: number
	eventsReplayed: number
	pagesWritten: number
	pagesReconciled: number
	eventIdBySourceId: Record<string, string>
}

/** Seeds one run slot from a deterministic plan, strictly in order: every
 * event first (business timestamps, stable idempotency keys), then every
 * page with its claim evidence mapped to the event ids the API returned.
 *
 * Resumability: writes already recorded in the manifest are skipped; an
 * event whose ledger row was lost replays under the same idempotency key
 * (the server dedupes); a page whose ledger row was lost reconciles a 409
 * DUPLICATE_SLUG via wikiGet. Anything else fails closed and leaves the
 * ledger consistent for a later resume. */
export async function seedSlot(
	plan: LoadPlan,
	options: SeedSlotOptions,
): Promise<SeedSlotSummary> {
	const scope = options.scope ?? "workspace"
	const trustTier = options.trustTier ?? "standard"
	const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1))
	const pacer = options.pacer ?? { async take() {} }
	const sleep =
		options.sleep ??
		((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
	const retry: RetryOptions = {
		pacer,
		sleep,
		maxRetries: options.maxRetries ?? 5,
		retryDelayMs: options.retryDelayMs ?? 1000,
	}
	const requestOptions =
		options.requestTimeoutMs === undefined
			? undefined
			: { timeoutMs: options.requestTimeoutMs }

	const created = await options.ledger.createRun({
		...options.manifestInit,
		runId: options.runId,
		scopeRef: options.scopeRef,
		agentId: options.agentId,
	})
	const prior = created ?? (await options.ledger.get(options.runId))
	const eventIdBySourceId = new Map<string, string>()
	const donePages = new Set<string>()
	if (prior) {
		for (const ref of prior.eventsWritten) {
			eventIdBySourceId.set(ref.sourceId, ref.eventId)
		}
		for (const slug of prior.pagesWritten) donePages.add(slug)
	}

	let eventsWritten = 0
	let eventsReplayed = 0
	// Bounded concurrency over independent events: every worker paces each
	// attempt through the same pacer, so starts stay under the rate limit.
	const queue = plan.events.filter(
		(event) => !eventIdBySourceId.has(event.sourceId),
	)
	const workers = Array.from(
		{ length: Math.max(1, Math.min(concurrency, queue.length)) },
		async () => {
			for (;;) {
				const event = queue.shift()
				if (!event) return
				const result = await withRetries(
					() =>
						options.client.writeEvent(
							{
								role: event.role,
								body: event.body,
								idempotencyKey: event.idempotencyKey,
								agentId: options.agentId,
								timestamp: event.timestamp,
								metadata: event.metadata,
								scope,
								scopeRef: options.scopeRef,
							},
							requestOptions,
						),
					retry,
				)
				if (result.chunkCreated) eventsWritten++
				else eventsReplayed++
				eventIdBySourceId.set(event.sourceId, result.eventId)
				await options.ledger.recordEvent(
					options.runId,
					event.sourceId,
					result.eventId,
				)
			}
		},
	)
	await Promise.all(workers)
	// The ledger log landed in completion order; rewrite it in plan order so
	// the manifest's event references are deterministic across slots.
	await options.ledger.orderEvents(
		options.runId,
		plan.events.flatMap((event) => {
			const eventId = eventIdBySourceId.get(event.sourceId)
			return eventId ? [{ sourceId: event.sourceId, eventId }] : []
		}),
	)

	let pagesWritten = 0
	let pagesReconciled = 0
	for (const page of plan.pages) {
		if (donePages.has(page.slug)) continue
		const outcome = await writePage(page)
		if (outcome === "created") pagesWritten++
		else pagesReconciled++
		await options.ledger.recordPage(options.runId, page.slug)
		donePages.add(page.slug)
	}

	return {
		eventsWritten,
		eventsReplayed,
		pagesWritten,
		pagesReconciled,
		eventIdBySourceId: Object.fromEntries(eventIdBySourceId),
	}

	async function writePage(
		page: PlannedPage,
	): Promise<"created" | "reconciled"> {
		const input = {
			kind: page.kind,
			title: page.title,
			slug: page.slug,
			summary: page.summary,
			body: page.body,
			frontmatter: page.frontmatter,
			scope,
			scopeRef: options.scopeRef,
			trustTier,
			agentId: options.agentId,
			claims: page.claims.map((claim) => ({
				id: claim.id,
				text: claim.text,
				confidence: claim.confidence,
				evidence: claim.evidence.map((ev) => {
					const eventId = eventIdBySourceId.get(ev.sourceId)
					if (!eventId) {
						throw new Error(
							`fail-closed: page ${page.slug} cites ${ev.sourceId}, which has no written event (held back for replay or missing from the plan)`,
						)
					}
					return { kind: "event" as const, sourceId: eventId, note: ev.note }
				}),
			})),
			relationships: page.relationships,
		}
		try {
			await withRetries(
				() => options.client.wikiCreate(input, requestOptions),
				retry,
			)
			return "created"
		} catch (error) {
			if (isDuplicateSlug(error)) {
				const existing = await withRetries(
					() =>
						options.client.wikiGet(
							{
								slug: page.slug,
								scope,
								scopeRef: options.scopeRef,
								format: "json",
							},
							requestOptions,
						),
					retry,
				)
				if (!existing || existing.slug !== page.slug) {
					throw new Error(
						`reconcile failed: 409 for ${page.slug} but wikiGet returned ${existing?.slug ?? "nothing"}`,
					)
				}
				return "reconciled"
			}
			throw error
		}
	}
}
