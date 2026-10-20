// The fake collection evaluates the engine's real governance filter. These
// cases pin it to the in-memory filter the engine also ships, so the two cannot
// drift apart unnoticed and make the overview tests pass for the wrong reason.

import type { Document } from "mongodb"
import { describe, expect, it } from "vitest"
import {
	buildGovernanceFilter,
	filterPagesByGovernance,
	type GovernanceContext,
} from "../wiki-governance.js"
import { matches } from "./fake-wiki-db.js"
import { HIDDEN, admin, exec, outsider, page } from "./overview-fixtures.js"

describe("the fake collection agrees with the engine's own governance", () => {
	const cases: Array<
		[string, Document | undefined, GovernanceContext, boolean]
	> = [
		["no permissions block", undefined, outsider, true],
		["an empty permissions block", {}, outsider, true],
		["a public page", { privacyTier: "public" }, outsider, true],
		["an internal page", { privacyTier: "internal" }, outsider, true],
		["a restricted page, outsider", HIDDEN, outsider, false],
		["a restricted page, matching role", HIDDEN, exec, true],
		["a restricted page, admin", HIDDEN, admin, true],
		[
			"a department page, matching department",
			{ privacyTier: "confidential", allowedDepartments: ["fin"] },
			{ ...outsider, departments: ["fin"] },
			true,
		],
		[
			"a department page, other department",
			{ privacyTier: "confidential", allowedDepartments: ["fin"] },
			{ ...outsider, departments: ["eng"] },
			false,
		],
		[
			"a subject page, matching subject",
			{ privacyTier: "restricted", allowedSubjects: ["u1"] },
			{ ...outsider, subjectId: "u1" },
			true,
		],
		[
			"a group page, matching group",
			{ privacyTier: "restricted", allowedGroups: ["g:ops"] },
			{ ...outsider, groups: ["g:ops"] },
			true,
		],
		[
			"a group page, no groups",
			{ privacyTier: "restricted", allowedGroups: ["g:ops"] },
			outsider,
			false,
		],
	]

	it.each(cases)("%s", (_name, permissions, ctx, readable) => {
		const doc = page("p", permissions ? { permissions } : {})

		expect(matches(doc, buildGovernanceFilter(ctx))).toBe(readable)
		expect(filterPagesByGovernance([doc], ctx).length > 0).toBe(readable)
	})

	it("treats another scopeRef as unreadable in both", () => {
		const doc = page("p", { scopeRef: "ws-2" })

		expect(matches(doc, buildGovernanceFilter(outsider))).toBe(false)
		expect(filterPagesByGovernance([doc], outsider)).toHaveLength(0)
	})
})
