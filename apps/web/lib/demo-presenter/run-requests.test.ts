import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { LeaseManifest } from "./lease.js"
import {
	createRunRequestService,
	EXPIRED_REASON,
	RUN_REQUEST_CLAIM_MAX_AGE_MS,
	RUN_REQUEST_QUEUE_MAX_AGE_MS,
	requestIsStale,
	type RunRequestDoc,
} from "./run-requests.js"
import { MemoryCollection } from "./testing/memory-collection.js"

const T0 = new Date("2026-10-23T12:00:00.000Z")
const MANIFEST: LeaseManifest = {
	runId: "run-13",
	slotIndex: 13,
	scopeRef: "demo-run-13",
	agentId: "demo-run-13",
	state: "ready",
	eventsPlanned: 36,
	pagesPlanned: 12,
	eventsWritten: 36,
	pagesWritten: 12,
	hasAgentRun: false,
}
const LEASE = { runId: "run-13", slotIndex: 13 }

function rig() {
	const requests = new MemoryCollection<RunRequestDoc>()
	let clock = T0
	return {
		requests,
		service: createRunRequestService({ requests, now: () => clock }),
		tick: (ms: number) => {
			clock = new Date(clock.getTime() + ms)
		},
	}
}

describe("run requests", () => {
	it("queues one request for the leased run, stamped with the presenter and the time", async () => {
		const { service, requests } = rig()
		const queued = await service.enqueue(LEASE, MANIFEST, "presenter-1")
		expect(queued).toMatchObject({
			_id: "run-13",
			slotIndex: 13,
			state: "queued",
			requestedAt: T0.toISOString(),
			requestedBy: "presenter-1",
		})
		expect(requests.docs.size).toBe(1)
	})

	it("is idempotent: a second ask returns the request already there", async () => {
		const { service, requests } = rig()
		await service.enqueue(LEASE, MANIFEST, "presenter-1")
		const again = await service.enqueue(LEASE, MANIFEST, "presenter-1")
		expect(again.state).toBe("queued")
		expect(requests.docs.size).toBe(1)
	})

	it("queues a double click once", async () => {
		const { service, requests } = rig()
		const both = await Promise.all([
			service.enqueue(LEASE, MANIFEST, "presenter-1"),
			service.enqueue(LEASE, MANIFEST, "presenter-1"),
		])
		expect(both.map((doc) => doc.state)).toEqual(["queued", "queued"])
		expect(requests.docs.size).toBe(1)
	})

	it("refuses a run that is not fully seeded or already started, when nothing is queued", async () => {
		for (const manifest of [
			{ ...MANIFEST, eventsWritten: 3 },
			{ ...MANIFEST, hasAgentRun: true },
			{ ...MANIFEST, state: "used" },
		]) {
			const { service } = rig()
			await expect(
				service.enqueue(LEASE, manifest, "presenter-1"),
			).rejects.toMatchObject({ code: "RUN_NOT_READY" })
		}
		const { service } = rig()
		await expect(
			service.enqueue(LEASE, null, "presenter-1"),
		).rejects.toMatchObject({ code: "RUN_NOT_READY" })
	})

	it("returns a started run's request as it is, and never re-queues it", async () => {
		const { service, requests } = rig()
		await service.enqueue(LEASE, MANIFEST, "presenter-1")
		requests.docs.set("run-13", {
			...requests.docs.get("run-13")!,
			state: "claimed",
			workerId: "worker-1",
			claimedAt: T0.toISOString(),
		})
		const again = await service.enqueue(
			LEASE,
			{ ...MANIFEST, hasAgentRun: true },
			"presenter-1",
		)
		expect(again.state).toBe("claimed")
	})

	it("queues a failed request again while the run is still unstarted", async () => {
		const { service, requests, tick } = rig()
		await service.enqueue(LEASE, MANIFEST, "presenter-1")
		requests.docs.set("run-13", {
			...requests.docs.get("run-13")!,
			state: "failed",
			failureReason: "no ANTHROPIC_API_KEY for the pinned Haiku model",
		})
		tick(5000)
		const again = await service.enqueue(LEASE, MANIFEST, "presenter-1")
		expect(again).toMatchObject({
			state: "queued",
			requestedAt: new Date(T0.getTime() + 5000).toISOString(),
		})
		expect(again.failureReason).toBeUndefined()
	})

	it("queues a request again when nobody picked the last one up in time", async () => {
		const { service, tick } = rig()
		await service.enqueue(LEASE, MANIFEST, "presenter-1")
		tick(RUN_REQUEST_QUEUE_MAX_AGE_MS + 1)
		const again = await service.enqueue(LEASE, MANIFEST, "presenter-1")
		expect(again.requestedAt).toBe(
			new Date(T0.getTime() + RUN_REQUEST_QUEUE_MAX_AGE_MS + 1).toISOString(),
		)
	})

	it("queues a claimed request again when its runner never started the run, and keeps a fresh claim", async () => {
		const { service, requests, tick } = rig()
		await service.enqueue(LEASE, MANIFEST, "presenter-1")
		requests.docs.set("run-13", {
			...requests.docs.get("run-13")!,
			state: "claimed",
			claimedAt: T0.toISOString(),
			workerId: "worker-a",
		})
		tick(RUN_REQUEST_CLAIM_MAX_AGE_MS - 1)
		expect((await service.enqueue(LEASE, MANIFEST, "presenter-1")).state).toBe(
			"claimed",
		)
		tick(2)
		const again = await service.enqueue(LEASE, MANIFEST, "presenter-1")
		expect(again.state).toBe("queued")
		expect(again.claimedAt).toBeUndefined()
		expect(again.workerId).toBeUndefined()
	})

	it("calls a request stale once its queue or claim age passes, and only then", () => {
		const base = { requestedAt: T0.toISOString() }
		const at = (ms: number) => new Date(T0.getTime() + ms)
		expect(
			requestIsStale(
				{ ...base, state: "queued" },
				at(RUN_REQUEST_QUEUE_MAX_AGE_MS),
			),
		).toBe(false)
		expect(
			requestIsStale(
				{ ...base, state: "queued" },
				at(RUN_REQUEST_QUEUE_MAX_AGE_MS + 1),
			),
		).toBe(true)
		const claimed = {
			...base,
			state: "claimed" as const,
			claimedAt: at(5_000).toISOString(),
		}
		expect(
			requestIsStale(claimed, at(5_000 + RUN_REQUEST_CLAIM_MAX_AGE_MS)),
		).toBe(false)
		expect(
			requestIsStale(claimed, at(5_000 + RUN_REQUEST_CLAIM_MAX_AGE_MS + 1)),
		).toBe(true)
		expect(requestIsStale({ ...base, state: "failed" }, at(10 ** 9))).toBe(
			false,
		)
		expect(requestIsStale({ ...base, state: "done" }, at(10 ** 9))).toBe(false)
	})

	it("reads a run's request, or null", async () => {
		const { service } = rig()
		expect(await service.get("run-13")).toBeNull()
		await service.enqueue(LEASE, MANIFEST, "presenter-1")
		expect((await service.get("run-13"))?.state).toBe("queued")
	})
})

