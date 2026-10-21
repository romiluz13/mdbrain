import { describe, expect, it } from "vitest"
import type {
	ConfirmDeps,
	EventConfirmation,
	EventSubject,
} from "./confirm-event.js"
import { createEventReader, readEventsInLanes } from "./event-reader.js"
import { LANES } from "./source-reader.js"

const deps = {} as ConfirmDeps
const step = (n: number): EventSubject => ({ kind: "step", n })

function counting(answer: (n: number) => EventConfirmation) {
	const asked: number[] = []
	const confirm = async (_: ConfirmDeps, subject: EventSubject) => {
		const n = subject.kind === "step" ? subject.n : 0
		asked.push(n)
		return answer(n)
	}
	return { asked, confirm }
}

describe("createEventReader", () => {
	it("joins a read already under way instead of asking twice", async () => {
		const { asked, confirm } = counting(() => ({ status: "unconfirmed" }))
		const reader = createEventReader(deps, confirm)
		await Promise.all([reader.read(step(1)), reader.read(step(1))])
		expect(asked).toEqual([1])
	})

	it.each<EventConfirmation>([
		{ status: "confirmed", text: "a step" },
		{ status: "unconfirmed" },
		{ status: "not-confirmable" },
	])("remembers an answer ($status), so it is not asked again", async (answer) => {
		const { asked, confirm } = counting(() => answer)
		const reader = createEventReader(deps, confirm)
		await reader.read(step(2))
		expect(reader.peek(step(2))).toEqual(answer)
		await reader.read(step(2))
		expect(asked).toEqual([2])
	})

	it("asks again after a read that failed, and remembers nothing from it", async () => {
		const answers: EventConfirmation[] = [
			{ status: "unavailable" },
			{ status: "confirmed", text: "ok" },
		]
		const { asked, confirm } = counting(
			() => answers.shift() ?? { status: "unavailable" },
		)
		const reader = createEventReader(deps, confirm)
		expect((await reader.read(step(3))).status).toBe("unavailable")
		expect(reader.peek(step(3))).toBeUndefined()
		expect((await reader.read(step(3))).status).toBe("confirmed")
		expect(asked).toEqual([3, 3])
	})
})

describe("readEventsInLanes", () => {
	it("asks for at most a few at once and in order, hearing each as it lands", async () => {
		let inFlight = 0
		let peak = 0
		const started: number[] = []
		const reader = createEventReader(deps, async (_, subject) => {
			started.push(subject.kind === "step" ? subject.n : 0)
			inFlight += 1
			peak = Math.max(peak, inFlight)
			await new Promise((resolve) => setTimeout(resolve, 5))
			inFlight -= 1
			return { status: "unconfirmed" }
		})
		const heard: number[] = []
		await readEventsInLanes(
			reader,
			Array.from({ length: 10 }, (_, at) => step(at + 1)),
			(subject) => heard.push(subject.kind === "step" ? subject.n : 0),
		)
		expect(peak).toBe(LANES)
		expect(started.slice(0, LANES)).toEqual([1, 2, 3, 4])
		expect([...heard].sort((a, b) => a - b)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
		])
	})

	it("stops asking and hears nothing once told it is no longer live", async () => {
		let live = true
		const { asked, confirm } = counting(() => ({ status: "unconfirmed" }))
		const reader = createEventReader(deps, confirm)
		const heard: number[] = []
		const done = readEventsInLanes(
			reader,
			Array.from({ length: 12 }, (_, at) => step(at + 1)),
			(subject) => heard.push(subject.kind === "step" ? subject.n : 0),
			() => live,
		)
		live = false
		await done
		expect(asked.length).toBeLessThanOrEqual(LANES)
		expect(heard).toEqual([])
	})
})
