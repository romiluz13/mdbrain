// @ts-expect-error Status responses are not part of the public client contract.
import type { MdbrainStatusResponse } from "../src/index.js"
// @ts-expect-error Probe responses are not part of the public client contract.
import type { MdbrainProbeEmbeddingResponse } from "../src/index.js"
import type {
	MdbrainCitationResponse,
	MdbrainWikiClaim,
	MdbrainWikiClaimInput,
	MdbrainWikiOverviewInput,
	MdbrainWikiOverviewResponse,
	MdbrainWikiPageCreateInput,
	MdbrainWikiPageUpdateInput,
	MdbrainWikiRelationshipInput,
} from "../src/index.js"

// @ts-expect-error Create requires trustTier: POST /v1/wiki rejects omitted tiers.
const createWithoutTrustTier: MdbrainWikiPageCreateInput = {
	kind: "note",
	title: "Deploy windows",
	slug: "notes/deploy windows",
	summary: "Friday deploy windows only",
	body: "Deploys happen on Fridays.",
	frontmatter: { type: "note" },
	scope: "workspace",
	scopeRef: "ws-1",
}
void createWithoutTrustTier

const updateWithClaims: MdbrainWikiPageUpdateInput = {
	slug: "accounts/halvorsen",
	scope: "workspace",
	scopeRef: "ws-1",
	expectedRevision: 1,
	claims: [
		{
			id: "clm_halvorsen_renewal_at_risk",
			text: "The Halvorsen renewal is at risk.",
			confidence: 0.9,
			evidence: [{ kind: "event", sourceId: "evt_ticket_4471" }],
		},
	],
	relationships: [
		{
			targetPageSlug: "incidents/eta-drift",
			targetTitle: "ETA drift escalation",
			kind: "relates_to",
		},
	],
}
void updateWithClaims

// @ts-expect-error A claim needs a caller-owned id: a patch merges claims by id.
const claimWithoutId: MdbrainWikiClaimInput = { text: "No id." }
void claimWithoutId

const claimWithDate: MdbrainWikiClaimInput = {
	id: "clm_dated",
	text: "Dated.",
	// @ts-expect-error validFrom is not accepted: the store holds a date and a JSON body only carries strings.
	validFrom: "2026-09-14T00:00:00Z",
}
void claimWithDate

const relationship: MdbrainWikiRelationshipInput = {
	targetPageSlug: "accounts/halvorsen",
	targetTitle: "Halvorsen Freight",
	kind: "relates_to",
}
void relationship

declare const cited: MdbrainCitationResponse
// @ts-expect-error An event citation has no claim; narrow on kind first.
void cited.claim
if (cited.kind === "claim") {
	const claimText: string = cited.claim.text
	const claimMarker: string | undefined = cited.claim.marker
	void [claimText, claimMarker]
} else {
	const eventText: string | undefined = cited.event.text
	void eventText
}

declare const viewed: MdbrainWikiClaim
const evidenceMarker: string | undefined = viewed.evidence[0]?.marker
void evidenceMarker

const inputEvidence: MdbrainWikiClaimInput = {
	id: "clm_marker",
	text: "A marker is a response field.",
	// @ts-expect-error Evidence markers are response-only; input evidence has no marker.
	evidence: [{ kind: "event", sourceId: "evt_1", marker: "[[event:evt_1]]" }],
}
void inputEvidence

declare const overview: MdbrainWikiOverviewResponse
const overviewClaimMarker: string | undefined = overview.page.claims[0]?.marker
const backlinkClaimMarker: string | undefined =
	overview.backlinks.items[0]?.context?.claim?.marker
const backlinkText: string | undefined =
	overview.backlinks.items[0]?.context?.text
const neighborMarker: string | undefined =
	overview.neighbors.items[0]?.claims[0]?.marker
const neighborTruncated: boolean | undefined =
	overview.neighbors.items[0]?.claimsTruncated
const contradictionClaim: string | undefined =
	overview.contradictions.items[0]?.claims[0]?.claim.marker
const contradictionPage: string | undefined =
	overview.contradictions.items[0]?.claims[0]?.pageSlug
const revisionKind: string | undefined = overview.revisions.items[0]?.editKind
const moreRevisions: boolean = overview.revisions.hasMore
const claimsPerNeighbor: number = overview.limits.neighborClaims
void [
	overviewClaimMarker,
	backlinkClaimMarker,
	backlinkText,
	neighborMarker,
	neighborTruncated,
	contradictionClaim,
	contradictionPage,
	revisionKind,
	moreRevisions,
	claimsPerNeighbor,
]
// @ts-expect-error The ungoverned stored backlink list is replaced by the governed backlinks section.
void overview.page.backlinks
// @ts-expect-error The stored contradiction list is replaced by the governed contradictions section.
void overview.page.contradictions
// @ts-expect-error No section carries a total: a count of what the caller may not see is a leak.
void overview.backlinks.total

// @ts-expect-error An overview is of one page in one scope: slug, scope and scopeRef are required.
const overviewWithoutScope: MdbrainWikiOverviewInput = {
	slug: "accounts/halvorsen",
}
void overviewWithoutScope
const overviewBounded: MdbrainWikiOverviewInput = {
	slug: "accounts/halvorsen",
	scope: "workspace",
	scopeRef: "ws-1",
	maxBacklinks: 5,
	maxNeighborClaims: 2,
}
void overviewBounded
