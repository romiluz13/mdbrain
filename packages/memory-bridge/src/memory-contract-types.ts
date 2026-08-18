import type { MemoryScope } from "@mdbrain/lib/types/memory"

export type MemoryActorRole = "user" | "assistant" | "system"
export type MemoryFeedbackSignal = "confirm" | "correct" | "irrelevant"
export type MemoryLifecycleState = "active" | "invalidated" | "conflicted"

type MemoryStableHandleBase = {
	id: string
	agentId: string
	scope: MemoryScope
	scopeRef: string
	revision: number
	state: MemoryLifecycleState
	validFrom?: Date
	validTo?: Date
	updatedAt?: Date
}

export type MemoryStructuredStableHandle = MemoryStableHandleBase & {
	family: "structured"
	structured: { type: string; key: string }
}

export type MemoryProcedureStableHandle = MemoryStableHandleBase & {
	family: "procedure"
	procedure: { procedureId: string }
}

export type MemoryStableHandle =
	| MemoryStructuredStableHandle
	| MemoryProcedureStableHandle

export type MemorySourceAgent = {
	id: string
	name: string
	runId?: string
}

export type MemoryArtifact = {
	type: "solution" | "formula" | "command" | "config" | "snippet"
	title: string
	content: string
}

export type StructuredMemoryEntry = {
	type:
		| "decision"
		| "preference"
		| "person"
		| "todo"
		| "fact"
		| "project"
		| "architecture"
		| "contact"
		| "milestone"
		| "problem"
		| "emotional"
		| "identity"
		| "instruction"
		| "custom"
	key: string
	value: string
	context?: string
	confidence?: number
	source?: "agent" | "user" | "session" | "ingestion"
	sessionId?: string
	agentId: string
	tags?: string[]
	scope?: MemoryScope
	scopeRef?: string
	workspaceDir?: string
	userId?: string
	tenantId?: string
	salience?: "critical" | "high" | "normal" | "low"
	temporalScope?: "ongoing" | "bounded" | "permanent" | "transient"
	provenance?: Record<string, unknown>
	sourceEventIds?: string[]
	state?: MemoryLifecycleState
	validTo?: Date
	reviewAt?: Date
	lastConfirmedAt?: Date
	sourceReliability?: number
	sourceAgent?: MemorySourceAgent
	artifact?: MemoryArtifact
}

export type StructuredMemoryLifecyclePatch = Partial<
	Pick<
		StructuredMemoryEntry,
		| "value"
		| "context"
		| "confidence"
		| "source"
		| "sessionId"
		| "tags"
		| "salience"
		| "temporalScope"
		| "provenance"
		| "sourceEventIds"
		| "validTo"
		| "reviewAt"
		| "lastConfirmedAt"
		| "sourceReliability"
		| "sourceAgent"
		| "artifact"
	>
>

export type ProcedureEntry = {
	procedureId: string
	name: string
	intentTags?: string[]
	triggerQueries?: string[]
	steps: string[]
	successSignals?: string[]
	confidence?: number
	state?: MemoryLifecycleState
	provenance?: Record<string, unknown>
	sourceEventIds?: string[]
	agentId: string
	scope?: MemoryScope
	scopeRef?: string
	workspaceDir?: string
	sessionId?: string
	userId?: string
	tenantId?: string
	sourceAgent?: MemorySourceAgent
}

export type ProcedureLifecyclePatch = Partial<
	Pick<
		ProcedureEntry,
		| "name"
		| "intentTags"
		| "triggerQueries"
		| "steps"
		| "successSignals"
		| "confidence"
		| "provenance"
		| "sourceEventIds"
		| "sourceAgent"
	>
>

type MemoryLifecycleStructuredData = Omit<
	StructuredMemoryEntry,
	"agentId" | "scope" | "scopeRef" | "workspaceDir" | "userId" | "tenantId"
>
type MemoryLifecycleProcedureData = Omit<
	ProcedureEntry,
	"agentId" | "scope" | "scopeRef" | "workspaceDir" | "userId" | "tenantId"
> & {
	successCount?: number
	failCount?: number
	lastSuccessAt?: Date
	lastFailureAt?: Date
}

export type MemoryLifecycleItem =
	| {
			family: "structured"
			handle: MemoryStructuredStableHandle
			data: MemoryLifecycleStructuredData
			createdAt?: Date
			updatedAt?: Date
	  }
	| {
			family: "procedure"
			handle: MemoryProcedureStableHandle
			data: MemoryLifecycleProcedureData
			createdAt?: Date
			updatedAt?: Date
	  }

export type MemoryLifecycleHistoryEntry = MemoryLifecycleItem & {
	historyKind: "revision" | "current"
	supersededAt?: Date
}

export type ConversationRecallResponse = {
	results: Array<{
		citation: Record<string, unknown>
		score?: number
		matchType: "filter" | "semantic" | "hybrid"
		scoreDetails?: Record<string, unknown>
	}>
	metadata: {
		totalMatched: number
		queryUsed?: string
		filtersApplied: string[]
		searchMethod: "standard" | "semantic" | "hybrid"
		durationMs: number
	}
}

export type MemoryProviderStatus = {
	backend: string
	provider: string
	model?: string
	files?: number
	chunks?: number
	sources?: string[]
	[key: string]: unknown
}

export type MemoryStateFamily = {
	profile: Record<string, unknown>
	blocks: Record<string, unknown>
	bundle: Record<string, unknown>
}
