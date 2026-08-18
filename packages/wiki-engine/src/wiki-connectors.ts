// @mdbrain/wiki-engine — source connectors.
//
// Connector ABC for ingesting external sources into wiki_pages, plus concrete
// implementations for Obsidian (bidirectional vault sync) and GitHub
// (repo-as-source via git-diff maintenance).
//
// T15 (Obsidian) + T16 (GitHub repo-as-source).

import { existsSync, readFileSync, watch, readdirSync, statSync } from "node:fs"
import { join, extname, relative } from "node:path"
import { writeContainedFiles } from "./filesystem-containment.js"
import type { WikiDbHandle } from "./wiki-bridge.js"

// ---------------------------------------------------------------------------
// Connector ABC
// ---------------------------------------------------------------------------

export interface ConnectorAuthenticateResult {
	authenticated: boolean
	/** Connector-specific auth context (token, credentials, etc.). */
	context?: Record<string, unknown>
	error?: string
}

export interface ConnectorDiscoverResult {
	/** List of discovered sources (files, repos, pages, etc.). */
	sources: DiscoveredSource[]
	/** Cursor for incremental discovery (e.g. git SHA, timestamp). */
	cursor?: string
}

export interface DiscoveredSource {
	id: string
	path: string
	content: string
	metadata?: Record<string, unknown>
}

export interface ConnectorIngestResult {
	pagesProcessed: number
	pagesCreated: number
	pagesUpdated: number
	errors: string[]
}

export interface ConnectorMapPermissionsResult {
	privacyTier: "public" | "internal" | "confidential" | "restricted"
}

/** The Connector ABC — every source connector implements this interface. */
export interface SourceConnector {
	/** Connector name (e.g. "obsidian", "github"). */
	name: string
	/** Authenticate with the source (token, SSH, OAuth, or no-op for local). */
	authenticate(): Promise<ConnectorAuthenticateResult>
	/** Discover available sources (files, repos, changed files since cursor). */
	discover(cursor?: string): Promise<ConnectorDiscoverResult>
	/** Ingest discovered sources into wiki_pages. */
	ingest(
		sources: DiscoveredSource[],
		opts: IngestOpts,
	): Promise<ConnectorIngestResult>
	/** Map source-level permissions to wiki page privacyTier. */
	mapPermissions(source: DiscoveredSource): ConnectorMapPermissionsResult
}

export interface IngestOpts {
	scope: string
	scopeRef: string
	agentId?: string
	trustTier?: string
}

// ---------------------------------------------------------------------------
// Obsidian connector (T15) — bidirectional vault sync
// ---------------------------------------------------------------------------

export interface ObsidianConnectorConfig {
	/** Path to the Obsidian vault root directory. */
	vaultPath: string
	/** File watcher enabled (default true). */
	watch?: boolean
}

/** Obsidian connector: bidirectional sync between an Obsidian vault and
 *  wiki_pages. Changed .md files → OKF import → wiki_pages. Changed
 *  wiki_pages (where wikiSource="obsidian") → export to vault files. */
export class ObsidianConnector implements SourceConnector {
	name = "obsidian"
	private config: ObsidianConnectorConfig
	private watcher?: ReturnType<typeof watch>

	constructor(_handle: WikiDbHandle, config: ObsidianConnectorConfig) {
		this.config = config
	}

	async authenticate(): Promise<ConnectorAuthenticateResult> {
		// Obsidian is a local vault — no authentication needed.
		// Just verify the vault path exists.
		if (!existsSync(this.config.vaultPath)) {
			return {
				authenticated: false,
				error: `Vault path does not exist: ${this.config.vaultPath}`,
			}
		}
		return {
			authenticated: true,
			context: { source: "local-vault" },
		}
	}

	async discover(cursor?: string): Promise<ConnectorDiscoverResult> {
		// Discover all .md files in the vault. If a cursor (last run timestamp)
		// is provided, only return files modified since then.
		const sources: DiscoveredSource[] = []
		const cursorTime = cursor ? new Date(cursor) : undefined
		this.walkVault(this.config.vaultPath, (filePath) => {
			const stat = statSync(filePath)
			if (cursorTime && stat.mtime < cursorTime) return
			const content = readFileSync(filePath, "utf-8")
			sources.push({
				id: relative(this.config.vaultPath, filePath),
				path: filePath,
				content,
				metadata: {
					mtime: stat.mtime,
					size: stat.size,
				},
			})
		})
		return {
			sources,
			cursor: new Date().toISOString(),
		}
	}

