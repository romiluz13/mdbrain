import type { Db } from "mongodb"
import { createSubsystemLogger } from "@mdbrain/lib"
import { telemetryCollection } from "./mongodb-schema.js"

const log = createSubsystemLogger("memory:mongodb:telemetry")

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TelemetryOperation =
	| "search"
	| "event-write"
	| "projection-run"
	| "cache-check"
	| "graph-expansion"
	| "profile-synthesis"
	| "active-slate-hydration"
	| "context-bundle"
	| "rerank"
	| "query-rewrite"
	| "entity-extraction"

export type TelemetryMeta = {
	agentId: string
	operation: TelemetryOperation
}

export type TelemetryDocument = {
	ts: Date
	meta: TelemetryMeta
	durationMs: number
	ok: boolean
	pathUsed?: string
	resultCount?: number
	topScore?: number
	fusionMethod?: string
	cacheHit?: boolean
	latencySavedMs?: number
	itemCount?: number
	eventType?: string
	projectionTriggered?: boolean
	rerankModel?: string
	rerankLatencyMs?: number
	queryRewritten?: boolean
	rewriteMethod?: string
	extractionMethod?: string
	entitiesExtracted?: number
}

// ---------------------------------------------------------------------------
// Emit (batched, fire-and-forget, non-blocking) — H4 (#29)
// ---------------------------------------------------------------------------

/**
 * H4 (#29): In-memory buffer of telemetry documents awaiting flush. Kept at
 * module scope so all callers share one batch. Flushed by `flushTelemetry`
 * (called automatically on a timer, or manually on shutdown).
 */
const telemetryBuffer: TelemetryDocument[] = []

/** H4 (#29): Most recent db/prefix seen by emitTelemetry, used by the auto-timer. */
let pendingFlush: { db: Db; prefix: string } | null = null

let flushInterval: NodeJS.Timeout | null = null
const FLUSH_INTERVAL_MS = 5_000

/** H4 (#29): Start the auto-flush timer (idempotent, unref'd). */
function ensureFlushTimer(): void {
	if (flushInterval) {
		return
	}
	flushInterval = setInterval(() => {
		void flushPending()
	}, FLUSH_INTERVAL_MS)
	// Don't keep the event loop alive solely for telemetry flushing.
	flushInterval.unref?.()
}

/** H4 (#29): Auto-timer callback — flushes to the last-seen db/prefix. */
async function flushPending(): Promise<void> {
	if (!pendingFlush) {
		return
	}
	await flushTelemetry(pendingFlush.db, pendingFlush.prefix)
}

/**
 * H4 (#29): Flush the buffer to the telemetry collection via `insertMany`
 * (ordered:false so one bad doc doesn't abort the batch). On failure the
 * events are returned to the buffer for the next flush (data is not lost).
 * No-op when the buffer is empty.
 */
export async function flushTelemetry(db: Db, prefix: string): Promise<void> {
	if (telemetryBuffer.length === 0) {
		return
	}
	// Take the whole batch out so concurrent emits append to a fresh buffer.
	const batch = telemetryBuffer.splice(0, telemetryBuffer.length)
	try {
		await telemetryCollection(db, prefix).insertMany(batch, {
			ordered: false,
		})
	} catch (err) {
		log.warn("telemetry flush failed; retaining events for next flush", {
			count: batch.length,
			error: err instanceof Error ? err.message : String(err),
		})
		// Put the failed batch back at the front; new events stay after it.
		telemetryBuffer.unshift(...batch)
	}
}

/**
 * H4 (#29): Test/reset hook — clears the in-memory buffer and stops the
 * auto-flush timer. Not intended for production callers.
 */
export function resetTelemetry(): void {
	telemetryBuffer.length = 0
	pendingFlush = null
	if (flushInterval) {
		clearInterval(flushInterval)
		flushInterval = null
	}
}

/**
 * Emit a telemetry document to the memory_telemetry time series collection.
 * H4 (#29): Now batched — pushes to an in-memory buffer flushed periodically
 * (every 5s) or via `flushTelemetry`. Never blocks the caller, never throws.
 */
