import { beforeEach, describe, expect, it, vi } from "vitest"

const postJsonMock = vi.hoisted(() => vi.fn())

type EmbeddingsRemoteFetchModule = typeof import("./embeddings-remote-fetch.js")

let fetchRemoteEmbeddingVectors: EmbeddingsRemoteFetchModule["fetchRemoteEmbeddingVectors"]

describe("fetchRemoteEmbeddingVectors", () => {
	beforeEach(async () => {
		vi.resetModules()
		vi.doMock("./post-json.js", () => ({
			postJson: postJsonMock,
		}))
		;({ fetchRemoteEmbeddingVectors } = await import(
			"./embeddings-remote-fetch.js"
		))
		postJsonMock.mockReset()
	})

	it("maps remote embedding response data to vectors", async () => {
		postJsonMock.mockImplementationOnce(async (params) => {
			return await params.parse({
				data: [{ embedding: [0.1, 0.2] }, {}, { embedding: [0.3] }],
			})
		})

		const vectors = await fetchRemoteEmbeddingVectors({
			url: "https://memory.example/v1/embeddings",
			headers: { Authorization: "Bearer test" },
			body: { input: ["one", "two", "three"] },
			errorPrefix: "embedding fetch failed",
		})

		// Vectors are now L2-normalized by fetchRemoteEmbeddingVectors
		expect(vectors[0][0]).toBeCloseTo(0.4472135954999579)
		expect(vectors[0][1]).toBeCloseTo(0.8944271909999159)
		expect(vectors[1]).toEqual([])
		expect(vectors[2]).toEqual([1])
		expect(postJsonMock).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "https://memory.example/v1/embeddings",
				headers: { Authorization: "Bearer test" },
				body: { input: ["one", "two", "three"] },
				errorPrefix: "embedding fetch failed",
			}),
		)
	})

	it("throws a status-rich error on non-ok responses", async () => {
		postJsonMock.mockRejectedValueOnce(
			new Error("embedding fetch failed: 403 forbidden"),
		)

		await expect(
			fetchRemoteEmbeddingVectors({
				url: "https://memory.example/v1/embeddings",
				headers: {},
				body: { input: ["one"] },
				errorPrefix: "embedding fetch failed",
			}),
		).rejects.toThrow("embedding fetch failed: 403 forbidden")
	})
})
