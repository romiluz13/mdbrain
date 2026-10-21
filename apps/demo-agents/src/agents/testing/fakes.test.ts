import { describe, expect, it } from "vitest"
import type { MdbrainClientError } from "@mdbrain/client"
import { fakeAgentClients } from "./fakes.js"

async function refusal(promise: Promise<unknown>): Promise<MdbrainClientError> {
	try {
		await promise
		throw new Error("expected a refusal")
	} catch (error) {
		return error as MdbrainClientError
	}
}

describe("fakeAgentClients role-key constraints", () => {
	it("refuses every support or account call that omits the pinned agentId", async () => {
		const { clients } = fakeAgentClients({ pinnedAgentId: "demo-run-1" })
		const base = {
			scope: "workspace",
			scopeRef: "demo-run-1",
		}
		for (const client of [clients.support, clients.account]) {
			const write = await refusal(
				client.writeEvent({
					role: "user",
					body: "b",
					idempotencyKey: "k1",
					...base,
				} as never),
			)
			expect(write.status).toBe(403)
			expect(write.message).toContain("agentId is required for this API key")
			const add = await refusal(
				client.add({ content: "c", idempotencyKey: "k2", ...base } as never),
			)
			expect(add.status).toBe(403)
			const apply = await refusal(
				client.wikiApply({ slug: "s", claims: [], ...base } as never),
			)
			expect(apply.status).toBe(403)
			const read = await refusal(
				client.wikiGet({ slug: "s", ...base } as never),
			)
			expect(read.status).toBe(403)
		}
		// The product key is a wildcard: it never needs the pinned agentId, so
		// its refusal (if any) is the 404 for a missing page, never the 403.
		const product = await refusal(
			clients.product.wikiGet({ slug: "missing", ...base } as never),
		)
		expect(product.status).toBe(404)
	})

	it("refuses calls whose scopeRef is not the key's exact workspace grant", async () => {
		const { clients } = fakeAgentClients({ grantedScopeRef: "demo-run-1" })
		const wrongScope = { scope: "workspace", scopeRef: "demo-run-2" }
		const write = await refusal(
			clients.support.writeEvent({
				role: "user",
				body: "b",
				idempotencyKey: "k1",
				agentId: "demo-run-1",
				...wrongScope,
			} as never),
		)
		expect(write.status).toBe(403)
		expect(write.message).toContain("scopeRef")
		const read = await refusal(
			clients.product.wikiGet({ slug: "s", ...wrongScope } as never),
		)
		expect(read.status).toBe(403)
		expect(read.message).toContain("scopeRef")
	})

	it("refuses the proposer role's direct wiki apply", async () => {
		const { clients } = fakeAgentClients()
		const error = await refusal(
			clients.product.wikiApply({
				slug: "s",
				claims: [],
				scope: "workspace",
				scopeRef: "demo-run-1",
			} as never),
		)
		expect(error.status).toBe(403)
		expect(error.message).toContain("propose")
	})

	it("answers a duplicate write with the original receipt and chunkCreated false", async () => {
		const { clients, receipts } = fakeAgentClients()
		const input = {
			role: "user",
			body: "renewal risk thread",
			idempotencyKey: "seed:run-1:event:src-renewal-05",
			agentId: "demo-run-1",
			scope: "workspace",
			scopeRef: "demo-run-1",
		}
		const first = await clients.support.writeEvent(input as never)
		const second = await clients.support.writeEvent(input as never)
		expect(first).toMatchObject({ ok: true, chunkCreated: true })
		expect(second).toMatchObject({
			ok: true,
			eventId: first.eventId,
			chunkCreated: false,
		})
		const matching = receipts.filter(
			(entry) => entry.input.idempotencyKey === input.idempotencyKey,
		)
		expect(matching).toHaveLength(2)
	})
})
