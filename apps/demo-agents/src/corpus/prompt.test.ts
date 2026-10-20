import { describe, expect, it } from "vitest"
import { MAX_INPUT_TOKENS } from "./render-config.js"
import { inputTokenBound, recordPrompt, systemPrompt } from "./prompt.js"
import { buildWorld } from "./world.js"

const world = buildWorld(20261020)

describe("prompts", () => {
	it("asks for every fact verbatim and names the author and account", () => {
		const spec = world.sources.find((s) => s.id === "src-renewal-04")
		if (!spec) throw new Error("fixture")
		const prompt = recordPrompt(world, spec)
		for (const fact of spec.facts) expect(prompt).toContain(`"${fact}"`)
		expect(prompt).toContain(
			"Noa Segal (Support Lead, Tier 2, Northstar Systems)",
		)
		expect(prompt).toContain("Halvorsen Freight Group, grocery distribution")
	})

	it("keeps the system prompt identical across records so it can be cached", () => {
		expect(systemPrompt(world)).toBe(systemPrompt(buildWorld(20261020)))
		expect(systemPrompt(world)).not.toMatch(/src-/)
	})

	it("stays inside the declared input cap for every record", () => {
		const system = systemPrompt(world)
		const worst = Math.max(
			...world.sources.map((s) =>
				inputTokenBound(system, recordPrompt(world, s)),
			),
		)
		expect(worst).toBeLessThanOrEqual(MAX_INPUT_TOKENS)
	})
})
