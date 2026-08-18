import { describe, it, expect } from "vitest"
import { MdbrainClient } from "@mdbrain/client"
import { createMdbrainTools } from "@mdbrain/tools"
import * as bridge from "./mdbrain-bridge.js"

describe("Phase 7-11 wiring: bridge functions", () => {
	it("exports mdbrainBridgeShutdown (bridge shutdown part 2)", async () => {
		expect(typeof bridge.mdbrainBridgeShutdown).toBe("function")
	})

	it("exports mdbrainBridgeGetLifecycleItem", async () => {
		expect(typeof bridge.mdbrainBridgeGetLifecycleItem).toBe("function")
	})

	it("exports mdbrainBridgeUpdateLifecycleItem", async () => {
		expect(typeof bridge.mdbrainBridgeUpdateLifecycleItem).toBe("function")
	})

	it("exports mdbrainBridgeDeleteLifecycleItem", async () => {
		expect(typeof bridge.mdbrainBridgeDeleteLifecycleItem).toBe("function")
	})

	it("exports mdbrainBridgeGetLifecycleHistory", async () => {
		expect(typeof bridge.mdbrainBridgeGetLifecycleHistory).toBe("function")
	})

	it("exports mdbrainBridgeRecallConversation", async () => {
		expect(typeof bridge.mdbrainBridgeRecallConversation).toBe("function")
	})

	it("exports mdbrainBridgeReportProcedureOutcome", async () => {
		expect(typeof bridge.mdbrainBridgeReportProcedureOutcome).toBe("function")
	})

	it("exports mdbrainBridgeApplyMemoryFeedback", async () => {
		expect(typeof bridge.mdbrainBridgeApplyMemoryFeedback).toBe("function")
	})
})

describe("Phase 10 wiring: client methods", () => {
	it("MdbrainClient has getLifecycleItem method", async () => {
		const client = new MdbrainClient({ baseUrl: "http://localhost:9999" })
		expect(typeof client.getLifecycleItem).toBe("function")
	})

	it("MdbrainClient has updateLifecycleItem method", async () => {
		const client = new MdbrainClient({ baseUrl: "http://localhost:9999" })
		expect(typeof client.updateLifecycleItem).toBe("function")
	})

	it("MdbrainClient has deleteLifecycleItem method", async () => {
		const client = new MdbrainClient({ baseUrl: "http://localhost:9999" })
		expect(typeof client.deleteLifecycleItem).toBe("function")
	})

	it("MdbrainClient has getLifecycleHistory method", async () => {
		const client = new MdbrainClient({ baseUrl: "http://localhost:9999" })
		expect(typeof client.getLifecycleHistory).toBe("function")
	})

	it("MdbrainClient has recallConversation method", async () => {
		const client = new MdbrainClient({ baseUrl: "http://localhost:9999" })
		expect(typeof client.recallConversation).toBe("function")
	})

	it("MdbrainClient has reportProcedureOutcome method", async () => {
		const client = new MdbrainClient({ baseUrl: "http://localhost:9999" })
		expect(typeof client.reportProcedureOutcome).toBe("function")
	})

	it("MdbrainClient has applyMemoryFeedback method", async () => {
		const client = new MdbrainClient({ baseUrl: "http://localhost:9999" })
		expect(typeof client.applyMemoryFeedback).toBe("function")
	})
})

describe("Phase 10 wiring: AI SDK tools", () => {
	it("createMdbrainTools includes mdbrain_lifecycle_get", async () => {
		const client = new MdbrainClient({ baseUrl: "http://localhost:9999" })
		const tools = createMdbrainTools(client)
		expect(tools.mdbrain_lifecycle_get).toBeDefined()
	})

	it("createMdbrainTools includes mdbrain_lifecycle_update", async () => {
		const client = new MdbrainClient({ baseUrl: "http://localhost:9999" })
		const tools = createMdbrainTools(client)
		expect(tools.mdbrain_lifecycle_update).toBeDefined()
	})

	it("createMdbrainTools includes mdbrain_lifecycle_delete", async () => {
		const client = new MdbrainClient({ baseUrl: "http://localhost:9999" })
		const tools = createMdbrainTools(client)
		expect(tools.mdbrain_lifecycle_delete).toBeDefined()
	})

	it("createMdbrainTools includes mdbrain_lifecycle_history", async () => {
		const client = new MdbrainClient({ baseUrl: "http://localhost:9999" })
		const tools = createMdbrainTools(client)
		expect(tools.mdbrain_lifecycle_history).toBeDefined()
	})

	it("createMdbrainTools includes mdbrain_recall_conversation", async () => {
		const client = new MdbrainClient({ baseUrl: "http://localhost:9999" })
		const tools = createMdbrainTools(client)
		expect(tools.mdbrain_recall_conversation).toBeDefined()
	})

	it("createMdbrainTools includes mdbrain_procedure_outcome", async () => {
		const client = new MdbrainClient({ baseUrl: "http://localhost:9999" })
		const tools = createMdbrainTools(client)
		expect(tools.mdbrain_procedure_outcome).toBeDefined()
	})

	it("createMdbrainTools includes mdbrain_memory_feedback", async () => {
		const client = new MdbrainClient({ baseUrl: "http://localhost:9999" })
		const tools = createMdbrainTools(client)
		expect(tools.mdbrain_memory_feedback).toBeDefined()
	})
})
