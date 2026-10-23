import { describe, expect, it } from "vitest"
import {
	createLeaseService,
	isFullySeeded,
	leaseManifestOf,
	type LeaseDoc,
	type LeaseManifest,
} from "./lease.js"
import { MemoryCollection } from "./testing/memory-collection.js"

const NOW = new Date("2026-10-23T12:00:00.000Z")
const TTL_MS = 30 * 60_000

function manifest(slotIndex: number, over: Partial<LeaseManifest> = {}) {
	return {
		runId: `run-${slotIndex}`,
		slotIndex,
		scopeRef: `demo-run-${slotIndex}`,
		agentId: `demo-run-${slotIndex}`,
		state: "ready",
		eventsPlanned: 36,
		pagesPlanned: 12,
		eventsWritten: 36,
		pagesWritten: 12,
		hasAgentRun: false,
		...over,
	} satisfies LeaseManifest
}

function rig(manifests: LeaseManifest[], pinnedRunId?: string) {
	const leases = new MemoryCollection<LeaseDoc>(["presenterId"])
	let clock = NOW
	const make = () =>
		createLeaseService({
			leases,
			manifests: { listReady: async () => manifests },
			pinnedRunId: async () => pinnedRunId,
			now: () => clock,
			ttlMs: TTL_MS,
		})
	return {
		leases,
		service: make(),
		restart: make,
		tick: (ms: number) => {
			clock = new Date(clock.getTime() + ms)
		},
	}
}

describe("isFullySeeded", () => {
	it("holds only for a ready run with every planned event and page written and no agent run", () => {
		expect(isFullySeeded(manifest(13))).toBe(true)
		expect(isFullySeeded(manifest(1, { eventsWritten: 20 }))).toBe(false)
		expect(isFullySeeded(manifest(1, { pagesWritten: 3 }))).toBe(false)
		expect(isFullySeeded(manifest(1, { state: "seeding" }))).toBe(false)
		expect(isFullySeeded(manifest(1, { state: "used" }))).toBe(false)
		expect(isFullySeeded(manifest(1, { hasAgentRun: true }))).toBe(false)
		expect(
			isFullySeeded(
				manifest(1, { eventsPlanned: 0, eventsWritten: 0, pagesPlanned: 0 }),
			),
		).toBe(false)
	})
})

describe("leaseManifestOf", () => {
	it("reads a stored manifest into the lease view and refuses a malformed one", () => {
		const doc = {
			_id: "run-13",
			runId: "run-13",
			slotIndex: 13,
			scopeRef: "demo-run-13",
			agentId: "demo-run-13",
			state: "ready",
			corpus: { eventsPlanned: 3, pagesPlanned: 2 },
			eventsWritten: [{ sourceId: "a", eventId: "e1" }],
			pagesWritten: ["x", "y"],
		}
		expect(leaseManifestOf(doc)).toEqual({
			runId: "run-13",
			slotIndex: 13,
			scopeRef: "demo-run-13",
			agentId: "demo-run-13",
			state: "ready",
			eventsPlanned: 3,
			pagesPlanned: 2,
			eventsWritten: 1,
			pagesWritten: 2,
			hasAgentRun: false,
			agentRunState: "",
		})
		expect(
			leaseManifestOf({ ...doc, agentRun: { state: "running" } })?.hasAgentRun,
		).toBe(true)
		expect(
			leaseManifestOf({ ...doc, agentRunState: "complete" })?.hasAgentRun,
		).toBe(true)
		expect(
			leaseManifestOf({ ...doc, agentRun: { state: "complete" } })
				?.agentRunState,
		).toBe("complete")
		expect(leaseManifestOf({ ...doc, corpus: undefined })).toBeNull()
		expect(leaseManifestOf({ ...doc, eventsWritten: "none" })).toBeNull()
		expect(leaseManifestOf(null)).toBeNull()
	})
})

