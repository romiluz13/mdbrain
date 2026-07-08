// @mbrain/wiki-engine — MBrain wiki engine entry point.
//
// Wiki pages, OKF interchange, page rendering, self-maintenance
// (git-diff + Dreamer), cross-page contradiction detection, governance
// (scoped retrieval, trust tiers, permissions), backlinks, and connectors
// (Obsidian, GitHub, Confluence, Notion, Slack, CRM).
//
// T2 (this commit): wiki_pages collection schema + indexes.
// Later tickets: OKF, rendering, maintenance, contradictions, governance,
// connectors.

export const WIKI_ENGINE_VERSION = "0.1.0"

export {
	wikiPagesCollection,
	ensureWikiCollections,
	ensureWikiSchemaValidation,
	ensureWikiStandardIndexes,
	ensureWikiSearchIndexes,
	ensureWikiSchema,
	WIKI_PAGES_SEARCH_INDEX_TARGETS,
	WIKI_PAGE_KIND_VALUES,
	WIKI_SCOPE_VALUES,
	WIKI_TRUST_TIER_VALUES,
	WIKI_PRIVACY_TIER_VALUES,
	WIKI_CLAIM_STATUS_VALUES,
	WIKI_PAGE_STATE_VALUES,
	WIKI_FRESHNESS_VALUES,
} from "./wiki-schema.js"
