"use client"

import { useEffect, useState } from "react"
import {
	subjectKey,
	type EventConfirmation,
	type EventSubject,
} from "../../lib/demo-data/confirm-event.js"
import { readEventsInLanes } from "../../lib/demo-data/event-reader.js"
import { useDemo } from "./demo-context.js"

/** The events a screen asks about, each as its own confirmation lands, keyed by
 * `subjectKey`. One read before is there on the first render. */
export function useEventReads(
	wanted: readonly EventSubject[],
): Record<string, EventConfirmation | undefined> {
	const { events } = useDemo()
	const [arrived, setArrived] = useState<Record<string, EventConfirmation>>({})

	useEffect(() => {
		let live = true
		void readEventsInLanes(
			events,
			wanted,
			(subject, answer) =>
				setArrived((current) => ({
					...current,
					[subjectKey(subject)]: answer,
				})),
			() => live,
		)
		return () => {
			live = false
		}
	}, [wanted, events])

	return Object.fromEntries(
		wanted.map((subject) => {
			const key = subjectKey(subject)
			return [key, arrived[key] ?? events.peek(subject)]
		}),
	)
}
