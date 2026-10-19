// @ts-expect-error Status responses are not part of the public client contract.
import type { MdbrainStatusResponse } from "../src/index.js"
// @ts-expect-error Probe responses are not part of the public client contract.
import type { MdbrainProbeEmbeddingResponse } from "../src/index.js"
import type { MdbrainWikiPageCreateInput } from "../src/index.js"

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
