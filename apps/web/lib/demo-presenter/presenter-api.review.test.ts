import { describe, expect, it } from "vitest"
import { handlePresenterRequest } from "./presenter-api.js"
import { SESSION_COOKIE } from "./session.js"
import { call, ORIGIN, rig, seeded, signIn } from "./testing/presenter-rig.js"

describe("presenter API: approve, reject, pin", () => {
	async function leased() {
		const context = rig([seeded(13)])
		const session = await signIn(context.services)
		await call(context.services, { path: "lease", session })
		return { ...context, session }
	}

	it("lists the proposal pending in the leased scope, and only that scope", async () => {
		const { services, client, session } = await leased()
		const listed = await call(services, {
			method: "GET",
			path: "proposals",
			session,
		})
		expect(listed.status).toBe(200)
		expect(listed.body.proposals).toEqual([
			expect.objectContaining({
				operationId: "op-1",
				title: "Silent ETA drift",
				slug: "syntheses/silent-eta-drift",
			}),
		])
		expect(client.listProposals).toHaveBeenCalledWith({
			scope: "workspace",
			scopeRef: "demo-run-13",
		})
	})

	it("refuses a caller-supplied scope on the review queue", async () => {
		const { services, session } = await leased()
		const response = await handlePresenterRequest(
			new Request(
				`${ORIGIN}/api/demo/presenter/proposals?scopeRef=demo-run-14`,
				{
					headers: { cookie: `${SESSION_COOKIE}=${session.sessionId}` },
				},
			),
			["proposals"],
			services,
		)
		expect(response.status).toBe(400)
	})

	it("approves the pending proposal", async () => {
		const { services, client, session } = await leased()
		const done = await call(services, {
			path: "proposals/decide",
			session,
			body: { operationId: "op-1", decision: "approve" },
		})
		expect(done.status).toBe(200)
		expect(done.body).toEqual({
			state: "promoted",
			pageSlug: "syntheses/silent-eta-drift",
		})
		expect(client.approveProposal).toHaveBeenCalledWith({ operationId: "op-1" })
	})

	it("rejects the pending proposal with a reason", async () => {
		const { services, client, session } = await leased()
		const done = await call(services, {
			path: "proposals/decide",
			session,
			body: {
				operationId: "op-1",
				decision: "reject",
				reason: "not this quarter",
			},
		})
		expect(done.body).toEqual({ state: "rejected" })
		expect(client.rejectProposal).toHaveBeenCalledWith({
			operationId: "op-1",
			reason: "not this quarter",
		})
	})

	it("never decides a proposal outside the leased scope", async () => {
		const { services, client, session } = await leased()
		const refused = await call(services, {
			path: "proposals/decide",
			session,
			body: { operationId: "op-from-another-slot", decision: "approve" },
		})
		expect(refused.status).toBe(409)
		expect(refused.body.error.code).toBe("PROPOSAL_NOT_PENDING")
		expect(client.approveProposal).not.toHaveBeenCalled()
	})

	it("needs a lease to see or decide anything", async () => {
		const { services, session: _ } = await leased()
		const other = await signIn(services)
		const listed = await call(services, {
			method: "GET",
			path: "proposals",
			session: other,
		})
		expect(listed.status).toBe(409)
		expect(listed.body.error.code).toBe("NO_LEASE")
	})

	it("pins the leased run only once its agents finished", async () => {
		const context = rig([seeded(13)])
		const session = await signIn(context.services)
		await call(context.services, { path: "lease", session })
		const early = await call(context.services, { path: "pin", session })
		expect(early.status).toBe(409)
		expect(early.body.error.code).toBe("RUN_NOT_COMPLETE")
		expect(context.pinStore.docs.size).toBe(0)
	})

	it("pins a completed leased run and records the presenter", async () => {
		const manifests = [seeded(13)]
		const context = rig(manifests)
		const session = await signIn(context.services)
		await call(context.services, { path: "lease", session })
		manifests[0] = seeded(13, {
			state: "used",
			hasAgentRun: true,
			agentRunState: "complete",
		})
		const done = await call(context.services, { path: "pin", session })
		expect(done.status).toBe(200)
		expect(context.pinStore.docs.get("public")).toMatchObject({
			runId: "run-13",
		})
	})

	it("decides nothing on the run public mode plays back, so a pinned page cannot change under visitors", async () => {
		const manifests = [seeded(13)]
		const context = rig(manifests)
		const session = await signIn(context.services)
		await call(context.services, { path: "lease", session })
		manifests[0] = seeded(13, {
			state: "used",
			hasAgentRun: true,
			agentRunState: "complete",
		})
		await call(context.services, { path: "pin", session })
		for (const decision of ["approve", "reject"]) {
			const refused = await call(context.services, {
				path: "proposals/decide",
				session,
				body: { operationId: "op-1", decision },
			})
			expect(refused.status).toBe(409)
			expect(refused.body.error.code).toBe("RUN_PINNED")
		}
		expect(context.client.approveProposal).not.toHaveBeenCalled()
		expect(context.client.rejectProposal).not.toHaveBeenCalled()
		const listed = await call(context.services, {
			method: "GET",
			path: "proposals",
			session,
		})
		expect(listed.status).toBe(200)
	})
})
