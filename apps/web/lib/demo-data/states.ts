// Typed states for every demo data read: loading, ready, empty, error and
// incomplete-run. Loaders return these instead of throwing or inventing
// fixture data, so the /demo page can render each case honestly.

export type IncompleteReason =
	| "RUN_NOT_CONFIGURED"
	| "RUN_NOT_READY"
	| "RUN_FAILED"
	| "AGENT_RUN_NOT_STARTED"
	| "AGENT_RUN_RUNNING"
	| "AGENT_RUN_INCOMPLETE"
	| "CONTRADICTION_NOT_READABLE"

export type DataState<T> =
	| { kind: "loading" }
	| { kind: "ready"; data: T }
	| { kind: "empty" }
	| { kind: "error"; code: string; status?: number; message: string }
	| {
			kind: "incomplete"
			reason: IncompleteReason
			state: string | null
			data?: T
	  }

export function isReady<T>(
	state: DataState<T>,
): state is { kind: "ready"; data: T } {
	return state.kind === "ready"
}

/** What a state carries to show: its data when ready, or the partial data an
 * incomplete run still has. */
export function dataOf<T>(state: DataState<T>): T | undefined {
	return state.kind === "ready" || state.kind === "incomplete"
		? state.data
		: undefined
}

/** Replaces every occurrence of a secret with "[redacted]". Used on upstream
 * error text before it can reach a response, a log line or a test assertion. */
export function redactSecret(text: string, secret: string): string {
	if (!secret) {
		return text
	}
	return text.split(secret).join("[redacted]")
}

/** Builds a ready state from data, or an error state from an upstream status,
 * with the secret redacted from the message. */
export function mapWithStatus<T>(
	result: { data: T } | { status: number; code: string; message: string },
	secret: string,
): DataState<T> {
	if ("data" in result) {
		return { kind: "ready", data: result.data }
	}
	return {
		kind: "error",
		code: result.code,
		status: result.status,
		message: redactSecret(result.message, secret),
	}
}
