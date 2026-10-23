import { describe, expect, it } from "vitest"
import type { RunManifestView } from "../seeding/manifest.js"
import { executeAgentRun, type AgentRunContext } from "./run.js"

function context(manifest: Partial<RunManifestView> | null): AgentRunContext {
	return {
		secrets: new Map(),
		control: {
			manifests: { get: async () => manifest as RunManifestView | null },
		} as unknown as AgentRunContext["control"],
	}
}

describe("executeAgentRun", () => {
	it("refuses a run that has no manifest, is not ready, or already started, before any key or model is touched", async () => {
		await expect(executeAgentRun(context(null), "run-1")).rejects.toThrow(
			"no manifest for run run-1",
		)
		await expect(
			executeAgentRun(context({ state: "seeding" }), "run-1"),
		).rejects.toThrow("run run-1 is seeding, not ready")
		await expect(
			executeAgentRun(
				context({
					state: "ready",
					agentRun: { state: "running", startedAt: "2026-10-23T12:00:00.000Z" },
				}),
				"run-1",
			),
		).rejects.toThrow("agent run is already running")
	})

	it("fails closed with no model key, naming the missing key and never a value", async () => {
		await expect(
			executeAgentRun(context({ state: "ready", slotIndex: 13 }), "run-1"),
		).rejects.toThrow("no ANTHROPIC_API_KEY for the pinned Haiku model")
	})
})
