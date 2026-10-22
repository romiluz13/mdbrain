// The read seam for the /demo data layer: the six allowlisted reads,
// principal-free. `clientReads` wraps @mdbrain/client for direct API
// upstreams, where the caller owns the principal; `proxyReads` speaks the
// demo proxy route, where the server injects the principal and refuses
// caller-set principal parameters - so these reads never send scope,
// scopeRef or agentId.
//
// Production path: the /demo page runs the loaders in the browser against
// the same-origin /api/demo route (handleDemoRead in ./proxy.ts injects the
// principal and the read key). Even the search read is a GET toward the proxy;
// the proxy turns it into one fixed-shape upstream POST. MdbrainClient cannot serve that path: every
// one of its read methods requires scope and scopeRef and always sends
// them, which the proxy refuses. The proxy reader builds the same paths
// the SDK builds, minus the principal parameters.
import {
	MdbrainClient,
	MdbrainClientError,
	type MdbrainCitationResponse,
	type MdbrainWikiChangesResponse,
	type MdbrainWikiOverviewResponse,
	type MdbrainWikiPageListResponse,
	type MdbrainWikiPageView,
} from "@mdbrain/client"
import type { DemoDataUpstream } from "./loaders.js"
import type { RunRecord } from "./run-record.js"

/** The wiki search envelope: SDK `wikiSearch` types it as unknown. */
export type WikiSearchEnvelope = {
	results: Array<{
		page: MdbrainWikiPageView
		score: number
		source: string
	}>
	total: number
	recipe: string
	mode: string
}

/** The reads the demo data layer needs. The principal is not part of the
 * input: either the caller-owned principal is folded in by `clientReads`,
 * or the proxy injects its own. */
export interface DemoReads {
	wikiList(input: {
		limit: number
		skip?: number
	}): Promise<MdbrainWikiPageListResponse>
	wikiLint(input: { limit: number }): Promise<unknown>
	overview(slug: string): Promise<MdbrainWikiOverviewResponse>
	changes(input: {
		since: string | Date
		cursor?: string
	}): Promise<MdbrainWikiChangesResponse>
	wikiGet(slug: string): Promise<MdbrainWikiPageView>
	/** The governed text-lane question read: no model, a bounded result count. */
	search(input: {
		query: string
		maxResults: number
	}): Promise<WikiSearchEnvelope>
	/** `citedBy` is optional for an event marker: the event is then confirmed by
	 * its id in the run's scope. */
	cite(input: {
		marker: string
		citedBy?: string
		agentId?: string
	}): Promise<MdbrainCitationResponse>
	/** The pinned run's record, which only the demo proxy serves. */
	run(): Promise<RunRecord>
}

/** The run record is a control-database read the API has no route for, so a
 * direct API upstream has nothing to ask. */
async function runOnlyOnTheProxy(): Promise<never> {
	throw new Error("the pinned run's record is only served by the demo proxy")
}

/** Reads through @mdbrain/client with the caller-owned principal: direct
 * API upstreams (the loaders' tests, and any server-side direct wiring). */
function clientReads(upstream: DemoDataUpstream): DemoReads {
	if (upstream.scope === undefined || upstream.scopeRef === undefined) {
		throw new Error("a direct API upstream needs both scope and scopeRef")
	}
	const client = new MdbrainClient({
		baseUrl: upstream.apiBaseUrl,
		apiKey: upstream.readKey,
		maxRetries: 1,
		defaultDeadlineMs: 15_000,
	})
	const principal = {
		scope: upstream.scope,
		scopeRef: upstream.scopeRef,
	}
	return {
		wikiList: (input) => client.wikiList({ ...principal, ...input }),
		wikiLint: (input) => client.wikiLint({ ...principal, ...input }),
		overview: (slug) => client.overview({ slug, ...principal }),
		changes: (input) => client.changes({ ...principal, ...input }),
		wikiGet: (slug) => client.wikiGet({ slug, ...principal }),
		search: async (input) =>
			(await client.wikiSearch({
				...principal,
				query: input.query,
				recipe: "text",
				maxResults: input.maxResults,
			})) as WikiSearchEnvelope,
		// agentId rides along for direct reads; the proxy reader drops it.
		cite: (input) => client.cite({ ...input, ...principal }),
		run: runOnlyOnTheProxy,
	}
}

/** Reads through the demo proxy route: the same paths the SDK builds,
 * minus the principal parameters (the proxy injects its own and refuses
 * caller-set ones). One fetch per read, no retries: the demo page wants
 * simple inspectable reads, and the proxy already maps upstream failures
 * to error envelopes. A signal cancels the fetch when the owning effect is
 * cleaned up (a remount, or React's dev double mount), so a retired run
 * stops reading mid-chain. */
function proxyReads(
	upstream: DemoDataUpstream,
	signal?: AbortSignal,
): DemoReads {
	const headers: Record<string, string> = { accept: "application/json" }
	if (upstream.readKey) {
		headers.authorization = `Bearer ${upstream.readKey}`
	}
	const get = async <T>(path: string): Promise<T> => {
		const response = await fetch(`${upstream.apiBaseUrl}${path}`, {
			method: "GET",
			headers,
			signal,
		})
		if (!response.ok) {
			throw new MdbrainClientError(response.status, await response.text())
		}
		return (await response.json()) as T
	}
	const query = (
		params: Record<string, string | number | Date | undefined>,
	): string => {
		const search = new URLSearchParams()
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined) {
				search.set(
					key,
					value instanceof Date ? value.toISOString() : String(value),
				)
			}
		}
		const encoded = search.toString()
		return encoded === "" ? "" : `?${encoded}`
	}
	return {
		wikiList: (input) =>
			get<MdbrainWikiPageListResponse>(
				`/v1/wiki${query({ limit: input.limit, skip: input.skip })}`,
			),
		wikiLint: (input) =>
			get<unknown>(`/v1/wiki/lint${query({ limit: input.limit })}`),
		overview: (slug) =>
			get<MdbrainWikiOverviewResponse>(
				`/v1/wiki/overview/${encodeURIComponent(slug)}`,
			),
		changes: (input) =>
			get<MdbrainWikiChangesResponse>(
				`/v1/wiki/changes${query({ since: input.since, cursor: input.cursor })}`,
			),
		wikiGet: (slug) =>
			get<MdbrainWikiPageView>(`/v1/wiki/${encodeURIComponent(slug)}`),
		search: (input) =>
			get<WikiSearchEnvelope>(
				`/v1/wiki/search${query({ query: input.query, maxResults: input.maxResults })}`,
			),
		// agentId is a principal parameter: the proxy refuses it from the
		// caller, so the proxy reader never forwards it.
		cite: (input) =>
			get<MdbrainCitationResponse>(
				`/v1/cite${query({ marker: input.marker, citedBy: input.citedBy })}`,
			),
		run: () => get<RunRecord>("/v1/run"),
	}
}

/** Picks the reader for the upstream: both principal fields set means a
 * direct API upstream; neither means the demo proxy route. The signal
 * reaches the proxy reader's fetch; a direct API read keeps the client's
 * own request lifecycle. */
export function readsFor(
	upstream: DemoDataUpstream,
	signal?: AbortSignal,
): DemoReads {
	const direct = upstream.scope !== undefined || upstream.scopeRef !== undefined
	if (
		direct &&
		(upstream.scope === undefined || upstream.scopeRef === undefined)
	) {
		throw new Error(
			"an upstream sets both scope and scopeRef (direct API) or neither (demo proxy)",
		)
	}
	return direct ? clientReads(upstream) : proxyReads(upstream, signal)
}
