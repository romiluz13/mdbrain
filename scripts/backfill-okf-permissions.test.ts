import { describe, expect, it } from "vitest"

import {
	formatBackfillReport,
	newBackfillReport,
	planPermissionBackfill,
	recordBackfillDecision,
} from "./backfill-okf-permissions.js"

const page = (overrides: Record<string, unknown> = {}) => ({
	slug: "okf-page",
	scope: "workspace",
	scopeRef: "ws-1",
	frontmatter: { privacyTier: "restricted" },
	permissions: {},
	...overrides,
})

describe("planPermissionBackfill", () => {
	it("backfills a page whose frontmatter tier never reached permissions", () => {
		// The exact OKF-import gap: frontmatter.privacyTier set, permissions
		// empty — governance treats this page as open access today.
		expect(
			planPermissionBackfill({
				...page(),
				permissions: {},
			}),
		).toEqual({ action: "backfill", privacyTier: "restricted" })
	})

	it("treats a missing permissions block as backfillable", () => {
		expect(
			planPermissionBackfill({ ...page(), permissions: undefined }),
		).toEqual({ action: "backfill", privacyTier: "restricted" })
	})

	it("skips pages with no frontmatter privacy tier", () => {
		expect(
			planPermissionBackfill({
				...page(),
				frontmatter: {},
			}),
		).toEqual({ action: "skip", reason: "no-frontmatter-tier" })
	})

	it("skips pages whose frontmatter tier is not a valid enum value", () => {
		// Never write an unknown tier into permissions — that would either
		// fail $jsonSchema validation or silently widen access.
		expect(
			planPermissionBackfill({
				...page(),
				frontmatter: { privacyTier: "top-secret" },
			}),
		).toEqual({ action: "skip", reason: "invalid-frontmatter-tier" })
	})

	it("skips pages where permissions already agrees with frontmatter", () => {
		expect(
			planPermissionBackfill({
				...page(),
				permissions: { privacyTier: "restricted" },
			}),
		).toEqual({ action: "skip", reason: "tier-already-mapped" })
	})

	it("never clobbers curated ACL entries", () => {
		// permissions is the SSOT (D2): allowedSubjects etc. must survive a
		// backfill even when privacyTier is absent from permissions.
		expect(
			planPermissionBackfill({
				...page(),
				permissions: { allowedSubjects: ["team-a"] },
			}),
		).toEqual({ action: "skip", reason: "permissions-already-set" })
	})

	it("reports a tier mismatch as a conflict instead of overwriting", () => {
		expect(
			planPermissionBackfill({
				...page(),
				permissions: { privacyTier: "standard" },
			}),
		).toEqual({
			action: "conflict",
			reason: "tier-mismatch",
			frontmatterTier: "restricted",
			permissionsTier: "standard",
		})
	})
})

describe("backfill report", () => {
	it("records decisions into counters and entries", () => {
		const report = newBackfillReport()
		recordBackfillDecision(report, "a", planPermissionBackfill(page()), true)
		recordBackfillDecision(
			report,
			"b",
			planPermissionBackfill({ ...page(), frontmatter: {} }),
			false,
		)
		recordBackfillDecision(
			report,
			"c",
			planPermissionBackfill({
				...page(),
				permissions: { privacyTier: "standard" },
			}),
			false,
		)

		expect(report).toMatchObject({
			scanned: 3,
			backfilled: 1,
			skipped: 1,
			conflicts: 1,
			skippedByReason: { "no-frontmatter-tier": 1 },
		})
		expect(report.entries).toHaveLength(3)
	})

	it("distinguishes applied from would-apply in dry-run output", () => {
		const applied = newBackfillReport()
		recordBackfillDecision(applied, "a", planPermissionBackfill(page()), true)
		const dryRun = newBackfillReport()
		recordBackfillDecision(dryRun, "a", planPermissionBackfill(page()), false)

		expect(formatBackfillReport(applied, "apply")).toContain(
			"backfilled a → permissions.privacyTier=restricted",
		)
		expect(formatBackfillReport(dryRun, "dry-run")).toContain(
			"would backfill a → permissions.privacyTier=restricted",
		)
	})

	it("surfaces conflicts with both tiers in the report", () => {
		const report = newBackfillReport()
		recordBackfillDecision(
			report,
			"conflicted",
			planPermissionBackfill({
				...page(),
				permissions: { privacyTier: "standard" },
			}),
			false,
		)

		const text = formatBackfillReport(report, "dry-run")
		expect(text).toContain("CONFLICT conflicted")
		expect(text).toContain("frontmatter=restricted")
		expect(text).toContain("permissions=standard")
		expect(text).toContain("permissions is authoritative")
	})
})
