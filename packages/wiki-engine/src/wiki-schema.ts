// @mdbrian/wiki-engine — wiki_pages collection schema, validators, indexes.
//
// Mirrors the @mdbrian/memory-engine schema pattern (mongodb-schema.ts):
//   - WIKI_PAGES_SCHEMA: $jsonSchema validator (validationAction: "error")
//   - wikiPagesCollection(db, prefix): collection helper
//   - VALIDATED_WIKI_COLLECTIONS: map consumed by ensureWikiCollections + ensureWikiSchemaValidation
//   - ensureWikiCollections / ensureWikiSchemaValidation / ensureWikiStandardIndexes / ensureWikiSearchIndexes
//
// wiki_pages is the Layer 2 synthesis artifact (Karpathy 3-layer model):
//   Layer 1 = entity graph + raw sources (memory-engine)
//   Layer 2 = wiki_pages (this module) — LLM-synthesized, browsable by humans + agents
//   Layer 3 = page-kind schemas + maintenance rules + governance policies
//
// Design spec: docs/specs/2026-07-08-mdbrian-llm-wiki-design.md §4

import type {
	Collection,
	Db,
	Document,
	IndexDescription,
	SearchIndexDescription,
} from "mongodb"
import { createSubsystemLogger } from "@mdbrian/lib"

const log = createSubsystemLogger("wiki:schema")

// ---------------------------------------------------------------------------
// Collection helper
// ---------------------------------------------------------------------------

/** Returns the wiki_pages collection for the given db + prefix. */
export function wikiPagesCollection(db: Db, prefix: string): Collection {
	return db.collection(`${prefix}wiki_pages`)
}

// ---------------------------------------------------------------------------
// $jsonSchema validator
// ---------------------------------------------------------------------------

const SCOPE_VALUES = [
	"session",
	"user",
	"agent",
	"workspace",
	"tenant",
	"global",
] as const

const TRUST_TIER_VALUES = ["restricted", "standard", "admin"] as const

const PRIVACY_TIER_VALUES = [
	"public",
	"internal",
	"confidential",
	"restricted",
] as const

const PAGE_KIND_VALUES = [
	"entity",
	"concept",
	"synthesis",
	"source",
	"report",
	"procedure",
] as const

const CLAIM_STATUS_VALUES = [
	"active",
	"superseded",
	"contradicted",
	"disputed",
] as const

const PAGE_STATE_VALUES = ["active", "superseded", "draft"] as const

const FRESHNESS_VALUES = ["fresh", "stale", "unknown"] as const

const MAINTENANCE_SOURCE_VALUES = [
	"git-diff",
	"dreamer",
	"manual",
	"api",
] as const

const CONTRADICTION_RESOLUTION_VALUES = [
	"unresolved",
	"newest_wins",
	"authority_wins",
	"human_escalation",
] as const

const EVIDENCE_KIND_VALUES = [
	"file",
	"url",
	"event",
	"api",
	"manual",
	"agent",
] as const

const QUESTION_STATUS_VALUES = ["open", "answered"] as const

