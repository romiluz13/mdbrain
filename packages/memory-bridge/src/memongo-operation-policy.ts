export type MemongoOperationName =
	| "search"
	| "searchDetailed"
	| "searchKb"
	| "recallConversation"
	| "profile"
	| "hydrateActiveSlate"
	| "discoveryProjection"
	| "contextBundle"
	| "state"
	| "add"
	| "writeEvent"
	| "writeEvents"
	| "extract"
	| "writeStructured"
	| "writeProcedure"
	| "lifecycleGet"
	| "lifecycleUpdate"
	| "lifecycleDelete"
	| "lifecycleHistory"
	| "procedureOutcome"
	| "memoryFeedback"
	| "status"
	| "embeddingProbe"
	| "vectorProbe"

export type MemongoOperationPolicy = {
	method: "GET" | "POST"
	path: `/v1/${string}`
	kind: "read" | "write" | "control-read"
	credential: "tenant" | "control"
	idempotency: "none" | "header" | "per-item"
	retry: "never" | "same-key" | "transient"
}

const READ = {
	kind: "read",
	credential: "tenant",
	idempotency: "none",
	retry: "transient",
} as const

const WRITE = {
	kind: "write",
	credential: "tenant",
	idempotency: "none",
	retry: "never",
} as const

const CONTROL_READ = {
	kind: "control-read",
	credential: "control",
	idempotency: "none",
	retry: "transient",
} as const

export const MEMONGO_OPERATION_POLICIES = {
	search: { ...READ, method: "POST", path: "/v1/search" },
	searchDetailed: { ...READ, method: "POST", path: "/v1/search-detailed" },
	searchKb: { ...READ, method: "POST", path: "/v1/search-kb" },
	recallConversation: {
		...READ,
		method: "POST",
		path: "/v1/recall-conversation",
	},
	profile: { ...READ, method: "POST", path: "/v1/profile" },
	hydrateActiveSlate: {
		...READ,
		method: "POST",
		path: "/v1/hydrate-active-slate",
	},
	discoveryProjection: {
		...READ,
		method: "POST",
		path: "/v1/discovery-projection",
	},
	contextBundle: { ...READ, method: "POST", path: "/v1/context-bundle" },
	state: { ...READ, method: "GET", path: "/v1/state" },
	add: {
		...WRITE,
		method: "POST",
		path: "/v1/add",
		idempotency: "header",
		retry: "same-key",
	},
	writeEvent: {
		...WRITE,
		method: "POST",
		path: "/v1/write-event",
		idempotency: "header",
		retry: "same-key",
	},
	writeEvents: {
		...WRITE,
		method: "POST",
		path: "/v1/write-events",
		idempotency: "per-item",
		retry: "same-key",
	},
	extract: { ...WRITE, method: "POST", path: "/v1/extract" },
	writeStructured: {
		...WRITE,
		method: "POST",
		path: "/v1/write-structured",
	},
	writeProcedure: {
		...WRITE,
		method: "POST",
		path: "/v1/write-procedure",
	},
	lifecycleGet: { ...READ, method: "POST", path: "/v1/lifecycle/get" },
	lifecycleUpdate: {
		...WRITE,
		method: "POST",
		path: "/v1/lifecycle/update",
	},
	lifecycleDelete: {
		...WRITE,
		method: "POST",
		path: "/v1/lifecycle/delete",
	},
	lifecycleHistory: {
		...READ,
		method: "POST",
		path: "/v1/lifecycle/history",
	},
	procedureOutcome: {
		...WRITE,
		method: "POST",
		path: "/v1/procedures/outcome",
	},
	memoryFeedback: {
		...WRITE,
		method: "POST",
		path: "/v1/memory/feedback",
	},
	status: { ...CONTROL_READ, method: "GET", path: "/v1/status" },
	embeddingProbe: {
		...CONTROL_READ,
		method: "GET",
		path: "/v1/probes/embedding",
	},
	vectorProbe: {
		...CONTROL_READ,
		method: "GET",
		path: "/v1/probes/vector",
	},
} as const satisfies Record<MemongoOperationName, MemongoOperationPolicy>

export function getMemongoOperationPolicy(
	operation: MemongoOperationName,
): MemongoOperationPolicy {
	return MEMONGO_OPERATION_POLICIES[operation]
}
