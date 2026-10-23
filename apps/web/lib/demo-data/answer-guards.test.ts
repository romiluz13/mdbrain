// Ticket 342-r1, test-first (R4): the answer route's request guard. A
// cross-site text/plain form post is a simple request: no preflight, so
// another site can spend the answer budget and a visitor's question count
// unless the route itself refuses it.
import { describe, expect, it } from "vitest"
import { answerRequestDenied } from "./answer-guards.js"

const URL_STRING = "https://demo.example.org/api/demo/answers"

const post = (headers: Record<string, string>): Request =>
	new Request(URL_STRING, { method: "POST", headers })

describe("answerRequestDenied", () => {
	it("allows a same-origin JSON post", () => {
		expect(
			answerRequestDenied(
				post({
					"content-type": "application/json",
					"sec-fetch-site": "same-origin",
					origin: "https://demo.example.org",
				}),
			),
		).toBe(null)
	})

	it("allows a JSON post without fetch metadata, as a non-browser client sends", () => {
		expect(
			answerRequestDenied(post({ "content-type": "application/json" })),
		).toBe(null)
	})

	it("allows the JSON content type with a charset parameter", () => {
		expect(
			answerRequestDenied(
				post({ "content-type": "application/json; charset=utf-8" }),
			),
		).toBe(null)
	})

	it("refuses a body that is not JSON, as a cross-site form post sends", () => {
		const denial = answerRequestDenied(post({ "content-type": "text/plain" }))
		expect(denial).toEqual({
			status: 415,
			code: "ANSWER_UNSUPPORTED_MEDIA",
			message: expect.any(String),
		})
		// No content type at all is not JSON either.
		expect(answerRequestDenied(post({}))).toMatchObject({
			status: 415,
		})
	})

	it("refuses a request whose fetch metadata names another site", () => {
		expect(
			answerRequestDenied(
				post({
					"content-type": "application/json",
					"sec-fetch-site": "cross-site",
				}),
			),
		).toMatchObject({ status: 403, code: "ANSWER_CROSS_SITE" })
	})

	it("refuses a request whose Origin header is another origin, or not a URL", () => {
		expect(
			answerRequestDenied(
				post({
					"content-type": "application/json",
					origin: "https://elsewhere.example",
				}),
			),
		).toMatchObject({ status: 403, code: "ANSWER_CROSS_SITE" })
		expect(
			answerRequestDenied(
				post({ "content-type": "application/json", origin: "not a url" }),
			),
		).toMatchObject({ status: 403, code: "ANSWER_CROSS_SITE" })
	})

	it("allows a same-origin post whose server URL names another host, as next start reports localhost", () => {
		const behind = (headers: Record<string, string>): Request =>
			new Request("http://localhost:3060/api/demo/answers", {
				method: "POST",
				headers: { "content-type": "application/json", ...headers },
			})
		expect(
			answerRequestDenied(
				behind({ host: "127.0.0.1:3060", origin: "http://127.0.0.1:3060" }),
			),
		).toBeNull()
		expect(
			answerRequestDenied(
				behind({
					host: "127.0.0.1:3060",
					"x-forwarded-host": "demo.example.org",
					origin: "https://demo.example.org",
				}),
			),
		).toBeNull()
		expect(
			answerRequestDenied(
				behind({ host: "127.0.0.1:3060", origin: "http://127.0.0.1:4000" }),
			),
		).toMatchObject({ status: 403, code: "ANSWER_CROSS_SITE" })
	})
})
