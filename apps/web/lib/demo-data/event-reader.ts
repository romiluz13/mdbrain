// Confirms the run's events one at a time and remembers what it learned. A
// confirmation can be a governed recall that takes seconds, so a screen asks
// for each on its own, a few at once, and an event answered once is not asked
// again while the page is open.

import {
	confirmEvent,
	subjectKey,
	type ConfirmDeps,
	type EventConfirmation,
	type EventSubject,
} from "./confirm-event.js"
import { LANES } from "./source-reader.js"

export interface EventReader {
	/** Confirms one event, or joins the read already under way. */
	read(subject: EventSubject): Promise<EventConfirmation>
	/** What has already been answered, so a screen can paint it without a flash
	 * of loading. */
	peek(subject: EventSubject): EventConfirmation | undefined
}

type Confirm = typeof confirmEvent

export function createEventReader(
	deps: ConfirmDeps,
	confirm: Confirm = confirmEvent,
): EventReader {
	const reading = new Map<string, Promise<EventConfirmation>>()
	const settled = new Map<string, EventConfirmation>()
	return {
		read(subject) {
			const key = subjectKey(subject)
			const known = settled.get(key)
			if (known !== undefined) {
				return Promise.resolve(known)
			}
			const joined = reading.get(key)
			if (joined !== undefined) {
				return joined
			}
			const started = confirm(deps, subject).then((answer) => {
				reading.delete(key)
				// A failed read is not an answer: asking again reads it again.
				if (answer.status !== "unavailable") {
					settled.set(key, answer)
				}
				return answer
			})
			reading.set(key, started)
			return started
		},
		peek: (subject) => settled.get(subjectKey(subject)),
	}
}

/** Confirms the events through the reader a few at a time, in order, so the
 * first land first. `onRead` hears each as it lands; once `live` says no, no
 * further event is asked for and none is heard. */
export async function readEventsInLanes(
	reader: EventReader,
	subjects: readonly EventSubject[],
	onRead?: (subject: EventSubject, answer: EventConfirmation) => void,
	live: () => boolean = () => true,
): Promise<void> {
	let next = 0
	const lane = async () => {
		while (live() && next < subjects.length) {
			const subject = subjects[next]
			next += 1
			if (subject === undefined) {
				return
			}
			const answer = await reader.read(subject)
			if (live()) {
				onRead?.(subject, answer)
			}
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(LANES, subjects.length) }, lane),
	)
}
