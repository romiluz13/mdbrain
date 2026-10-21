// The sources chapter's loader: the run manifest, then each event it names,
// cited through the governed recall route. Shaped per D19; the manifest read
// has no API route yet, so this reports RUN_MANIFEST_NOT_EXPOSED until one is
// injected (see DemoDataUpstream.getRunManifest in ./loaders.ts).

import {
	MdbrainClientError,
	formatCitationMarker,
	type MdbrainCitationEventResponse,
	type MdbrainCitationResponse,
} from "@mdbrain/client"
import { errorState, type DemoDataUpstream } from "./loaders.js"
import { readsFor, type DemoReads } from "./reads.js"
import { mapWithStatus, type DataState } from "./states.js"

/** One source event of the run, cited through the governed recall route.
 * `timestamp` is the event's business time; it is absent when the source
 * carried none. `citedBy` is the wiki claim marker the cite resolved
 * through. */
export type RunEventView = {
	id: string
	text?: string
	timestamp?: string
	citedBy: string
}
export type RunSourcesView = {
	runId: string
	slotIndex?: number
	state: string
	events: RunEventView[]
	unresolvedEventIds: string[]
}

async function resolveCitedBy(
	reads: DemoReads,
	upstream: DemoDataUpstream,
): Promise<string> {
	if (upstream.pinnedPage) {
		const first = upstream.pinnedPage.claims[0]
		if (first) {
			return formatCitationMarker({
				kind: "wiki",
				slug: upstream.pinnedPage.slug,
				claimId: first.id,
				revision: upstream.pinnedPage.revision,
			})
		}
	}
	const list = await reads.wikiList({ limit: 1 })
	const listed = list.pages[0]
	if (!listed) {
		throw noCitingPageError()
	}
	const page = await reads.wikiGet(listed.slug)
	const claim = page.claims[0]
	if (!claim) {
		throw noCitingPageError()
	}
	return (
		claim.marker ??
		formatCitationMarker({
			kind: "wiki",
			slug: page.slug,
			claimId: claim.id,
			revision: page.revision,
		})
	)
}

function noCitingPageError(): MdbrainClientError {
	return new MdbrainClientError(
		404,
		JSON.stringify({
			error: {
				code: "NO_CITING_PAGE",
				message: "no wiki page with a claim exists to cite run events",
			},
		}),
	)
}

/** The sources chapter, shaped per D19: run manifest -> ordered event ids ->
 * one cite per event. The manifest read has no API route yet, so without an
 * injected manifest source this reports RUN_MANIFEST_NOT_EXPOSED. A full
 * run cites every planned event (564 in the full corpus plan), which is the
 * batching target named in the Return. */
export async function loadRunSources(
	upstream: DemoDataUpstream,
): Promise<DataState<RunSourcesView>> {
	const reads = readsFor(upstream)
	const manifest = upstream.getRunManifest
		? await upstream.getRunManifest()
		: null
	if (!manifest) {
		return {
			kind: "incomplete",
			reason: "RUN_MANIFEST_NOT_EXPOSED",
			state: null,
		}
	}
	if (manifest.state !== "ready") {
		return {
			kind: "incomplete",
			reason: "RUN_NOT_READY",
			state: manifest.state,
		}
	}
	const eventIds = manifest.eventsWritten ?? []
	if (eventIds.length === 0) {
		return { kind: "empty" }
	}
	try {
		const citedBy = await resolveCitedBy(reads, upstream)
		const events: RunEventView[] = []
		const unresolvedEventIds: string[] = []
		for (const eventId of eventIds) {
			try {
				const response: MdbrainCitationResponse = await reads.cite({
					marker: formatCitationMarker({ kind: "event", eventId }),
					citedBy,
					...(upstream.scopeRef !== undefined
						? { agentId: upstream.scopeRef }
						: {}),
				})
				if (response.kind !== "event") {
					unresolvedEventIds.push(eventId)
					continue
				}
				const event: MdbrainCitationEventResponse["event"] = response.event
				events.push({
					id: event.eventId,
					...(event.text !== undefined ? { text: event.text } : {}),
					...(event.timestamp !== undefined
						? { timestamp: event.timestamp }
						: {}),
					citedBy,
				})
			} catch {
				unresolvedEventIds.push(eventId)
			}
		}
		if (events.length === 0) {
			return mapWithStatus(
				{
					status: 502,
					code: "NO_SOURCES_RESOLVED",
					message: "none of the run's source events could be cited",
				},
				upstream.readKey,
			)
		}
		return mapWithStatus(
			{
				data: {
					runId: manifest.runId,
					...(manifest.slotIndex !== undefined
						? { slotIndex: manifest.slotIndex }
						: {}),
					state: manifest.state,
					events,
					unresolvedEventIds,
				},
			},
			upstream.readKey,
		)
	} catch (error) {
		return errorState(error, upstream.readKey)
	}
}
