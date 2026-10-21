import { afterEach, describe, expect, it, vi } from "vitest"
import { formatCitationMarker, type MdbrainWikiClaim } from "@mdbrain/client"
import { json, stubUpstream } from "./test-upstream.js"
import type { DemoDataUpstream } from "./loaders.js"
import { createSourceReader } from "./source-reader.js"

const direct: DemoDataUpstream = {
	apiBaseUrl: "http://upstream.test",
	readKey: "test-read-key-123",
	scope: "workspace",
	scopeRef: "demo-run-2",
}

afterEach(() => {
	vi.unstubAllGlobals()
})

const eventMarker = (id: string) =>
	formatCitationMarker({ kind: "event", eventId: id })

const owner: MdbrainWikiClaim = {
	id: "c",
	text: "The renewal is healthy.",
	status: "active",
	confidence: 0.9,
	marker: formatCitationMarker({
		kind: "wiki",
		slug: "accounts/halvorsen",
		claimId: "c",
		revision: 1,
	}),
	evidence: [],
	derivedFrom: [],
}
const refOf = (eventId: string) => ({ eventId, marker: eventMarker(eventId) })
const cite = (eventId: string, text: string) =>
	json({
		status: "resolved",
		kind: "event",
		marker: eventMarker(eventId),
		citedBy: owner.marker,
		event: { eventId, canonicalId: eventId, text },
	})

describe("createSourceReader", () => {
	it("reads each source on its own, so a slow one does not hold back the others", async () => {
		let release: () => void = () => {}
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
			const url = new URL(input instanceof URL ? input.href : String(input))
			const marker = url.searchParams.get("marker")
			if (marker === eventMarker("slow")) await gate
			return cite(marker === eventMarker("slow") ? "slow" : "fast", "text")
		})
		const reader = createSourceReader(direct)
		const slow = reader.read(owner, refOf("slow"))
		const fast = await reader.read(owner, refOf("fast"))
		expect(fast.status).toBe("resolved")
		expect(reader.peek(owner, refOf("fast"))?.status).toBe("resolved")
		expect(reader.peek(owner, refOf("slow"))).toBeUndefined()
		release()
		expect((await slow).status).toBe("resolved")
		expect(reader.peek(owner, refOf("slow"))?.status).toBe("resolved")
	})

	it("reads a source once however often and however early it is asked for", async () => {
		const calls = stubUpstream({ "/v1/cite": () => cite("evt-1", "text") })
		const reader = createSourceReader(direct)
		const [first, second] = await Promise.all([
			reader.read(owner, refOf("evt-1")),
			reader.read(owner, refOf("evt-1")),
		])
		const third = await reader.read(owner, refOf("evt-1"))
		expect(second).toBe(first)
		expect(third).toBe(first)
		expect(calls).toHaveLength(1)
	})

	it("keeps a source apart per citing claim, as the cite itself is", async () => {
		const calls = stubUpstream({ "/v1/cite": () => cite("evt-1", "text") })
		const reader = createSourceReader(direct)
		const other = { ...owner, marker: `${owner.marker}-other` }
		await reader.read(owner, refOf("evt-1"))
		await reader.read(other, refOf("evt-1"))
		expect(calls).toHaveLength(2)
	})

	it("reads an unavailable source again the next time it is asked for", async () => {
		let answer: Response = json({ error: { code: "X", message: "no" } }, 404)
		const calls = stubUpstream({ "/v1/cite": () => answer })
		const reader = createSourceReader(direct)
		expect((await reader.read(owner, refOf("evt-1"))).status).toBe(
			"unavailable",
		)
		expect(reader.peek(owner, refOf("evt-1"))).toBeUndefined()
		answer = cite("evt-1", "text")
		expect((await reader.read(owner, refOf("evt-1"))).status).toBe("resolved")
		expect(calls).toHaveLength(2)
	})
})
