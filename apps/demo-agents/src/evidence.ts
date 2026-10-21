/** Evidence planning and resolution shared by the seeder and the agent
 * roles (330): both build claim evidence the same way — a verbatim excerpt
 * of the rendered source body containing the claim's anchor, later swapped
 * for the Memongo event id the source's write returned. */
import type { RenderedRecord } from "./corpus/types.js"
import { chooseExcerpt } from "./seeding/excerpt.js"

/** Evidence ref a claim spec names: the corpus source and the anchor the
 * note must contain. */
export type EvidenceRef = { sourceId: string; anchor?: string }

/** Plan-time note for one evidence ref — the seeder's builder. Fails closed
 * when the corpus has no rendered record for the cited source. */
export function planEvidenceNote(
	ref: EvidenceRef,
	records: Map<string, RenderedRecord>,
): { sourceId: string; note: string } {
	const record = records.get(ref.sourceId)
	if (!record) {
		throw new Error(
			`corpus is incomplete: no rendered record for evidence source ${ref.sourceId}`,
		)
	}
	return {
		sourceId: ref.sourceId,
		note: chooseExcerpt(record.body, ref.anchor ?? ""),
	}
}

/** The run's shared write ledger: event ids captured from this run's
 * mdbrain_write_event receipts, plus the refusals that must fail it. */
export type RunWrites = {
	eventIdBySource: Map<string, string>
	refusals: string[]
	/** Pinned writes the API refused, by source id; a successful retry of
	 * the same source clears its entry. */
	writeRefusals: Map<string, string>
}

/** Resolves plan-time notes against the ledger: each corpus source id
 * becomes the event id its write returned, exactly the swap the seeder
 * performs. Fail-closed: a cited source with no written event comes back
 * as a refusal — never silently dropped, never an unsourced claim. */
export function resolveEventEvidence(input: {
	notes: Array<{ sourceId: string; note?: string }>
	eventIdBySource: Map<string, string>
	missing: (sourceId: string) => string
}):
	| Array<{ kind: "event"; sourceId: string; note?: string }>
	| { refusal: string } {
	const evidence: Array<{ kind: "event"; sourceId: string; note?: string }> = []
	for (const note of input.notes) {
		const eventId = input.eventIdBySource.get(note.sourceId)
		if (eventId === undefined) {
			return { refusal: input.missing(note.sourceId) }
		}
		evidence.push({ kind: "event", sourceId: eventId, note: note.note })
	}
	return evidence
}
