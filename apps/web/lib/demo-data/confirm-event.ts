// The one place that decides how an event the run wrote is confirmed. Every
// arrival and every agent step on the screen is confirmed through
// `confirmEvent`: a cite by the event's id, which the API resolves in the run's
// own scope with no citing claim.

import { formatCitationMarker } from "@mdbrain/client"
import type { SourceReader } from "./source-reader.js"

export type EventSubject = { eventId: string }

export type EventConfirmation =
	| { status: "confirmed"; text?: string; businessTime?: string }
	/** Asked, and the API did not confirm it. */
	| { status: "unconfirmed" }
	/** The read failed. It may work on the next try. */
	| { status: "unavailable" }

export interface ConfirmDeps {
	/** Events are cited through the same reader the citation dialog uses. */
	sources: SourceReader
}

export const subjectKey = (subject: EventSubject): string => subject.eventId

export async function confirmEvent(
	{ sources }: ConfirmDeps,
	subject: EventSubject,
): Promise<EventConfirmation> {
	const read = await sources.read(undefined, {
		eventId: subject.eventId,
		marker: formatCitationMarker({ kind: "event", eventId: subject.eventId }),
	})
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
