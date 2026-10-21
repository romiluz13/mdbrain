// The one place that decides how an event the run wrote is confirmed. Every
// arrival and every agent step on the screen is confirmed through
// `confirmEvent`, so a different way to confirm (a governed read by event id,
// once the API serves one) is a change to this function alone.
//
// Today the API confirms an event only through a stored claim that cites it,
// so an arrival no claim cites cannot be confirmed here and says so. A step is
// confirmed through governed recall by the server (the proxy's step read).

import type { MdbrainWikiClaim } from "@mdbrain/client"
import type { DemoDataUpstream } from "./loaders.js"
import type { SourceRef } from "./loaders-chapters.js"
import { readsFor } from "./reads.js"
import type { SourceReader } from "./source-reader.js"

export type EventSubject =
	| {
			kind: "arrival"
			eventId: string
			/** The stored claim that cites the event, which a cite goes through. */
			via?: { claim: MdbrainWikiClaim; ref: SourceRef }
	  }
	| { kind: "step"; n: number }

export type EventConfirmation =
	| { status: "confirmed"; text?: string; businessTime?: string }
	/** Asked, and the API did not confirm it. */
	| { status: "unconfirmed" }
	/** There is no way to ask yet: no stored claim cites the event. */
	| { status: "not-confirmable" }
	/** The read failed. It may work on the next try. */
	| { status: "unavailable" }

export interface ConfirmDeps {
	upstream: DemoDataUpstream
	/** Arrivals are cited through the same reader the citation dialog uses, so
	 * an event read once is not read again. */
	sources: SourceReader
}

/** Identifies a subject; not the claim an arrival is asked through. */
export const subjectKey = (subject: EventSubject): string =>
	subject.kind === "arrival"
		? `arrival:${subject.eventId}`
		: `step:${subject.n}`

async function confirmStep(
	upstream: DemoDataUpstream,
	n: number,
): Promise<EventConfirmation> {
	try {
		const answer = await readsFor(upstream).runStep(n)
		if (!answer.confirmed) {
			return { status: "unconfirmed" }
		}
		return {
			status: "confirmed",
			...(answer.text !== undefined ? { text: answer.text } : {}),
			...(answer.businessTime !== undefined
				? { businessTime: answer.businessTime }
				: {}),
		}
	} catch {
		return { status: "unavailable" }
	}
}

export async function confirmEvent(
	{ upstream, sources }: ConfirmDeps,
	subject: EventSubject,
): Promise<EventConfirmation> {
	if (subject.kind === "step") {
		return confirmStep(upstream, subject.n)
	}
	if (subject.via === undefined) {
		return { status: "not-confirmable" }
	}
	const read = await sources.read(subject.via.claim, subject.via.ref)
	if (read.status === "resolved") {
		return {
			status: "confirmed",
			...(read.text !== undefined ? { text: read.text } : {}),
			...(read.businessTime !== undefined
				? { businessTime: read.businessTime }
				: {}),
		}
	}
	return read.reason === "unconfirmed"
		? { status: "unconfirmed" }
		: { status: "unavailable" }
}
