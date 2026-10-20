// @ts-expect-error Status responses are not part of the public client contract.
import type { MdbrainStatusResponse } from "../src/index.js"
// @ts-expect-error Probe responses are not part of the public client contract.
import type { MdbrainProbeEmbeddingResponse } from "../src/index.js"
import type {
	MdbrainWikiClaimInput,
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