describe("the contract with the runner worker", () => {
	const worker = readFileSync(
		join(__dirname, "../../../demo-agents/src/agents/run-requests.ts"),
		"utf8",
	)

	it("uses the collection name, the states and the queue age the worker uses", () => {
		expect(worker).toContain('RUN_REQUESTS_COLLECTION = "demo_run_requests"')
		expect(worker).toContain(
			'RunRequestState = "queued" | "claimed" | "done" | "failed"',
		)
		expect(worker).toContain(
			`DEFAULT_MAX_QUEUE_AGE_MS = ${RUN_REQUEST_QUEUE_MAX_AGE_MS.toLocaleString("en-US").replace(/,/g, "_")}`,
		)
	})

	it("stores the same fields and the same expiry reason", () => {
		const fields: Record<keyof RunRequestDoc, true> = {
			_id: true,
			slotIndex: true,
			state: true,
			requestedAt: true,
			requestedBy: true,
			claimedAt: true,
			workerId: true,
			finishedAt: true,
			failureReason: true,
		}
		const type = /export type RunRequestDoc = \{([\s\S]*?)\n\}/.exec(
			worker,
		)?.[1]
		const declared = [...(type ?? "").matchAll(/^\t(\w+)\??:/gm)].map(
			(match) => match[1],
		)
		expect(declared.sort()).toEqual(Object.keys(fields).sort())
		expect(worker).toContain(`EXPIRED_REASON = "${EXPIRED_REASON}"`)
	})
})
