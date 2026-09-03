// scripts/backfill-okf-permissions.ts — CH-001 WS-2 migration.
//
// Usage:
//   bun run scripts/backfill-okf-permissions.ts             # dry-run + report
//   bun run scripts/backfill-okf-permissions.ts --apply     # write + report
//
// Backfills permissions.privacyTier from frontmatter.privacyTier for wiki
// pages whose OKF import predates the frontmatter→permissions mapping.
// Governance (filterPagesByGovernance / buildPermissionsFilter in
// packages/wiki-engine/src/wiki-governance.ts) reads ONLY page.permissions,
// so pages imported with a frontmatter-only privacy tier are open access
// despite their declared tier. permissions.privacyTier is the SSOT (D2);
// pages that already carry a permissions block are never overwritten —
// they are reported instead.

import { MongoClient } from "mongodb"
import { pathToFileURL } from "node:url"
import {
	resolveWikiStoreConfig,
	WIKI_PRIVACY_TIER_VALUES,
	wikiPagesCollection,
} from "@mdbrain/wiki-engine"

// ---------------------------------------------------------------------------
// Pure planning logic (unit-tested in backfill-okf-permissions.test.ts)
// ---------------------------------------------------------------------------

export type PrivacyTierValue = (typeof WIKI_PRIVACY_TIER_VALUES)[number]

export type BackfillDecision =
	| { action: "backfill"; privacyTier: PrivacyTierValue }
	| {
			action: "skip"
			reason:
				| "no-frontmatter-tier"
				| "invalid-frontmatter-tier"
				| "tier-already-mapped"
				| "permissions-already-set"
	  }
	| {
			action: "conflict"
			reason: "tier-mismatch"
			frontmatterTier: string
			permissionsTier: string
	  }

interface BackfillPageShape {
	slug?: unknown
	scope?: unknown
	scopeRef?: unknown
	frontmatter?: { privacyTier?: unknown } | null
	permissions?: {
		privacyTier?: unknown
		allowedSubjects?: unknown
		allowedGroups?: unknown
		allowedRoles?: unknown
		allowedDepartments?: unknown
	} | null
}

const PERMISSION_ACCESS_FIELDS = [
	"allowedSubjects",
	"allowedGroups",
	"allowedRoles",
	"allowedDepartments",
] as const

function isPrivacyTierValue(value: unknown): value is PrivacyTierValue {
	return (
		typeof value === "string" &&
		WIKI_PRIVACY_TIER_VALUES.includes(value as PrivacyTierValue)
	)
}

/** Classifies one wiki page for the backfill. Never mutates: the caller
 *  decides whether to apply the plan. */
