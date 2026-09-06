// Maintenance LLM adapters: bridges the OpenAI-compatible adapter
// (scripts/lib/openai-compatible-llm.ts) to the wiki-engine maintenance
// contracts — LlmGenerateFn (git-diff regeneration) and DreamerClassifier
// (phase 3 classification + phase 4 claim extraction), both with
// JSON-Schema-constrained output validated locally.

import type { DreamerClassifier, LlmGenerateFn } from "@mdbrain/wiki-engine"
import {
	chatJson,
	type ChatJsonOptions,
	type LlmConfig,
} from "./openai-compatible-llm.js"
import type { JsonSchema } from "./json-schema.js"

// ---------------------------------------------------------------------------
// Git-diff maintenance: page regeneration
// ---------------------------------------------------------------------------

const GIT_DIFF_SCHEMA: JsonSchema = {
	type: "object",
	additionalProperties: false,
	required: ["title", "summary", "body", "claims"],
	properties: {
		title: {
			type: ["string", "null"],
			description: "Page title; null keeps the existing/source-derived title",
		},
		summary: { type: "string" },
		body: { type: "string" },
		claims: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["text", "confidence"],
				properties: {
					text: { type: "string" },
					confidence: {
						type: ["number", "null"],
						minimum: 0,
						maximum: 1,
					},
				},
			},
		},
	},
}

const GIT_DIFF_SYSTEM_PROMPT = `You maintain a governed knowledge wiki. You receive one changed source file and, when it exists, the current wiki page that tracks it. Regenerate the page content from the changed source.
Rules:
- summary: one or two sentences describing what this source is/does now.
- body: markdown body for the page, derived only from the changed source.
- claims: discrete, self-contained factual statements from the source, each with your confidence in [0, 1]. Only include facts actually present in the source.
- title: a short page title, or null to keep the existing title.
- Output ONLY the JSON object matching the schema. No prose, no code fences.`

/** Adapts the adapter to wiki-engine's LlmGenerateFn (git-diff path). */
export function asLlmGenerateFn(
	config: LlmConfig,
	options?: ChatJsonOptions,
): LlmGenerateFn {
	return async (input) => {
		const generated = await chatJson<{
			title: string | null
			summary: string
			body: string
			claims: Array<{ text: string; confidence: number | null }>
		}>(
			config,
			{
				schemaName: "git_diff_page_regeneration",
				schema: GIT_DIFF_SCHEMA,
				system: GIT_DIFF_SYSTEM_PROMPT,
				user: JSON.stringify(
					{
						sourceFile: input.sourceFile,
						changedSnippet: input.changedSnippet,
						currentPage: input.currentPage ?? null,
					},
					null,
					2,
				),
				maxTokens: 2048,
			},
			options,
		)
		return {
			title: generated.title ?? undefined,
			summary: generated.summary,
			body: generated.body,
			claims: generated.claims.map((c) => ({
				text: c.text,
				confidence: c.confidence ?? undefined,
			})),
		}
	}
}

// ---------------------------------------------------------------------------
// Dreamer (T14): phase 3 classification + phase 4 claim extraction
// ---------------------------------------------------------------------------

const DREAMER_SCHEMA: JsonSchema = {
	type: "object",
	additionalProperties: false,
	required: ["injection", "claims"],
	properties: {
		injection: {
			type: "string",
			enum: ["ignore", "new", "update", "contradiction"],
		},
		claims: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["text", "confidence"],
				properties: {
					text: { type: "string" },
					confidence: { type: "number", minimum: 0, maximum: 1 },
				},
			},
		},
	},
}

const DREAMER_SYSTEM_PROMPT = `You classify events for a governed knowledge wiki (Dreamer phases 3 and 4).
You receive one event and, when a semantically similar page exists, that page's current content.
First classify the event's injection type:
- "ignore": chit-chat or transient information with no durable factual value.
- "new": durable facts not yet captured anywhere.
- "update": durable facts that extend or refine what the page already says.
- "contradiction": durable facts that conflict with what the page says.
Then extract the event's claims: discrete, self-contained factual statements, each with your confidence in [0, 1].
For "ignore", return an empty claims array. For "contradiction" and "update", extract only the new/conflicting facts.
Output ONLY the JSON object matching the schema. No prose, no code fences.`

/** Adapts the adapter to wiki-engine's DreamerClassifier (phases 3 + 4). */
export function asDreamerClassifier(
	config: LlmConfig,
	options?: ChatJsonOptions,
): DreamerClassifier {
	return async ({ event, existingPage }) => {
		const classification = await chatJson<{
			injection: "ignore" | "new" | "update" | "contradiction"
			claims: Array<{ text: string; confidence: number }>
		}>(
			config,
			{
				schemaName: "dreamer_event_classification",
				schema: DREAMER_SCHEMA,
				system: DREAMER_SYSTEM_PROMPT,
				user: JSON.stringify(
					{
						event: { id: event.id, text: event.text },
						existingPage: existingPage ?? null,
					},
					null,
					2,
				),
				maxTokens: 1024,
			},
			options,
		)
		return classification
	}
}
