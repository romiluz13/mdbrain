import { afterEach, describe, expect, it, vi } from "vitest"
import type { MdbrainCitationEventResponse } from "@mdbrain/client"
import { json, pageView, stubUpstream } from "./test-upstream.js"
import type { DemoDataUpstream, RunManifestView } from "./loaders.js"
import { loadRunSources } from "./loaders-run.js"

const baseUpstream = {
	apiBaseUrl: "http://upstream.test",
	readKey: "test-read-key-123",
	scope: "workspace",
	scopeRef: "demo-run-2",
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("loadRunSources (D19 shape)", () => {
	function citeResponse(url: URL): Response {
		const marker = url.searchParams.get("marker") ?? ""
		const eventId = marker.replaceAll("[[event:", "").replaceAll("]]", "")
		const response: MdbrainCitationEventResponse = {
			status: "resolved",
			kind: "event",
			marker,
			citedBy: url.searchParams.get("citedBy") ?? "",
			event: {
				eventId,
				canonicalId: eventId,
				text: "Havnor renews the facility.",
				timestamp: "2026-11-16T08:00:00.000Z",
				scope: "workspace",
				scopeRef: "demo-run-2",
			},
		}
		return json(response)
	}
	function manifest(state: string, eventsWritten: string[]): RunManifestView {
		return {
			runId: "run-1",
			slotIndex: 1,
			scopeRef: "demo-run-2",
			agentId: "demo-run-2",
			state,
			eventsWritten,
		}
	}

	it("cites each manifest event in order through the pinned claim", async () => {
		const calls = stubUpstream({ "/v1/cite": citeResponse })
		const upstream: DemoDataUpstream = {
			...baseUpstream,
			getRunManifest: async () =>
				manifest("ready", ["evt-3", "evt-1", "evt-2"]),
			pinnedPage: {
				slug: "halvorsen-renewal",
				revision: 3,
				claims: [{ id: "claim-eta" }],
			},
		}
		const result = await loadRunSources(upstream)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.runId).toBe("run-1")
		expect(result.data.state).toBe("ready")
		expect(result.data.events.map((event) => event.id)).toEqual([
			"evt-3",
			"evt-1",
			"evt-2",
		])
		expect(
			result.data.events.every(
				(event) => event.timestamp === "2026-11-16T08:00:00.000Z",
			),
		).toBe(true)
		expect(result.data.unresolvedEventIds).toEqual([])
		const citeCalls = calls.filter((url) => url.pathname === "/v1/cite")
		expect(citeCalls).toHaveLength(3)
		expect(citeCalls.map((url) => url.searchParams.get("marker"))).toEqual([
			"[[event:evt-3]]",
			"[[event:evt-1]]",
			"[[event:evt-2]]",
		])
		const citedBys = citeCalls.map((url) => url.searchParams.get("citedBy"))
		expect(citedBys[0]).toBe("[[wiki:halvorsen-renewal#claim-eta@r3]]")
		expect(citedBys.every((citedBy) => citedBy?.startsWith("[[wiki:"))).toBe(
			true,
		)
	})

	it("falls back to the first listed page's first claim when no page is pinned", async () => {
		const calls = stubUpstream({
			"/v1/wiki": () => json({ pages: [pageView()], total: 1 }),
			"/v1/wiki/halvorsen-renewal": () => json(pageView()),
			"/v1/cite": citeResponse,
		})
		const upstream: DemoDataUpstream = {
			...baseUpstream,
			getRunManifest: async () => manifest("ready", ["evt-1"]),
		}
		const result = await loadRunSources(upstream)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.events).toHaveLength(1)
		const cite = calls.find((url) => url.pathname === "/v1/cite")
		expect(cite?.searchParams.get("citedBy")).toBe(
			"[[wiki:halvorsen-renewal#claim-1@r3]]",
		)
	})

	it("reports incomplete when the manifest state is not ready", async () => {
		const upstream: DemoDataUpstream = {
			...baseUpstream,
			getRunManifest: async () => manifest("seeding", ["evt-1"]),
		}
		const result = await loadRunSources(upstream)
		expect(result.kind).toBe("incomplete")
		if (result.kind !== "incomplete") return
		expect(result.state).toBe("seeding")
		expect(result.reason).toBe("RUN_NOT_READY")
	})

	it("reports the run manifest gap when no manifest source exists", async () => {
		const result = await loadRunSources(baseUpstream)
		expect(result.kind).toBe("incomplete")
		if (result.kind !== "incomplete") return
		expect(result.reason).toBe("RUN_MANIFEST_NOT_EXPOSED")
		expect(result.state).toBeNull()
	})

	it("keeps the events whose cite resolves and names the rest unresolved", async () => {
		stubUpstream({
			"/v1/cite": (url) => {
				const marker = url.searchParams.get("marker") ?? ""
				if (marker === "[[event:evt-1]]") {
					return citeResponse(url)
				}
				return json(
					{ error: { code: "CITE_NOT_FOUND", message: "no such event" } },
					404,
				)
			},
		})
		const upstream: DemoDataUpstream = {
			...baseUpstream,
			getRunManifest: async () => manifest("ready", ["evt-1", "evt-2"]),
			pinnedPage: {
				slug: "halvorsen-renewal",
				revision: 3,
				claims: [{ id: "claim-eta" }],
			},
		}
		const result = await loadRunSources(upstream)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.events.map((event) => event.id)).toEqual(["evt-1"])
		expect(result.data.unresolvedEventIds).toEqual(["evt-2"])
	})
})