describe("lease: which slot", () => {
	it("takes the lowest fully seeded free slot and names it by default", async () => {
		const { service } = rig([manifest(14), manifest(13), manifest(15)])
		const lease = await service.acquire({ presenterId: "p1" })
		expect(lease).toMatchObject({
			slotIndex: 13,
			runId: "run-13",
			presenterId: "p1",
			name: "Slot 13",
		})
		expect(new Date(lease.expiresAt).getTime()).toBe(NOW.getTime() + TTL_MS)
	})

	it("never takes a slot that is not fully seeded, even when asked for it by number", async () => {
		const partial = [
			manifest(1, { eventsWritten: 12 }),
			manifest(2, { pagesWritten: 4 }),
			manifest(5, { state: "seeding" }),
			manifest(6, { hasAgentRun: true }),
		]
		const { service, leases } = rig([...partial, manifest(13)])
		const lease = await service.acquire({ presenterId: "p1" })
		expect(lease.slotIndex).toBe(13)
		await service.release("p1")
		for (const slot of [1, 2, 5, 6]) {
			await expect(
				service.acquire({ presenterId: "p1", slotIndex: slot }),
			).rejects.toMatchObject({ code: "SLOT_NOT_LEASABLE" })
		}
		expect(leases.docs.size).toBe(0)
	})

	it("refuses with no slot available when every slot is partial", async () => {
		const { service } = rig([
			manifest(1, { eventsWritten: 1 }),
			manifest(2, { state: "failed" }),
		])
		await expect(service.acquire({ presenterId: "p1" })).rejects.toMatchObject({
			code: "NO_SLOT_AVAILABLE",
		})
	})

	it("never takes the slot of the run pinned for public mode", async () => {
		const { service } = rig([manifest(13), manifest(14)], "run-13")
		expect((await service.acquire({ presenterId: "p1" })).slotIndex).toBe(14)
		await expect(
			service.acquire({ presenterId: "p2", slotIndex: 13 }),
		).rejects.toMatchObject({ code: "SLOT_NOT_LEASABLE" })
	})

	it("honors a named slot when it is fully seeded and free", async () => {
		const { service } = rig([manifest(13), manifest(14)])
		expect(
			(await service.acquire({ presenterId: "p1", slotIndex: 14 })).slotIndex,
		).toBe(14)
	})
})

describe("lease: exclusive", () => {
	it("gives one of two presenters the only slot and refuses the other", async () => {
		const { service } = rig([manifest(13)])
		const results = await Promise.allSettled([
			service.acquire({ presenterId: "p1" }),
			service.acquire({ presenterId: "p2" }),
		])
		const won = results.filter((r) => r.status === "fulfilled")
		const lost = results.filter((r) => r.status === "rejected")
		expect(won).toHaveLength(1)
		expect(lost).toHaveLength(1)
		expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({
			code: "NO_SLOT_AVAILABLE",
		})
	})

	it("sends the second presenter to the next free slot", async () => {
		const { service } = rig([manifest(13), manifest(14)])
		const first = await service.acquire({ presenterId: "p1" })
		const second = await service.acquire({ presenterId: "p2" })
		expect([first.slotIndex, second.slotIndex]).toEqual([13, 14])
	})

	it("moves on when a rival takes the candidate between the read and the claim", async () => {
		const { service, leases } = rig([manifest(13), manifest(14)])
		const rival: LeaseDoc = {
			_id: "slot:13",
			slotIndex: 13,
			runId: "run-13",
			presenterId: "rival",
			name: "Slot 13",
			acquiredAt: NOW,
			expiresAt: new Date(NOW.getTime() + TTL_MS),
		}
		const insert = leases.insertOne.bind(leases)
		let raced = false
		leases.insertOne = async (doc) => {
			if (!raced) {
				raced = true
				await insert(rival)
			}
			return insert(doc)
		}
		expect((await service.acquire({ presenterId: "p1" })).slotIndex).toBe(14)
		expect(leases.docs.get("slot:13")?.presenterId).toBe("rival")
	})

	it("returns the same lease to a presenter who asks twice", async () => {
		const { service, leases } = rig([manifest(13), manifest(14)])
		const a = await service.acquire({ presenterId: "p1" })
		const b = await service.acquire({ presenterId: "p1" })
		expect(b.slotIndex).toBe(a.slotIndex)
		expect(leases.docs.size).toBe(1)
	})
})

