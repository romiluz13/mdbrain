const contractFixtures = {
	corePaths: [
		"/health",
		"/ready",
		"/openapi.json",
		"/v1/search",
		"/v1/search-detailed",
		"/v1/recall-conversation",
		"/v1/search-kb",
		"/v1/add",
		"/v1/write-event",
		"/v1/extract",
		"/v1/write-structured",
		"/v1/write-procedure",
		"/v1/profile",
		"/v1/hydrate-active-slate",
		"/v1/discovery-projection",
		"/v1/context-bundle",
		"/v1/state",
		"/v1/lifecycle/get",
		"/v1/lifecycle/update",
		"/v1/lifecycle/delete",
		"/v1/lifecycle/history",
		"/v1/procedures/outcome",
		"/v1/memory/feedback",
		"/v1/admin/deliveries",
		"/v1/wiki",
		"/v1/wiki/{slug}",
		"/v1/wiki/revisions",
		"/v1/wiki/revisions/{revision}",
		"/v1/wiki/okf-import",
		"/v1/wiki/okf-export",
		"/v1/wiki/search",
		"/v1/wiki/lint",
	],
	removedTenantControlPaths: [
		"/v1/status",
		"/v1/probes/embedding",
		"/v1/probes/vector",
	],
	aliasCases: [
		{
			name: "search alias payload",
			path: "/v1/search",
			bridgeMock: "mdbrainBridgeSearch",
			body: {
				q: "remember this",
				containerTag: "user-123",
				maxResults: 3,
			},
			expected: {
				query: "remember this",
				maxResults: 3,
				sessionKey: "user-123",
			},
		},
		{
			name: "search explicit sessionKey alias",
			path: "/v1/search",
			bridgeMock: "mdbrainBridgeSearch",
			body: {
				query: "explicit scope",
				sessionKey: "session-7",
				limit: 2,
			},
			expected: {
				query: "explicit scope",
				maxResults: 2,
				sessionKey: "session-7",
			},
		},
		{
			name: "add containerTag alias",
			path: "/v1/add",
			bridgeMock: "mdbrainBridgeAdd",
			body: {
				content: "store this",
				containerTag: "account-42",
			},
			expected: {
				content: "store this",
				sessionId: "account-42",
			},
		},
		{
			name: "add explicit sessionId",
			path: "/v1/add",
			bridgeMock: "mdbrainBridgeAdd",
			body: {
				content: "store this",
				sessionId: "session-42",
			},
			expected: {
				content: "store this",
				sessionId: "session-42",
			},
		},
		{
			name: "profile containerTag alias",
			path: "/v1/profile",
			bridgeMock: "mdbrainBridgeProfile",
			body: {
				containerTag: "account-42",
			},
			expected: {
				scopeRef: "account-42",
			},
		},
		{
			name: "profile explicit scopeRef",
			path: "/v1/profile",
			bridgeMock: "mdbrainBridgeProfile",
			body: {
				scopeRef: "scope-99",
			},
			expected: {
				scopeRef: "scope-99",
			},
		},
	],
	deprecatedRequestProperties: {
		"/v1/search": ["q", "maxResults", "containerTag"],
		"/v1/add": ["containerTag"],
		"/v1/profile": ["containerTag"],
	},
} as const

export default contractFixtures
