// The only error shapes the demo proxy lets out. A failure upstream or on the
// wire is reduced to a status, an allowlisted code and a fixed message. No
// transport message, no upstream message text and no other upstream field
// reaches the browser: they can name hosts, paths, scopes and stored page
// titles.

type PublicError = { status: number; message: string }

// The codes the page can act on, each with the status and the message the
// proxy answers with. Any other upstream failure becomes UPSTREAM_ERROR.
const PASSED_THROUGH: Readonly<Record<string, PublicError>> = {
	WIKI_NOT_FOUND: {
		status: 404,
		message: "That page is not stored in this run.",
	},
	CITATION_NOT_FOUND: {
		status: 404,
		message: "That citation is not stored in this run.",
	},
	CITATION_UNRESOLVED: {
		status: 404,
		message: "The source could not be confirmed in this run.",
	},
	SEARCH_UNAVAILABLE: {
		status: 503,
		message: "Search is unavailable right now. Try again shortly.",
	},
	RATE_LIMITED: {
		status: 429,
		message: "Too many reads in a short time. Try again shortly.",
	},
}

export function proxyError(
	status: number,
	code: string,
	message: string,
): Response {
	return new Response(JSON.stringify({ error: { code, message } }), {
		status,
		headers: { "content-type": "application/json" },
	})
}

/** The answer when the upstream could not be reached at all. */
export function unreachableResponse(): Response {
	return proxyError(
		502,
		"UPSTREAM_UNREACHABLE",
		"The demo data service could not be reached.",
	)
}

function codeOf(text: string): string | null {
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		return null
	}
	if (typeof parsed !== "object" || parsed === null) {
		return null
	}
	const error = (parsed as { error?: unknown }).error
	if (typeof error !== "object" || error === null) {
		return null
	}
	const { code } = error as { code?: unknown }
	return typeof code === "string" ? code : null
}

/** Turns a non-2xx upstream answer into the proxy's own envelope. */
export async function upstreamFailureResponse(
	response: Response,
): Promise<Response> {
	const code = codeOf(await response.text())
	const known = code ? PASSED_THROUGH[code] : undefined
	if (!code || !known) {
		return proxyError(
			502,
			"UPSTREAM_ERROR",
			"The demo data service could not answer that read.",
		)
	}
	return proxyError(known.status, code, known.message)
}