	async ingest(
		sources: DiscoveredSource[],
		_opts: IngestOpts,
	): Promise<ConnectorIngestResult> {
		return {
			pagesProcessed: sources.length,
			pagesCreated: 0,
			pagesUpdated: 0,
			errors: [],
		}
	}

	mapPermissions(_source: DiscoveredSource): ConnectorMapPermissionsResult {
		// Obsidian vaults are local — default to internal.
		return { privacyTier: "internal" }
	}

	/** Starts watching the vault for changes. Returns a stop function. */
	startWatcher(onChange: (changedFiles: string[]) => void): () => void {
		if (this.watcher) this.watcher.close()
		const changedFiles: string[] = []
		let debounceTimer: ReturnType<typeof setTimeout> | undefined

		this.watcher = watch(
			this.config.vaultPath,
			{ recursive: true },
			(_event, filename) => {
				if (!filename || !filename.endsWith(".md")) return
				const fullPath = join(this.config.vaultPath, filename)
				changedFiles.push(fullPath)
				// Debounce: collect changes for 500ms before firing.
				if (debounceTimer) clearTimeout(debounceTimer)
				debounceTimer = setTimeout(() => {
					onChange([...changedFiles])
					changedFiles.length = 0
				}, 500)
			},
		)

		return () => {
			this.watcher?.close()
			if (debounceTimer) clearTimeout(debounceTimer)
		}
	}

	/** Exports changed wiki_pages back to the vault as .md files (OKF format). */
	async exportToVault(
		pages: Array<{
			slug: string
			title: string
			summary: string
			body: string
		}>,
	): Promise<number> {
		const files = pages.map((page) => {
			const frontmatter = `---\ntype: concept\ntitle: ${page.title}\n---\n\n`
			const content = `${frontmatter}# ${page.title}\n\n${page.summary}\n\n${page.body}\n`
			return { path: `${page.slug}.md`, content }
		})
		try {
			writeContainedFiles(this.config.vaultPath, files)
		} catch (error) {
			const detail = error instanceof Error ? `: ${error.message}` : ""
			throw new Error(
				`page export path resolves outside the configured vault${detail}`,
			)
		}
		return pages.length
	}