describe("lease: release, expiry, renew, restart", () => {
	it("frees the slot on release and ignores a release by someone else", async () => {
		const { service } = rig([manifest(13)])
		await service.acquire({ presenterId: "p1" })
		expect(await service.release("p2")).toBe(false)
		await expect(service.acquire({ presenterId: "p2" })).rejects.toMatchObject({
			code: "NO_SLOT_AVAILABLE",
		})
		expect(await service.release("p1")).toBe(true)
		expect((await service.acquire({ presenterId: "p2" })).presenterId).toBe(
			"p2",
		)
	})

	it("lets another presenter take an expired lease and drops the old holder", async () => {
		const { service, tick } = rig([manifest(13)])
		await service.acquire({ presenterId: "p1" })
		tick(TTL_MS - 1)
		await expect(service.acquire({ presenterId: "p2" })).rejects.toMatchObject({
			code: "NO_SLOT_AVAILABLE",
		})
		tick(2)
		expect(await service.current("p1")).toBeNull()
		const taken = await service.acquire({ presenterId: "p2" })
		expect(taken.presenterId).toBe("p2")
		expect(await service.current("p1")).toBeNull()
		expect((await service.current("p2"))?.slotIndex).toBe(13)
	})

	it("lets a presenter whose own lease expired lease again", async () => {
		const { service, tick } = rig([manifest(13)])
		await service.acquire({ presenterId: "p1" })
		tick(TTL_MS + 1)
		expect((await service.acquire({ presenterId: "p1" })).slotIndex).toBe(13)
	})

	it("extends the lease on renew and refuses to renew an expired one", async () => {
		const { service, tick } = rig([manifest(13)])
		await service.acquire({ presenterId: "p1" })
		tick(TTL_MS - 1000)
		const renewed = await service.renew("p1")
		expect(renewed?.expiresAt.getTime()).toBe(
			NOW.getTime() + TTL_MS - 1000 + TTL_MS,
		)
		tick(TTL_MS - 1000)
		expect(await service.current("p1")).not.toBeNull()
		tick(2000)
		expect(await service.renew("p1")).toBeNull()
		expect(await service.current("p1")).toBeNull()
	})

	it("keeps the lease across a restart of the service and still refuses a rival", async () => {
		const { service, restart } = rig([manifest(13)])
		await service.acquire({ presenterId: "p1", name: "Acme renewal" })
		const after = restart()
		expect(await after.current("p1")).toMatchObject({
			slotIndex: 13,
			name: "Acme renewal",
		})
		await expect(after.acquire({ presenterId: "p2" })).rejects.toMatchObject({
			code: "NO_SLOT_AVAILABLE",
		})
	})
})

describe("lease: slot naming", () => {
	it("names the slot on acquire and renames it for the holder only", async () => {
		const { service } = rig([manifest(13)])
		const lease = await service.acquire({
			presenterId: "p1",
			name: "  Acme renewal  ",
		})
		expect(lease.name).toBe("Acme renewal")
		expect((await service.rename("p1", "Globex QBR"))?.name).toBe("Globex QBR")
		expect(await service.rename("p2", "Hijack")).toBeNull()
		expect((await service.current("p1"))?.name).toBe("Globex QBR")
	})

	it("refuses an empty, overlong or control-character name", async () => {
		const { service } = rig([manifest(13)])
		await service.acquire({ presenterId: "p1" })
		for (const bad of ["   ", "x".repeat(41), "a\u0000b", "a\nb"]) {
			await expect(service.rename("p1", bad)).rejects.toMatchObject({
				code: "INVALID_NAME",
			})
		}
		await expect(
			service.acquire({ presenterId: "p9", name: "x".repeat(41) }),
		).rejects.toMatchObject({ code: "INVALID_NAME" })
	})
})
