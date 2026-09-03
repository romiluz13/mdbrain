export interface MdbrainWriteFailure {
	role: "user" | "assistant"
	kind: "http" | "network"
	status?: number
	code: "HTTP_ERROR" | "NETWORK_ERROR"
	message: string
	attempts: number
}

export interface WriteEventOptions {
	apiUrl: string
	apiKey: string
	userId: string
	agentId?: string
	onWriteError?: (failure: MdbrainWriteFailure) => void | Promise<void>
}

/**
 * Provenance metadata attached to adapter-initiated write events so
 * retrieved/promoted content can later be distinguished from raw user
 * input and from generated model output.
 */
export type WriteEventMetadata = { provenance: "user-input" | "model-output" }

export const USER_INPUT_WRITE_METADATA: WriteEventMetadata = {
	provenance: "user-input",
}

export const MODEL_OUTPUT_WRITE_METADATA: WriteEventMetadata = {
	provenance: "model-output",
}

async function writeEvent(
	options: WriteEventOptions,
	role: "user" | "assistant",
	body: string,
	metadata?: WriteEventMetadata,
): Promise<void> {
	const idempotencyKey = globalThis.crypto.randomUUID()
	const requestInit: RequestInit = {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${options.apiKey}`,
			"Idempotency-Key": idempotencyKey,
		},
		body: JSON.stringify({
			role,
			body,
			agentId: options.agentId ?? options.userId,
			...(metadata ? { metadata } : {}),
		}),
	}
	const url = `${options.apiUrl}/v1/write-event`
	let failure: MdbrainWriteFailure | undefined

	for (let attempts = 1; attempts <= 2; attempts++) {
		try {
			const response = await fetch(url, requestInit)
			if (response.ok) return

			const retryable =
				response.status === 408 ||
				response.status === 429 ||
				(response.status >= 500 && response.status <= 599)
			if (attempts === 1 && retryable) continue

			failure = {
				role,
				kind: "http",
				status: response.status,
				code: "HTTP_ERROR",
				message: `Write request returned HTTP ${response.status}`,
				attempts,
			}
			break
		} catch {
			if (attempts === 1) continue

			failure = {
				role,
				kind: "network",
				code: "NETWORK_ERROR",
				message: "Network request failed",
				attempts,
			}
			break
		}
	}

	if (failure) {
		if (!options.onWriteError) {
			console.warn("[mdbrain] write-event failed:", failure)
			return
		}

		try {
			await options.onWriteError(failure)
		} catch {
			console.warn("[mdbrain] write-event failed:", failure)
		}
	}
}

export function fireWriteEvent(
	options: WriteEventOptions,
	role: "user" | "assistant",
	body: string,
	metadata?: WriteEventMetadata,
): void {
	void writeEvent(options, role, body, metadata).catch(() => {})
}
