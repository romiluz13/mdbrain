// @mdbrain/wiki-engine — MDBrain wiki engine entry point.
//
// Wiki pages, OKF interchange, page rendering, self-maintenance
// (git-diff + Dreamer), cross-page contradiction detection, governance
// (scoped retrieval, trust tiers, permissions), backlinks, and connectors
// (Obsidian, GitHub, Confluence, Notion, Slack, CRM).
//
// T2: wiki_pages collection schema + indexes.
// T3: wiki CRUD bridge + page rendering.

export const WIKI_ENGINE_VERSION = "2.0.0"

export {
	beginMemoryDelivery,
	confirmMemoryDelivery,
	failMemoryDelivery,
	failMemoryPromotion,
	fingerprintMemoryDeliveryPayload,
	getMemoryDeliveryIntent,
	listDueMemoryDeliveryIntents,
	listMemoryDeliveryIntents,
	MemoryDeliveryConflictError,
	MemoryDeliveryLeaseLostError,
	MemoryDeliveryPayloadTooLargeError,
	MemoryDeliveryStateError,
	MEMORY_DELIVERY_DUE_SCAN_STATES,
	MEMORY_DELIVERY_STATES,
	promoteMemoryDelivery,
	recordMemoryDeliveryIntent,
	redriveMemoryDeliveryIntent,
	setMemoryDeliveryPromotionApproval,
	DEFAULT_MEMORY_LEDGER_TTL_MS,
	MAX_MEMORY_DELIVERY_PAYLOAD_BYTES,
	memoryDeliveryRetryDelayMs,
	type MemoryDeliveryIntent,
	type MemoryDeliveryIntentInput,
	type MemoryDeliveryReplayConflictField,
	type MemoryDeliveryState,
	type MemoryPromotionApproval,
	type MemoryPromotionPolicy,
} from "./memory-delivery.js"
export {
	WikiStore,
	resolveWikiStoreConfig,
	type WikiStoreConfig,
	type WikiTransactionSession,
} from "./wiki-store.js"

export {
	recordWikiMutationIntent,
	fingerprintWikiMutationPayload,
	type WikiMutationIntent,
	type WikiMutationKind,
} from "./wiki-mutation-intents.js"

export {
	wikiPagesCollection,
	wikiRevisionsCollection,
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
	recordWikiPageRevision,
	listWikiPageRevisions,
	getWikiPageRevision,
	type WikiRevisionEditKind,
	type WikiPageRevisionRecord,
	type WikiPageEditor,
} from "./wiki-revisions.js"

export {
	extractTransclusionTargets,
	resolveTransclusions,
} from "./wiki-transclusion.js"

export {
	createWikiPage,
	getWikiPage,
	listWikiPages,
	updateWikiPage,
	deleteWikiPage,
	renderMarkdown,
	renderHtml,
	WikiDuplicateSlugError,
	WikiNotFoundError,
	WikiRevisionConflictError,
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
	WikiSearchUnavailableError,
	type WikiSearchRecipe,
	type WikiSearchParams,
	type WikiSearchResult,
	type WikiRerankFn,
	type WikiSearchResponse,
} from "./wiki-search.js"

export { probeWikiSearch } from "./wiki-search-probe.js"

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

export {
	detectContradictions,
	recordContradictions,
	listUnresolvedContradictions,
	resolveContradiction,
	runWritePipelineGate,
	checkNearDuplicate,
	areContradictory,
	hasNegation,
	textOverlap,
	type Contradiction,
	type ContradictionResolution,
	type DedupResult,
	type PipelineGateResult,
	type ClaimRecord,
} from "./wiki-contradictions.js"

export {
	computeMaintenanceHash,
	detectChangedSources,
	runGitDiffMaintenance,
	runDreamerPromotion,
	type MaintenanceSource,
	type MaintenanceResult,
	type ChangedSource,
	type EventInput,
	type LlmGenerateFn,
} from "./wiki-maintenance.js"

export {
	ObsidianConnector,
	GitHubConnector,
	ConfluenceConnector,
	NotionConnector,
	SlackConnector,
	CrmConnector,
	ConnectorRegistry,
	type SourceConnector,
	type ConnectorAuthenticateResult,
	type ConnectorDiscoverResult,
	type ConnectorIngestResult,
	type ConnectorMapPermissionsResult,
	type DiscoveredSource,
	type IngestOpts,
	type ObsidianConnectorConfig,
	type GitHubConnectorConfig,
	type ConfluenceConnectorConfig,
	type NotionConnectorConfig,
	type SlackConnectorConfig,
	type CrmConnectorConfig,
} from "./wiki-connectors.js"

export { omitUndefined } from "./omit-undefined.js"