const WIKI_PAGES_SCHEMA: Document = {
	$jsonSchema: {
		bsonType: "object",
		required: [
			"kind",
			"title",
			"slug",
			"summary",
			"body",
			"frontmatter",
			"scope",
			"scopeRef",
			"trustTier",
			"state",
			"revision",
			"validFrom",
			"freshness",
			"createdAt",
			"updatedAt",
		],
		properties: {
			kind: {
				enum: PAGE_KIND_VALUES,
				description:
					"Wiki page kind: entity, concept, synthesis, source, report, procedure",
			},
			title: { bsonType: "string" },
			slug: {
				bsonType: "string",
				description:
					"URL-safe ID = OKF conceptId (file path in bundle). Unique per scope.",
			},
			aliases: {
				bsonType: "array",
				items: { bsonType: "string" },
			},
			summary: {
				bsonType: "string",
				description: "One-paragraph dense summary (OpenWiki style)",
			},
			body: {
				bsonType: "string",
				description: "Full markdown (browsable by humans + agents)",
			},
			frontmatter: {
				bsonType: "object",
				required: ["type"],
				properties: {
					// OKF required field
					type: { bsonType: "string" },
					// OKF recommended
					title: { bsonType: "string" },
					description: { bsonType: "string" },
					resource: {
						bsonType: "string",
						description: "Canonical URI to original asset",
					},
					tags: { bsonType: "array", items: { bsonType: "string" } },
					timestamp: { bsonType: "date" },
					// OKF extensions (permitted by spec)
					entityTypes: { bsonType: "array", items: { bsonType: "string" } },
					privacyTier: { enum: PRIVACY_TIER_VALUES },
					// Migration provenance: "structured_mem:<id>" or "procedures:<id>".
					migratedFrom: { bsonType: "string" },
				},
			},

			// Claims (openclaw WikiClaim + arXIV:2606.24535 governance)
			claims: {
				bsonType: "array",
				items: {
					bsonType: "object",
					required: ["id", "text", "status", "updatedAt"],
					properties: {
						id: { bsonType: "string" },
						text: { bsonType: "string" },
						status: { enum: CLAIM_STATUS_VALUES },
						confidence: { bsonType: "number", minimum: 0, maximum: 1 },
						evidence: {
							bsonType: "array",
							items: {
								bsonType: "object",
								required: ["kind", "sourceId"],
								properties: {
									kind: { enum: EVIDENCE_KIND_VALUES },
									sourceId: {
										bsonType: "string",
										description: "Ref to raw source / entity / event",
									},
									path: { bsonType: "string" },
									lines: { bsonType: "string" },
									weight: { bsonType: "number", minimum: 0, maximum: 1 },
									confidence: {
										bsonType: "number",
										minimum: 0,
										maximum: 1,
									},
									privacyTier: { enum: PRIVACY_TIER_VALUES },
									note: { bsonType: "string" },
								},
							},
						},
						writerAgent: {
							bsonType: "object",
							required: ["id", "name"],
							properties: {
								id: { bsonType: "string" },
								name: { bsonType: "string" },
								runId: { bsonType: "string" },
							},
							description: "arXIV provenance: agent that wrote this claim",
						},
						derivedFrom: {
							bsonType: "array",
							items: { bsonType: "string" },
							description: "Provenance chain (source claim/event ids)",
						},
						supersedesClaimId: {
							bsonType: "string",
							description: "arXIV temporal supersession",
						},
						validFrom: { bsonType: "date" },
						validTo: { bsonType: "date" },
						updatedAt: { bsonType: "date" },
						// Migration provenance: the structured_mem _id this claim was migrated from.
						sourceMemId: { bsonType: "string" },
					},
				},
			},

			// Cross-page contradictions
			contradictions: {
				bsonType: "array",
				items: {
					bsonType: "object",
					required: ["id", "claimIds", "detectedAt", "resolution"],
					properties: {
						id: { bsonType: "string" },
						claimIds: {
							bsonType: "array",
							items: { bsonType: "string" },
							minItems: 2,
						},
						detectedAt: { bsonType: "date" },
						resolution: { enum: CONTRADICTION_RESOLUTION_VALUES },
						resolvedBy: { bsonType: "string" },
						resolvedAt: { bsonType: "date" },
						note: { bsonType: "string" },
					},
				},
			},

			// Open questions (things the wiki doesn't know yet)
			questions: {
				bsonType: "array",
				items: {
					bsonType: "object",
					required: ["id", "text", "status", "createdAt"],
					properties: {
						id: { bsonType: "string" },
						text: { bsonType: "string" },
						status: { enum: QUESTION_STATUS_VALUES },
						answeredByClaimId: { bsonType: "string" },
						createdAt: { bsonType: "date" },
					},
				},
			},

			// Relationships to other pages (openclaw WikiRelationship)
			relationships: {
				bsonType: "array",
				items: {
					bsonType: "object",
					required: ["targetPageSlug", "targetTitle", "kind"],
					properties: {
						targetPageSlug: { bsonType: "string" },
						targetTitle: { bsonType: "string" },
						kind: {
							bsonType: "string",
							description: "works_at | uses | depends_on | relates_to | ...",
						},
						weight: { bsonType: "number", minimum: 0, maximum: 1 },
						confidence: { bsonType: "number", minimum: 0, maximum: 1 },
						evidenceKind: { bsonType: "string" },
						privacyTier: { enum: PRIVACY_TIER_VALUES },
					},
				},
			},

			// Person card (kind="entity", entityType="person")
			personCard: {
				bsonType: ["object", "null"],
				properties: {
					canonicalId: { bsonType: "string" },
					handles: { bsonType: "array", items: { bsonType: "string" } },
					socials: { bsonType: "array", items: { bsonType: "string" } },
					emails: { bsonType: "array", items: { bsonType: "string" } },
					timezone: { bsonType: "string" },
					lane: { bsonType: "string" },
					askFor: { bsonType: "array", items: { bsonType: "string" } },
					avoidAskingFor: { bsonType: "array", items: { bsonType: "string" } },
					bestUsedFor: { bsonType: "string" },
					notEnoughFor: { bsonType: "string" },
				},
			},

			// Graph link (Layer 1 backbone node)
			entityId: { bsonType: "string" },

			// OKF
			okfConceptId: {
				bsonType: "string",
				description: "File path in OKF bundle (e.g., tables/users)",
			},
			okfBundleId: { bsonType: "string" },

			// Governance (arXIV:2606.24535 + memongo)
			scope: { enum: SCOPE_VALUES },
			scopeRef: {
				bsonType: "string",
				description: "Resolved concrete namespace for the scope",
			},
			trustTier: { enum: TRUST_TIER_VALUES },
			permissions: {
				bsonType: "object",
				properties: {
					allowedRoles: { bsonType: "array", items: { bsonType: "string" } },
					allowedDepartments: {
						bsonType: "array",
						items: { bsonType: "string" },
					},
					privacyTier: { enum: PRIVACY_TIER_VALUES },
				},
			},

			// Provenance + temporal (page-level)
			provenance: { bsonType: "object" },
			sourceAgent: {
				bsonType: "object",
				required: ["id", "name"],
				properties: {
					id: { bsonType: "string" },
					name: { bsonType: "string" },
					runId: { bsonType: "string" },
				},
			},
			sourceEventIds: { bsonType: "array", items: { bsonType: "string" } },
			sourceReliability: { bsonType: "number", minimum: 0, maximum: 1 },
			state: { enum: PAGE_STATE_VALUES },
			supersedes: { bsonType: "string", description: "pageId" },
			supersededBy: { bsonType: "string" },
			revision: { bsonType: "number", minimum: 1 },
			validFrom: { bsonType: "date" },
			validTo: { bsonType: "date" },

			// Maintenance
			lastMaintainedAt: { bsonType: "date" },
			lastMaintenanceSource: { enum: MAINTENANCE_SOURCE_VALUES },
			maintenanceHash: {
				bsonType: "string",
				description: "Content hash for git-diff detection",
			},
			freshness: { enum: FRESHNESS_VALUES },

			// Backlinks (auto-generated, not manually edited)
			backlinks: {
				bsonType: "array",
				items: {
					bsonType: "object",
					required: ["sourcePageSlug", "sourceTitle"],
					properties: {
						sourcePageSlug: { bsonType: "string" },
						sourceTitle: { bsonType: "string" },
						context: { bsonType: "string" },
					},
				},
			},

			// Search
			embedding: {
				bsonType: "array",
				description: "Vector embedding of summary + body",
			},

			createdAt: { bsonType: "date" },
			updatedAt: { bsonType: "date" },
		},
	},
}

