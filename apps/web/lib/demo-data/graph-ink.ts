// The few colors a canvas draws with and CSS cannot hand it. Each is the value
// of a token in demo.module.css; graph-ink.test.ts keeps them equal.

export const GRAPH_INK = {
	/** `--signal`: the contradicted pages' rings and the lit link. */
	signal: "#e5502b",
	/** `--scope`: the map's ground. */
	scope: "#143038",
	/** `--scope-ink`: a pinned or named page's mark and label. */
	scopeInk: "#f6f8f5",
	/** `--scope-ink-2`: the links between pages. */
	edge: "#b9cdc9",
} as const
