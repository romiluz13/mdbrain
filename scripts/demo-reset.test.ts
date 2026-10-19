import { describe, expect, it, vi } from "vitest"
import { CONFIRM_FLAG, runDemoReset } from "./demo-reset.js"

describe("runDemoReset", () => {
	it("refuses without the confirmation flag and never connects", async () => {
		const connect = vi.fn()
		const log = vi.fn()
		const code = await runDemoReset([], { connect, log })
		expect(code).toBe(2)
		expect(connect).not.toHaveBeenCalled()
		const output = log.mock.calls.flat().join("\n")
		expect(output).toContain("mdbrain_demo_wiki")
		expect(output).toContain("mdbrain_demo_memory")
		expect(output).toContain("mdbrain_demo_control")
		expect(output).toContain(CONFIRM_FLAG)
	})

	it("refuses a near-miss flag", async () => {
		const connect = vi.fn()
		const code = await runDemoReset(["--confirm"], { connect, log: vi.fn() })
		expect(code).toBe(2)
		expect(connect).not.toHaveBeenCalled()
	})
})