const VALIDATED_WIKI_COLLECTIONS: Record<string, Document> = {
	wiki_pages: WIKI_PAGES_SCHEMA,
}

// ---------------------------------------------------------------------------
// Ensure collections exist (idempotent) — mirrors memory-engine pattern
// ---------------------------------------------------------------------------

export async function ensureWikiCollections(
	db: Db,
	prefix: string,
): Promise<void> {
	const existing = new Set(
		await db
			.listCollections()
			.map((c) => c.name)
			.toArray(),
	)
	const needed = ["wiki_pages"].map((n) => `${prefix}${n}`)
	for (const name of needed) {
		if (!existing.has(name)) {
			const baseName = name.slice(prefix.length)
			const validator = VALIDATED_WIKI_COLLECTIONS[baseName]
			if (validator) {
				await db.createCollection(name, {
					validator,
					validationLevel: "moderate",
					validationAction: "error",
				})
			} else {
				await db.createCollection(name)
			}
			log.info(`created collection ${name}`)
		}
	}
}

// ---------------------------------------------------------------------------
// Ensure schema validation (idempotent) — mirrors memory-engine pattern
// ---------------------------------------------------------------------------

export async function ensureWikiSchemaValidation(
	db: Db,
	prefix: string,
): Promise<void> {
	for (const [baseName, validator] of Object.entries(
		VALIDATED_WIKI_COLLECTIONS,
	)) {
		const collName = `${prefix}${baseName}`
		try {
			await db.command({
				collMod: collName,
				validator,
				validationLevel: "moderate",
				validationAction: "error",
			})
			log.info(`applied schema validation to ${collName}`)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			if (
				msg.includes("ns not found") ||
				msg.includes("ns does not exist") ||
				msg.includes("doesn't exist") ||
				msg.includes("NamespaceNotFound")
			) {
				continue
			}
			log.warn(`schema validation for ${collName} failed: ${msg}`)
		}
	}
}

