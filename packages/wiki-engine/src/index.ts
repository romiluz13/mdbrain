// @mdbrian/wiki-engine — MDBrain wiki engine entry point.
//
// Wiki pages, OKF interchange, page rendering, self-maintenance
// (git-diff + Dreamer), cross-page contradiction detection, governance
// (scoped retrieval, trust tiers, permissions), backlinks, and connectors
// (Obsidian, GitHub, Confluence, Notion, Slack, CRM).
//
// T2: wiki_pages collection schema + indexes.
// T3: wiki CRUD bridge + page rendering.

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

export {
	createWikiPage,
	getWikiPage,
	listWikiPages,
	updateWikiPage,
	deleteWikiPage,
	renderMarkdown,
	renderHtml,
	getWikiDbHandle,
	WikiDuplicateSlugError,
	WikiNotFoundError,
	type WikiPageInput,
	type WikiClaimInput,
	type WikiQuestionInput,
	type WikiRelationshipInput,
	type WikiPersonCard,
	type WikiPage,
	type WikiPageView,
	type WikiDbHandle,
	type WikiEmbedFn,
} from "./wiki-bridge.js"

export {
	renderWikiPageMarkdown,
	renderWikiPageHtml,
} from "./wiki-renderer.js"

export {
	importOkfBundle,
	exportOkfBundle,
	type OkfImportResult,
	type OkfExportResult,
} from "./okf.js"

export {
	searchWikiPages,
	searchWikiPagesViaManager,
	type WikiSearchRecipe,
	type WikiSearchParams,
	type WikiSearchResult,
	type WikiSearchResponse,
} from "./wiki-search.js"

export {
	buildWikiMapBlock,
	generateWikiMapBlock,
	injectWikiMapBlock,
	writeWikiMapToFile,
	generateAndWriteWikiMap,
	type MapPointerOptions,
} from "./wiki-map-pointer.js"

export {
	recomputeBacklinksFor,
	recomputeBacklinksAfterChange,
	recomputeAllBacklinks,
	type WikiBacklink,
} from "./wiki-backlinks.js"

export {
	migrateStructuredMem,
	migrateProcedures,
	migrateLegacyToWiki,
	checkMigrationCoverage,
	type MigrationResult,
} from "./wiki-migrate.js"

export {
	buildScopeFilter,
	buildPermissionsFilter,
	buildGovernanceFilter,
	canPropagateCrossScope,
	getWikiPageGoverned,
	getWikiPageByIdGoverned,
	graphTraversalGoverned,
	filterPagesByGovernance,
	countSupersededClaims,
	type GovernanceContext,
	type TrustTier,
	type PrivacyTier,
} from "./wiki-governance.js"
