// @mdbrain/wiki-engine — governance for the changes feed.
//
// A revision is authorized against its OWN snapshot (scope, scopeRef,
// permissions as they were when it was written), the way the revision routes
// do, never against the page's current state.
//
// Two forms, one authority. The database filter is the page permissions filter
// moved onto `snapshot.` so most hidden revisions are never fetched; the
// in-memory check is the authority and drops anything the filter let through
// (the query form reads a permissions object holding only unknown keys as open,
// the in-memory form as closed).

import type { Document } from "mongodb"
import {
	type GovernanceContext,
	buildPermissionsFilter,
	filterPagesByGovernance,
} from "./wiki-governance.js"

function onSnapshot(filter: Document): Document {
	const moved: Document = {}
	for (const [key, value] of Object.entries(filter)) {
		if (key.startsWith("$")) {
			moved[key] = Array.isArray(value)
				? value.map((part) => onSnapshot(part as Document))
				: value
		} else {
			moved[`snapshot.${key}`] = value
		}
	}
	return moved
}

/** {} when the caller is an admin, which reads every revision of its scope. */
export function revisionPermissionsFilter(ctx: GovernanceContext): Document {
	return onSnapshot(buildPermissionsFilter(ctx))
}

export function canReadRevision(
	doc: Document,
	ctx: GovernanceContext,
): boolean {
	return (
		filterPagesByGovernance([(doc.snapshot ?? {}) as Document], ctx).length > 0
	)
}