// ---------------------------------------------------------------------------
// Standard indexes (idempotent) — mirrors memory-engine ensureStandardIndexes
// ---------------------------------------------------------------------------

export async function ensureWikiStandardIndexes(
	db: Db,
	prefix: string,
): Promise<void> {
	const coll = wikiPagesCollection(db, prefix)
	const indexes: IndexDescription[] = [
		// slug unique per scope — compound with scopeRef so the same slug can
		// exist in different scopes (e.g., tenant A and tenant B both have a
		// "company/acme" page).
		{
			key: { slug: 1, scope: 1, scopeRef: 1 },
			unique: true,
			name: "slug_scope_unique",
		},
		{ key: { kind: 1 }, name: "kind" },
		{ key: { entityId: 1 }, name: "entityId", sparse: true },
		{ key: { okfConceptId: 1 }, name: "okfConceptId", sparse: true },
		{ key: { okfBundleId: 1 }, name: "okfBundleId", sparse: true },
		{ key: { scope: 1, scopeRef: 1 }, name: "scope_scopeRef" },
		{ key: { trustTier: 1 }, name: "trustTier" },
		{ key: { state: 1 }, name: "state" },
		{ key: { freshness: 1 }, name: "freshness" },
		{ key: { "frontmatter.tags": 1 }, name: "tags", sparse: true },
		// aliases: text index for free-text alias lookup
		{ key: { aliases: "text" }, name: "aliases_text" },
		{ key: { updatedAt: 1 }, name: "updatedAt" },
		{ key: { lastMaintainedAt: 1 }, name: "lastMaintainedAt", sparse: true },
	]
	await coll.createIndexes(indexes)
	log.info(`ensured standard indexes on ${coll.collectionName}`)
}

// ---------------------------------------------------------------------------
// Search indexes (vector + Atlas Search) — mirrors memory-engine pattern
// ---------------------------------------------------------------------------

/** Search index definition for wiki_pages (vector + text). Kept here so the
 *  API/MCP layers and any migration tooling can reference one source of truth. */
