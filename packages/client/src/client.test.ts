import { afterEach, describe, expect, it, vi } from "vitest"
import { MdbrainClient } from "./index.js"

describe("MdbrainClient public contract", () => {
	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	it("does not expose Memongo control operations", () => {
		const client = new MdbrainClient()

		expect(client).not.toHaveProperty("status")
		expect(client).not.toHaveProperty("probeEmbedding")
		expect(client).not.toHaveProperty("probeVector")
	})

	it("bounds requests with the default deadline", async () => {
		vi.useFakeTimers()
		const fetchMock = vi.fn(
			(_input: string | URL | Request, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => reject(init.signal?.reason),
						{ once: true },
					)
				}),
		)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const request = client.search({ query: "deadline" })
		const rejection = expect(request).rejects.toMatchObject({
			code: "DEADLINE_EXCEEDED",
		})
		await vi.advanceTimersByTimeAsync(10_000)

		await rejection
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it("cancels a call from the caller signal", async () => {
		const fetchMock = vi.fn(
			(_input: string | URL | Request, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => reject(init.signal?.reason),
						{ once: true },
					)
				}),
		)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()
		const controller = new AbortController()

		const request = client.search(
			{ query: "cancel" },
			{ signal: controller.signal },
		)
		const rejection = expect(request).rejects.toMatchObject({
			code: "REQUEST_ABORTED",
		})
		controller.abort()

		await rejection
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it("retries a safe read after a transient response", async () => {
		vi.useFakeTimers()
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response("busy", { status: 503 }))
			.mockResolvedValueOnce(Response.json({ results: [] }))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const request = client.search({ query: "retry" })
		await vi.advanceTimersByTimeAsync(200)

		await expect(request).resolves.toEqual({ results: [] })
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("does not retry a mutation without an idempotency contract", async () => {
		vi.useFakeTimers()
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response("busy", { status: 503 }))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const request = client.writeStructured({ entry: { type: "preference" } })
		const rejection = expect(request).rejects.toMatchObject({ status: 503 })
		await vi.advanceTimersByTimeAsync(1_000)

		await rejection
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it("retries an idempotent write with the same key and body", async () => {
		vi.useFakeTimers()
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response("busy", { status: 503 }))
			.mockResolvedValueOnce(
				Response.json({ ok: true, eventId: "evt-1", chunkCreated: true }),
			)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const request = client.add({
			content: "same request",
			idempotencyKey: "key-1",
		})
		await vi.advanceTimersByTimeAsync(200)

		await expect(request).resolves.toMatchObject({ eventId: "evt-1" })
		const firstInit = fetchMock.mock.calls[0]?.[1]
		const secondInit = fetchMock.mock.calls[1]?.[1]
		expect(firstInit?.body).toBe(secondInit?.body)
		expect(firstInit?.headers).toMatchObject({ "Idempotency-Key": "key-1" })
		expect(secondInit?.headers).toMatchObject({ "Idempotency-Key": "key-1" })
	})

	it("retries a safe read after a transport failure", async () => {
		vi.useFakeTimers()
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new TypeError("connection reset"))
			.mockResolvedValueOnce(Response.json({ results: [] }))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const request = client.search({ query: "transport retry" })
		const resolution = expect(request).resolves.toEqual({ results: [] })
		await vi.advanceTimersByTimeAsync(200)

		await resolution
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("retries a safe read when the response body transport fails", async () => {
		vi.useFakeTimers()
		const brokenBody = new ReadableStream({
			start(controller) {
				controller.error(new TypeError("body connection reset"))
			},
		})
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(brokenBody, {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(Response.json({ results: [] }))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const request = client.search({ query: "body retry" })
		const resolution = expect(request).resolves.toEqual({ results: [] })
		await vi.advanceTimersByTimeAsync(200)

		await resolution
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("honors Retry-After when it fits a per-call deadline", async () => {
		vi.useFakeTimers()
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response("rate limited", {
					status: 429,
					headers: { "Retry-After": "1" },
				}),
			)
			.mockResolvedValueOnce(Response.json({ results: [] }))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient({ defaultDeadlineMs: 50 })

		const request = client.search(
			{ query: "retry after" },
			{ timeoutMs: 1_500 },
		)
		const resolution = expect(request).resolves.toEqual({ results: [] })
		await vi.advanceTimersByTimeAsync(999)
		expect(fetchMock).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1)

		await resolution
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("does not wait for Retry-After beyond the call deadline", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			new Response("rate limited", {
				status: 429,
				headers: { "Retry-After": "2" },
			}),
		)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		await expect(
			client.search({ query: "too late" }, { timeoutMs: 500 }),
		).rejects.toMatchObject({ status: 429 })
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it("shares one deadline across wiki apply create and update attempts", async () => {
		vi.useFakeTimers()
		let patchSignal: AbortSignal | null = null
		const fetchMock = vi.fn(
			(_input: string | URL | Request, init?: RequestInit) => {
				if (!patchSignal) {
					patchSignal = init?.signal ?? null
					return new Promise<Response>((resolve) => {
						setTimeout(
							() => resolve(new Response("duplicate", { status: 409 })),
							800,
						)
					})
				}
				patchSignal = init?.signal ?? null
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => reject(init.signal?.reason),
						{ once: true },
					)
				})
			},
		)
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		const request = client.wikiApply(
			{
				kind: "note",
				title: "Deadline",
				slug: "deadline",
				summary: "Deadline",
				body: "Deadline",
				frontmatter: { type: "note" },
				scope: "workspace",
				scopeRef: "test",
				trustTier: "standard",
			},
			{ timeoutMs: 1_000 },
		)
		const rejection = expect(request).rejects.toMatchObject({
			code: "DEADLINE_EXCEEDED",
		})
		await vi.advanceTimersByTimeAsync(800)
		await vi.advanceTimersByTimeAsync(200)
		const abortedAtDeadline = patchSignal?.aborted
		await vi.advanceTimersByTimeAsync(800)

		await rejection
		expect(abortedAtDeadline).toBe(true)
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("does not start a wiki update after its deadline is exhausted", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response("duplicate", { status: 409 }))
			.mockResolvedValueOnce(Response.json({ ok: true }))
		vi.stubGlobal("fetch", fetchMock)
		const client = new MdbrainClient()

		await expect(
			client.wikiApply(
				{
					kind: "note",
					title: "Expired",
					slug: "expired",
					summary: "Expired",
					body: "Expired",
					frontmatter: { type: "note" },
					scope: "workspace",
					scopeRef: "test",
					trustTier: "standard",
				},
				{ timeoutMs: 0 },
			),
		).rejects.toMatchObject({ code: "DEADLINE_EXCEEDED" })
		expect(fetchMock).toHaveBeenCalledTimes(0)
	})
})