export function planPermissionBackfill(
	page: BackfillPageShape,
): BackfillDecision {
	const fmTier = page.frontmatter?.privacyTier
	if (typeof fmTier !== "string" || !fmTier.trim()) {
		return { action: "skip", reason: "no-frontmatter-tier" }
	}
	if (!isPrivacyTierValue(fmTier)) {
		return { action: "skip", reason: "invalid-frontmatter-tier" }
	}
	const perms = page.permissions
	const permsTier = perms?.privacyTier
	if (permsTier === fmTier) {
		return { action: "skip", reason: "tier-already-mapped" }
	}
	if (
		perms &&
		PERMISSION_ACCESS_FIELDS.some(
			(field) =>
				Array.isArray(perms[field]) && (perms[field] as unknown[]).length > 0,
		)
	) {
		// Curated ACL entries exist — permissions is the SSOT (D2), so the
		// frontmatter tier must not clobber them. Report, don't write.
		return { action: "skip", reason: "permissions-already-set" }
	}
	if (permsTier !== undefined && permsTier !== null) {
		// permissions.privacyTier disagrees with frontmatter.privacyTier.
		// permissions is authoritative — surface the mismatch, don't overwrite.
		return {
			action: "conflict",
			reason: "tier-mismatch",
			frontmatterTier: fmTier,
			permissionsTier: String(permsTier),
		}
	}
	return { action: "backfill", privacyTier: fmTier }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface BackfillReport {
	scanned: number
	backfilled: number
	skipped: number
	conflicts: number
	skippedByReason: Record<string, number>
	entries: Array<{
		slug: string
		decision: BackfillDecision
		applied: boolean
	}>
}

export function newBackfillReport(): BackfillReport {
	return {
		scanned: 0,
		backfilled: 0,
		skipped: 0,
		conflicts: 0,
		skippedByReason: {},
		entries: [],
	}
}

export function recordBackfillDecision(
	report: BackfillReport,
	slug: string,
	decision: BackfillDecision,
	applied: boolean,
): void {
	report.scanned++
	if (decision.action === "backfill") {
		if (applied) report.backfilled++
	} else if (decision.action === "skip") {
		report.skipped++
		report.skippedByReason[decision.reason] =
			(report.skippedByReason[decision.reason] ?? 0) + 1
	} else {
		report.conflicts++
	}
	report.entries.push({ slug, decision, applied })
}

export function formatBackfillReport(
	report: BackfillReport,
	mode: "dry-run" | "apply",
): string {
	const lines = [
		`OKF permissions backfill (${mode})`,
		`  scanned:    ${report.scanned}`,
		`  backfilled: ${report.backfilled}`,
		`  skipped:    ${report.skipped}`,
		`  conflicts:  ${report.conflicts}`,
	]
	for (const [reason, count] of Object.entries(report.skippedByReason)) {
		lines.push(`    skip:${reason}: ${count}`)
	}
	for (const entry of report.entries) {
		if (entry.decision.action === "backfill") {
			lines.push(
				`  ${entry.applied ? "backfilled" : "would backfill"} ${entry.slug} → permissions.privacyTier=${entry.decision.privacyTier}`,
			)
		} else if (entry.decision.action === "conflict") {
			lines.push(
				`  CONFLICT ${entry.slug}: frontmatter=${entry.decision.frontmatterTier} permissions=${entry.decision.permissionsTier} (permissions is authoritative — resolve manually)`,
			)
		} else if (entry.decision.reason !== "no-frontmatter-tier") {
			lines.push(`  skipped ${entry.slug}: ${entry.decision.reason}`)
		}
	}
	return lines.join("\n")
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<void> {
	const apply = argv.includes("--apply")
	const config = resolveWikiStoreConfig()
	const client = new MongoClient(config.uri, config.clientOptions ?? {})
	try {
		await client.connect()
		const db = client.db(config.databaseName)
		const coll = wikiPagesCollection(db, config.collectionPrefix)
		const report = newBackfillReport()
		// Only pages with a frontmatter privacy tier are candidates; the
		// decision function re-validates the value.
		const cursor = coll.find(
			{ "frontmatter.privacyTier": { $type: "string" } },
			{
				projection: {
					slug: 1,
					scope: 1,
					scopeRef: 1,
					frontmatter: 1,
					permissions: 1,
				},
			},
		)
		for await (const page of cursor) {
			const doc = page as unknown as BackfillPageShape
			const decision = planPermissionBackfill(doc)
			const slug = typeof doc.slug === "string" ? doc.slug : "<missing-slug>"
			const scope = typeof doc.scope === "string" ? doc.scope : undefined
			const scopeRef =
				typeof doc.scopeRef === "string" ? doc.scopeRef : undefined
			// Pages are keyed by slug+scope+scopeRef — a bare slug can collide
			// across scopes, so the update targets the full key.
			const pageKey = scope && scopeRef ? { slug, scope, scopeRef } : { slug }
			let applied = false
			if (
				apply &&
				decision.action === "backfill" &&
				slug !== "<missing-slug>"
			) {
				const result = await coll.updateOne(pageKey, {
					$set: { "permissions.privacyTier": decision.privacyTier },
				})
				applied = result.acknowledged && result.modifiedCount === 1
			}
			recordBackfillDecision(report, slug, decision, applied)
		}
		console.log(formatBackfillReport(report, apply ? "apply" : "dry-run"))
		if (!apply && report.backfilled > 0) {
			console.log(
				`\n${report.backfilled} page(s) would be backfilled. Re-run with --apply to write.`,
			)
		}
	} finally {
		await client.close()
	}
}

// Runtime-agnostic CLI entry check: matches whether this module is the
// process entry (works under both node+tsx and bun).
const isCliMain =
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href

if (isCliMain) {
	main(process.argv.slice(2)).catch((err) => {
		console.error(err instanceof Error ? err.message : String(err))
		process.exit(1)
	})
}
