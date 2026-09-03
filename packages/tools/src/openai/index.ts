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

/* ------------------------------------------------------------------ */
/*  OpenAI-compatible chat message shape                              */
/* ------------------------------------------------------------------ */

interface ChatMessage {
	role: string
	content: string | null
}

interface ChatCreateParams {
	messages: ChatMessage[]
	[key: string]: unknown
}

interface ChatChoice {
	message: ChatMessage
}

interface ChatCompletion {
	choices: ChatChoice[]
	[key: string]: unknown
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function extractUserQuery(messages: ChatMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "user" && messages[i].content) {
			return messages[i].content!
		}
	}
	return undefined
}

/**
 * Builds the message list with retrieved memory injected as a user-role
 * message carrying fenced, provenance-labeled data. The memory message is
 * inserted directly BEFORE the final user message (or appended when no
 * user turn exists) so it never carries system authority and the user's
 * own turn remains the last instruction-bearing message.
 */
function withMemoryMessage(
	messages: ChatMessage[],
	rendered: string,
): ChatMessage[] {
	const memoryMessage = {
		role: "user" as const,
		content: renderMemoryMessageContent(rendered),
	}
	const lastUserIndex = findLastMessageIndexByRole(messages, "user")
	if (lastUserIndex === -1) {
		return [...messages, memoryMessage]
	}
	return [
		...messages.slice(0, lastUserIndex),
		memoryMessage,
		...messages.slice(lastUserIndex),
	]
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

/**
 * Wrap an OpenAI client instance so that every `chat.completions.create()`
 * call is enriched with Mdbrain memory context. No runtime `openai` dependency
 * is required: the middleware accepts any object matching the shape.
 */
export function createOpenAIMiddleware<
	T extends { chat: { completions: { create: (...args: any[]) => any } } },
>(client: T, options: MdbrainCoreOptions): T {
	const completionsProxy = new Proxy(client.chat.completions, {
		get(target, prop, receiver) {
			if (prop === "create") {
				return async (params: ChatCreateParams, ...rest: unknown[]) => {
					const userQuery = extractUserQuery(params.messages)
					const rendered = await fetchRenderedContextBundle(options, userQuery)

					const enrichedMessages = rendered
						? withMemoryMessage(params.messages, rendered)
						: params.messages

					const result = await (target.create as any)(
						{ ...params, messages: enrichedMessages },
						...rest,
					)

					// Fire-and-forget: save user message
					if (userQuery) {
						fireWriteEvent(
							options,
							"user",
							userQuery,
							USER_INPUT_WRITE_METADATA,
						)
					}

					// Only extract assistant text for non-streaming calls
					if (!params.stream) {
						const completion = result as ChatCompletion
						const assistantText =
							completion?.choices?.[0]?.message?.content ?? ""
						if (assistantText) {
							fireWriteEvent(
								options,
								"assistant",
								assistantText,
								MODEL_OUTPUT_WRITE_METADATA,
							)
						}
					}
					// Streaming calls: context is injected but assistant text
					// is not saved (stream chunks are not interceptable via Proxy).
					// Use writeEvent manually or use the Vercel AI SDK middleware
					// which supports wrapStream natively.

					return result
				}
			}
			return Reflect.get(target, prop, receiver)
		},
	})

	const chatProxy = new Proxy(client.chat, {
		get(target, prop, receiver) {
			if (prop === "completions") {
				return completionsProxy
			}
			return Reflect.get(target, prop, receiver)
		},
	})

	return new Proxy(client, {
		get(target, prop, receiver) {
			if (prop === "chat") {
				return chatProxy
			}
			return Reflect.get(target, prop, receiver)
		},
	})
}
