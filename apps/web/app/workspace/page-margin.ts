import type { MdbrainWikiPageView } from "@mdbrain/client"
import type { MarginRow } from "./ledger.js"
import {
	asNumber,
	asRecord,
	asStringList,
	formatBytes,
	formatInstant,
	formatNumber,
	isEmptyValue,
} from "./values.js"

/** Margin rows for a wiki page record. `provenance`, `sourceEventIds` and
 *  `sourceReliability` are returned by the API but are not in the SDK type, so
 *  they are read from the record without assuming their shape. */
export function pageMarginRows(page: Record<string, unknown>): MarginRow[] {
	const view = page as Partial<MdbrainWikiPageView>
	const provenance = asRecord(page.provenance)
	const sourceEventIds = asStringList(page.sourceEventIds)
	return [
		{ label: "id", value: view._id },
		{ label: "slug", value: view.slug, essential: true },
		{ label: "kind", value: view.kind },
		{ label: "state", value: view.state, essential: true },
		{ label: "revision", value: formatNumber(view.revision), essential: true },
		{
			label: "scope",
			value: view.scope
				? `${view.scope}/${view.scopeRef ?? "(ref not reported)"}`
				: undefined,
			essential: true,
		},
		{ label: "trust tier", value: view.trustTier },
		{ label: "freshness", value: view.freshness },
		{ label: "created", value: formatInstant(view.createdAt) },
		{ label: "updated", value: formatInstant(view.updatedAt), essential: true },
		{ label: "valid from", value: formatInstant(view.validFrom ?? undefined) },
		{ label: "valid to", value: formatInstant(view.validTo) },
		{
			label: "source events",
			value: sourceEventIds?.join(", "),
		},
		{
			label: "source reliability",
			value: formatNumber(asNumber(page.sourceReliability)),
		},
		{
			label: "provenance",
			value: isEmptyValue(provenance) ? undefined : JSON.stringify(provenance),
		},
		{
			label: "body size",
			value: typeof view.body === "string" ? formatBytes(view.body) : undefined,
		},
	]
}
