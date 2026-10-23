// Ticket 342-r1 (R4): the answer route's request guard. A cross-site
// text/plain form post is a simple request: no preflight, no CORS check,
// so the browser's own protections would not stop another site from
// spending the answer budget or a visitor's hourly count. The route
// therefore demands the one JSON content type it reads, and refuses fetch
// metadata or an Origin that names another site, before any env read.
export type AnswerRequestDenial = {
	status: 415 | 403
	code: "ANSWER_UNSUPPORTED_MEDIA" | "ANSWER_CROSS_SITE"
	message: string
}

/** application/json, alone or with parameters such as charset. */
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/i

const CROSS_SITE_MESSAGE = "the answer route only serves its own site"

/** An Origin header value is a URL whose origin must be the request's own. */
function namesAnotherOrigin(request: Request, origin: string): boolean {
	try {
		return new URL(origin).origin !== new URL(request.url).origin
	} catch {
		// Not a URL: treat it as a foreign origin and refuse.
		return true
	}
}

export function answerRequestDenied(
	request: Request,
): AnswerRequestDenial | null {
	const contentType = (request.headers.get("content-type") ?? "").trim()
	if (!JSON_CONTENT_TYPE.test(contentType)) {
		return {
			status: 415,
			code: "ANSWER_UNSUPPORTED_MEDIA",
			message: "the answer route reads one JSON body: a question as text",
		}
	}
	const fetchSite = request.headers.get("sec-fetch-site")
	if (fetchSite !== null && fetchSite !== "same-origin") {
		return {
			status: 403,
			code: "ANSWER_CROSS_SITE",
			message: CROSS_SITE_MESSAGE,
		}
	}
	const origin = request.headers.get("origin")
	if (origin !== null && namesAnotherOrigin(request, origin)) {
		return {
			status: 403,
			code: "ANSWER_CROSS_SITE",
			message: CROSS_SITE_MESSAGE,
		}
	}
	return null
}
