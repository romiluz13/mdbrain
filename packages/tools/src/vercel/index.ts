import type {
	LanguageModelV2,
	LanguageModelV2CallOptions,
} from "@ai-sdk/provider"
import { wrapLanguageModel, type LanguageModelMiddleware } from "ai"
import {
	fetchRenderedContextBundle,
	findLastMessageIndexByRole,
	renderMemoryMessageContent,
	type MdbrainCoreOptions,
} from "../memory-context.js"
import {
	fireWriteEvent,
	MODEL_OUTPUT_WRITE_METADATA,
	USER_INPUT_WRITE_METADATA,
} from "../write-event.js"

export type { MdbrainCoreOptions } from "../memory-context.js"
export type { MdbrainWriteFailure } from "../write-event.js"

/** @deprecated Test helper retained for compatibility; clears the shared
 *  tenant-isolated context cache. */
export { _clearContextCache as _clearCache } from "../memory-context.js"

/* ------------------------------------------------------------------ */
/*  Helpers: extract user query, extract response text                */
/* ------------------------------------------------------------------ */

function extractUserQuery(
	prompt: LanguageModelV2CallOptions["prompt"],
): string | undefined {
	for (let i = prompt.length - 1; i >= 0; i--) {
		const msg = prompt[i]
		if (msg.role === "user") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text
			}
		}
	}
	return undefined
}

function extractResponseText(
	content: Array<{ type: string; text?: string }>,
): string {
	return content
		.filter((c) => c.type === "text" && c.text)
		.map((c) => c.text!)
		.join("")
}

/* ------------------------------------------------------------------ */
/*  Memory injection                                                  */
/* ------------------------------------------------------------------ */

/**
 * Builds the prompt with retrieved memory injected as a user-role message
 * carrying fenced, provenance-labeled data. The memory message is inserted
 * directly BEFORE the final user message (or appended when no user turn
 * exists) so it never carries system authority and the user's own turn
 * remains the last instruction-bearing message.
 */
function withMemoryMessage(
	prompt: LanguageModelV2CallOptions["prompt"],
	rendered: string,
): LanguageModelV2CallOptions["prompt"] {
	const memoryMessage = {
		role: "user" as const,
		content: [
			{ type: "text" as const, text: renderMemoryMessageContent(rendered) },
		],
	}
	const lastUserIndex = findLastMessageIndexByRole(prompt, "user")
	if (lastUserIndex === -1) {
		return [...prompt, memoryMessage]
	}
	return [
		...prompt.slice(0, lastUserIndex),
		memoryMessage,
		...prompt.slice(lastUserIndex),
	]
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export function withMdbrain(
	model: LanguageModelV2,
	options: MdbrainCoreOptions,
): LanguageModelV2 {
	const middleware: LanguageModelMiddleware = {
		transformParams: async ({ params }) => {
			const userQuery = extractUserQuery(params.prompt)
			const rendered = await fetchRenderedContextBundle(options, userQuery)

			if (!rendered) return params

			return { ...params, prompt: withMemoryMessage(params.prompt, rendered) }
		},

		wrapGenerate: async ({ doGenerate, params }) => {
			const result = await doGenerate()

			// Fire-and-forget: save user message
			const userQuery = extractUserQuery(params.prompt)
			if (userQuery) {
				fireWriteEvent(options, "user", userQuery, USER_INPUT_WRITE_METADATA)
			}

			// Fire-and-forget: save assistant response
			const responseText = extractResponseText(
				result.content as Array<{ type: string; text?: string }>,
			)
			if (responseText) {
				fireWriteEvent(
					options,
					"assistant",
					responseText,
					MODEL_OUTPUT_WRITE_METADATA,
				)
			}

			return result
		},

		wrapStream: async ({ doStream, params }) => {
			const result = await doStream()

			// Fire-and-forget: save user message
			const userQuery = extractUserQuery(params.prompt)
			if (userQuery) {
				fireWriteEvent(options, "user", userQuery, USER_INPUT_WRITE_METADATA)
			}

			// Collect streamed text chunks and save assistant message after stream ends
			const originalStream = result.stream
			const chunks: string[] = []
			const transformedStream = originalStream.pipeThrough(
				new TransformStream({
					transform(chunk, controller) {
						if (chunk.type === "text-delta" && chunk.delta) {
							chunks.push(chunk.delta)
						}
						controller.enqueue(chunk)
					},
					flush() {
						const fullText = chunks.join("")
						if (fullText) {
							fireWriteEvent(
								options,
								"assistant",
								fullText,
								MODEL_OUTPUT_WRITE_METADATA,
							)
						}
					},
				}),
			)

			return { ...result, stream: transformedStream }
		},
	}

	return wrapLanguageModel({ model, middleware })
}
