import type { MdbrainClient } from "@mdbrain/client"
import { describe, expect, it } from "vitest"
import { createMdbrainTools } from "./index.js"

describe("createMdbrainTools", () => {
	it("does not expose the Memongo status control operation", () => {
		const tools = createMdbrainTools({} as MdbrainClient)

		expect(tools).not.toHaveProperty("mdbrain_status")
	})
})