export const WIKI_PAGES_SEARCH_INDEX_TARGETS = {
	vector: {
		name: "wiki_pages_vector",
		type: "vectorSearch" as const,
		definition: {
			fields: [
				{
					type: "vector",
					path: "embedding",
					numDimensions: 1024,
					similarity: "cosine",
				},
				// Pre-filter axes (scoped retrieval + governance).
				// permissions.privacyTier is the scalar filterable sub-field of the
				// permissions object (allowedRoles/allowedDepartments are arrays →
				// need a token-facet strategy, deferred to T10 governance).
				{ type: "filter", path: "kind" },
				{ type: "filter", path: "scope" },
				{ type: "filter", path: "scopeRef" },
				{ type: "filter", path: "trustTier" },
				{ type: "filter", path: "state" },
				{ type: "filter", path: "permissions.privacyTier" },
			],
		},
	},
	text: {
		name: "wiki_pages_text",
		type: "search" as const,
		definition: {
			mappings: {
				dynamic: false,
				fields: {
					title: [{ type: "string", analyzer: "lucene.standard" }],
					summary: [{ type: "string", analyzer: "lucene.standard" }],
					body: [{ type: "string", analyzer: "lucene.standard" }],
					aliases: [{ type: "string", analyzer: "lucene.standard" }],
					"frontmatter.tags": [{ type: "string", analyzer: "lucene.standard" }],
					// Filter facets for scoped retrieval + governance
					kind: { type: "string" },
					scope: { type: "string" },
					scopeRef: { type: "string" },
					trustTier: { type: "string" },
					state: { type: "string" },
					"permissions.privacyTier": { type: "string" },
				},
			},
		},
	},
}

/**
 * Ensure vector + Atlas Search indexes on wiki_pages.
 *
 * NOTE: Search index management requires mongot (Atlas Search) to be available
 * (Atlas, or Atlas Local Preview via docker). On a plain Community Server
 * without mongot, search index creation is a no-op (logged, not fatal) —
 * mirroring memory-engine's isSearchIndexManagementUnavailable handling.
 */
export async function ensureWikiSearchIndexes(
	db: Db,
	prefix: string,
): Promise<void> {
	const coll = wikiPagesCollection(db, prefix)
	const targets = WIKI_PAGES_SEARCH_INDEX_TARGETS

	for (const target of [targets.vector, targets.text]) {
		try {
			// Search index management API: list + create pattern.
			const existing = await coll.listSearchIndexes(target.name).toArray()
			if (existing.length > 0) {
				continue
			}
			const description: SearchIndexDescription = {
				name: target.name,
				definition: target.definition,
				type: target.type,
			}
			await coll.createSearchIndex(description)
			log.info(
				`created ${target.type} index ${target.name} on ${coll.collectionName}`,
			)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			// Search index management unavailable (no mongot) — not fatal.
			// Match the memory-engine reference (isSearchIndexManagementUnavailable)
			// plus fallback strings seen on Community Server.
			if (
				msg.includes("Search Index Management service") ||
				msg.includes("Error connecting to Search Index Management service") ||
				msg.includes("not supported") ||
				msg.includes("searchIndexManagement") ||
				msg.includes("no such command") ||
				msg.includes("SearchIndexManagement")
			) {
				log.info(
					`search index management unavailable for ${target.name} (no mongot) — skipping`,
				)
				continue
			}
			log.warn(
				`search index ${target.name} on ${coll.collectionName} failed: ${msg}`,
			)
		}
	}
}

// ---------------------------------------------------------------------------
// Convenience: run all wiki ensure steps in order.
// ---------------------------------------------------------------------------

export async function ensureWikiSchema(db: Db, prefix: string): Promise<void> {
	await ensureWikiCollections(db, prefix)
	await ensureWikiSchemaValidation(db, prefix)
	await ensureWikiStandardIndexes(db, prefix)
	await ensureWikiSearchIndexes(db, prefix)
}

// ---------------------------------------------------------------------------
// Re-exports for consumers (types + helpers)
// ---------------------------------------------------------------------------

export const WIKI_PAGE_KIND_VALUES = PAGE_KIND_VALUES
export const WIKI_SCOPE_VALUES = SCOPE_VALUES
export const WIKI_TRUST_TIER_VALUES = TRUST_TIER_VALUES
export const WIKI_PRIVACY_TIER_VALUES = PRIVACY_TIER_VALUES
export const WIKI_CLAIM_STATUS_VALUES = CLAIM_STATUS_VALUES
export const WIKI_PAGE_STATE_VALUES = PAGE_STATE_VALUES
export const WIKI_FRESHNESS_VALUES = FRESHNESS_VALUES