export function emitTelemetry(
	db: Db,
	prefix: string,
	doc: Omit<TelemetryDocument, "ts">,
): void {
	const entry: TelemetryDocument = { ...doc, ts: new Date() }
	telemetryBuffer.push(entry)
	pendingFlush = { db, prefix }
	ensureFlushTimer()
}

// ---------------------------------------------------------------------------
// Aggregation helpers (dashboard metrics)
// ---------------------------------------------------------------------------

/** Get P50/P95/P99 latency stats for a given operation over a time window. */
export async function getLatencyStats(params: {
	db: Db
	prefix: string
	agentId: string
	operation?: TelemetryOperation
	windowMs?: number
}): Promise<{ p50: number; p95: number; p99: number; count: number }> {
	const { db, prefix, agentId, operation, windowMs = 3600000 } = params
	const since = new Date(Date.now() - windowMs)
	const matchStage: Record<string, unknown> = {
		"meta.agentId": agentId,
		ts: { $gte: since },
	}
	if (operation) {
		matchStage["meta.operation"] = operation
	}

	// M4 audit fix: use server-side $percentile instead of $push + client-side calculation.
	// $percentile is GA since MongoDB 7.0, available in atlas-local:preview.
	const pipeline = [
		{ $match: matchStage },
		{
			$group: {
				_id: null,
				count: { $sum: 1 },
				p50: {
					$percentile: {
						input: "$durationMs",
						p: [0.5],
						method: "approximate",
					},
				},
				p95: {
					$percentile: {
						input: "$durationMs",
						p: [0.95],
						method: "approximate",
					},
				},
				p99: {
					$percentile: {
						input: "$durationMs",
						p: [0.99],
						method: "approximate",
					},
				},
			},
		},
	]

	const results = await telemetryCollection(db, prefix)
		.aggregate(pipeline)
		.toArray()
	if (results.length === 0 || results[0].count === 0) {
		return { p50: 0, p95: 0, p99: 0, count: 0 }
	}

	return {
		p50: results[0].p50?.[0] ?? 0,
		p95: results[0].p95?.[0] ?? 0,
		p99: results[0].p99?.[0] ?? 0,
		count: results[0].count,
	}
}

/** Get cache hit rate over a time window. */
export async function getCacheHitRate(params: {
	db: Db
	prefix: string
	agentId: string
	windowMs?: number
}): Promise<{ hitRate: number; hits: number; misses: number; total: number }> {
	const { db, prefix, agentId, windowMs = 3600000 } = params
	const since = new Date(Date.now() - windowMs)

	const pipeline = [
		{
			$match: {
				"meta.agentId": agentId,
				"meta.operation": "cache-check",
				ts: { $gte: since },
			},
		},
		{
			$group: {
				_id: "$cacheHit",
				count: { $sum: 1 },
			},
		},
	]

	const results = await telemetryCollection(db, prefix)
		.aggregate(pipeline)
		.toArray()
	let hits = 0
	let misses = 0
	for (const r of results) {
		if (r._id === true) {
			hits = r.count as number
		} else {
			misses += r.count as number
		}
	}
	const total = hits + misses
	return { hitRate: total > 0 ? hits / total : 0, hits, misses, total }
}

/** Get operation distribution over a time window. */
export async function getOperationDistribution(params: {
	db: Db
	prefix: string
	agentId: string
	windowMs?: number
}): Promise<
	Array<{ operation: TelemetryOperation; count: number; avgDurationMs: number }>
> {
	const { db, prefix, agentId, windowMs = 3600000 } = params
	const since = new Date(Date.now() - windowMs)

	const pipeline = [
		{
			$match: {
				"meta.agentId": agentId,
				ts: { $gte: since },
			},
		},
		{
			$group: {
				_id: "$meta.operation",
				count: { $sum: 1 },
				avgDurationMs: { $avg: "$durationMs" },
			},
		},
		{ $sort: { count: -1 } },
	]

	const results = await telemetryCollection(db, prefix)
		.aggregate(pipeline)
		.toArray()
	return results.map((r) => ({
		operation: r._id as TelemetryOperation,
		count: r.count as number,
		avgDurationMs: Math.round(r.avgDurationMs as number),
	}))
}
