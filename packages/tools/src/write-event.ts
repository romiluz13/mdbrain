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

async function writeEvent(
	options: WriteEventOptions,
	role: "user" | "assistant",
	body: string,
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
): void {
	void writeEvent(options, role, body).catch(() => {})
}