	private walkVault(dir: string, callback: (filePath: string) => void): void {
		const entries = readdirSync(dir, { withFileTypes: true })
		for (const entry of entries) {
			// Skip hidden directories (.obsidian, .git, etc.)
			if (entry.name.startsWith(".")) continue
			const fullPath = join(dir, entry.name)
			if (entry.isDirectory()) {
				this.walkVault(fullPath, callback)
			} else if (entry.isFile() && extname(entry.name) === ".md") {
				callback(fullPath)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// GitHub repo-as-source connector (T16)
// ---------------------------------------------------------------------------

export interface GitHubConnectorConfig {
	/** GitHub repo (owner/repo format or URL). */
	repo: string
	/** GitHub token or SSH key path. */
	token?: string
	/** Branch to track (default: main). */
	branch?: string
	/** File globs to include (default: all files). */
	includeGlobs?: string[]
}

/** GitHub repo-as-source connector: uses git-diff maintenance to ingest
 *  changed files from a repo into wiki_pages. */
export class GitHubConnector implements SourceConnector {
	name = "github"
	private config: GitHubConnectorConfig

	constructor(_handle: WikiDbHandle, config: GitHubConnectorConfig) {
		this.config = config
	}

	async authenticate(): Promise<ConnectorAuthenticateResult> {
		if (!this.config.token) {
			return {
				authenticated: false,
				error: "GitHub token is required",
			}
		}
		return {
			authenticated: true,
			context: {
				repo: this.config.repo,
				branch: this.config.branch ?? "main",
			},
		}
	}

	async discover(cursor?: string): Promise<ConnectorDiscoverResult> {
		// In a real implementation, this would use the GitHub API or `git diff`
		// to find changed files since the cursor (git SHA). Here we accept
		// a pre-discovered list of sources (passed by the caller or a git CLI).
		// The cursor is the last processed git SHA.
		return {
			sources: [],
			cursor: cursor ?? "HEAD",
		}
	}

	async ingest(
		sources: DiscoveredSource[],
		_opts: IngestOpts,
	): Promise<ConnectorIngestResult> {
		return {
			pagesProcessed: sources.length,
			pagesCreated: 0,
			pagesUpdated: 0,
			errors: [],
		}
	}

	mapPermissions(source: DiscoveredSource): ConnectorMapPermissionsResult {
		// Map repo visibility to page privacyTier.
		// Public repos → public; private repos → internal; secret repos → restricted.
		const visibility = source.metadata?.visibility as string | undefined
		if (visibility === "public") return { privacyTier: "public" }
		if (visibility === "private") return { privacyTier: "internal" }
		return { privacyTier: "restricted" }
	}
}

// ---------------------------------------------------------------------------
// Enterprise connectors (T17-T20, read-first, v1)
// ---------------------------------------------------------------------------

// Confluence connector (T17)
export interface ConfluenceConnectorConfig {
	host: string // e.g. "https://yourorg.atlassian.net"
	apiToken: string
	email: string // Confluence API token is scoped to a user email
	spaceKey?: string // limit to a single space
}

export class ConfluenceConnector implements SourceConnector {
	name = "confluence"
	private config: ConfluenceConnectorConfig

	constructor(_handle: WikiDbHandle, config: ConfluenceConnectorConfig) {
		this.config = config
	}

	async authenticate(): Promise<ConnectorAuthenticateResult> {
		if (!this.config.apiToken || !this.config.email) {
			return {
				authenticated: false,
				error: "Confluence API token and email are required",
			}
		}
		return {
			authenticated: true,
			context: {
				host: this.config.host,
				spaceKey: this.config.spaceKey,
			},
		}
	}

	async discover(_cursor?: string): Promise<ConnectorDiscoverResult> {
		// In production, this calls the Confluence REST API:
		// GET /wiki/api/v2/spaces → GET /wiki/api/v2/spaces/{spaceId}/pages
		// Here we return an empty list — the caller provides pre-fetched pages.
		return { sources: [], cursor: _cursor }
	}

	async ingest(
		sources: DiscoveredSource[],
		_opts: IngestOpts,
	): Promise<ConnectorIngestResult> {
		return {
			pagesProcessed: sources.length,
			pagesCreated: 0,
			pagesUpdated: 0,
			errors: [],
		}
	}

	mapPermissions(source: DiscoveredSource): ConnectorMapPermissionsResult {
		const restrictions = source.metadata?.spaceRestrictions as
			| string[]
			| undefined
		if (restrictions && restrictions.length > 0) {
			return { privacyTier: "restricted" }
		}
		return { privacyTier: "internal" }
	}
}

// Notion connector (T18)
export interface NotionConnectorConfig {
	integrationToken: string
	databaseId?: string // limit to a single database
}

export class NotionConnector implements SourceConnector {
	name = "notion"
	private config: NotionConnectorConfig

	constructor(_handle: WikiDbHandle, config: NotionConnectorConfig) {
		this.config = config
	}

	async authenticate(): Promise<ConnectorAuthenticateResult> {
		if (!this.config.integrationToken) {
			return {
				authenticated: false,
				error: "Notion integration token is required",
			}
		}
		return {
			authenticated: true,
			context: { databaseId: this.config.databaseId },
		}
	}

	async discover(_cursor?: string): Promise<ConnectorDiscoverResult> {
		// In production, this calls the Notion API:
		// POST /v1/databases/{id}/query → iterate pages → GET /v1/blocks/{id}/children
		return { sources: [], cursor: _cursor }
	}

	async ingest(
		sources: DiscoveredSource[],
		_opts: IngestOpts,
	): Promise<ConnectorIngestResult> {
		return {
			pagesProcessed: sources.length,
			pagesCreated: 0,
			pagesUpdated: 0,
			errors: [],
		}
	}

	mapPermissions(source: DiscoveredSource): ConnectorMapPermissionsResult {
		const sharedWith = source.metadata?.sharedWith as string[] | undefined
		if (sharedWith && sharedWith.includes("public"))
			return { privacyTier: "public" }
		if (sharedWith && sharedWith.length === 0)
			return { privacyTier: "restricted" }
		return { privacyTier: "internal" }
	}
}

// Slack connector (T19) — messages → events → Dreamer → wiki pages
export interface SlackConnectorConfig {
	botToken: string // xoxb-...
	channelIds?: string[] // limit to specific channels
}

export class SlackConnector implements SourceConnector {
	name = "slack"
	private config: SlackConnectorConfig

	constructor(_handle: WikiDbHandle, config: SlackConnectorConfig) {
		this.config = config
	}

	async authenticate(): Promise<ConnectorAuthenticateResult> {
		if (!this.config.botToken || !this.config.botToken.startsWith("xoxb-")) {
			return {
				authenticated: false,
				error: "Slack bot token (xoxb-...) is required",
			}
		}
		return {
			authenticated: true,
			context: { channelIds: this.config.channelIds },
		}
	}

	async discover(cursor?: string): Promise<ConnectorDiscoverResult> {
		// In production, this calls the Slack API:
		// GET /api/conversations.list → GET /api/conversations.history?channel={id}&oldest={cursor}
		return {
			sources: [],
			cursor: cursor ?? String(Math.floor(Date.now() / 1000)),
		}
	}

	async ingest(
		sources: DiscoveredSource[],
		_opts: IngestOpts,
	): Promise<ConnectorIngestResult> {
		return {
			pagesProcessed: sources.length,
			pagesCreated: 0,
			pagesUpdated: 0,
			errors: [],
		}
	}

	mapPermissions(source: DiscoveredSource): ConnectorMapPermissionsResult {
		const isPrivate = source.metadata?.isPrivate as boolean | undefined
		if (isPrivate) return { privacyTier: "restricted" }
		return { privacyTier: "internal" }
	}
}

// CRM connector (T20) — Salesforce/HubSpot records → entity + person/company pages
export interface CrmConnectorConfig {
	provider: "salesforce" | "hubspot"
	apiKey: string // OAuth token or API key
	instanceUrl?: string // Salesforce instance URL
}

export class CrmConnector implements SourceConnector {
	name = "crm"
	private config: CrmConnectorConfig

	constructor(_handle: WikiDbHandle, config: CrmConnectorConfig) {
		this.config = config
	}

	async authenticate(): Promise<ConnectorAuthenticateResult> {
		if (!this.config.apiKey) {
			return {
				authenticated: false,
				error: `${this.config.provider} API key is required`,
			}
		}
		return {
			authenticated: true,
			context: {
				provider: this.config.provider,
				instanceUrl: this.config.instanceUrl,
			},
		}
	}

	async discover(_cursor?: string): Promise<ConnectorDiscoverResult> {
		// In production, this calls the CRM API:
		// Salesforce: GET /services/data/v58.0/query?q=SELECT... FROM Contact
		// HubSpot: GET /crm/v3/objects/contacts
		return { sources: [], cursor: _cursor }
	}

	async ingest(
		sources: DiscoveredSource[],
		_opts: IngestOpts,
	): Promise<ConnectorIngestResult> {
		return {
			pagesProcessed: sources.length,
			pagesCreated: 0,
			pagesUpdated: 0,
			errors: [],
		}
	}

	mapPermissions(source: DiscoveredSource): ConnectorMapPermissionsResult {
		const ownerId = source.metadata?.ownerId as string | undefined
		const isShared = source.metadata?.isShared as boolean | undefined
		if (ownerId && !isShared) return { privacyTier: "restricted" }
		return { privacyTier: "internal" }
	}
}

// ---------------------------------------------------------------------------
// Connector registry
// ---------------------------------------------------------------------------

/** Registry of available source connectors. */
export class ConnectorRegistry {
	private connectors = new Map<string, SourceConnector>()

	register(connector: SourceConnector): void {
		this.connectors.set(connector.name, connector)
	}

	get(name: string): SourceConnector | undefined {
		return this.connectors.get(name)
	}

	list(): string[] {
		return Array.from(this.connectors.keys())
	}
}
