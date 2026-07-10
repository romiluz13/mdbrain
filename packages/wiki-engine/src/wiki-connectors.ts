// @mdbrian/wiki-engine — source connectors.
//
// Connector ABC for ingesting external sources into wiki_pages, plus concrete
// implementations for Obsidian (bidirectional vault sync) and GitHub
// (repo-as-source via git-diff maintenance).
//
// T15 (Obsidian) + T16 (GitHub repo-as-source).

import {
	existsSync,
	readFileSync,
	watch,
	writeFileSync,
	readdirSync,
	statSync,
	mkdirSync,
} from "node:fs"
import { join, dirname, basename, extname, relative } from "node:path"
import { importOkfBundle } from "./okf.js"
import type { WikiDbHandle } from "./wiki-bridge.js"
import {
	runGitDiffMaintenance,
	type LlmGenerateFn,
	type ChangedSource,
} from "./wiki-maintenance.js"

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
	private handle: WikiDbHandle
	private watcher?: ReturnType<typeof watch>

	constructor(handle: WikiDbHandle, config: ObsidianConnectorConfig) {
		this.handle = handle
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
			context: { vaultPath: this.config.vaultPath },
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
		opts: IngestOpts,
	): Promise<ConnectorIngestResult> {
		const result: ConnectorIngestResult = {
			pagesProcessed: 0,
			pagesCreated: 0,
			pagesUpdated: 0,
			errors: [],
		}

		for (const source of sources) {
			try {
				result.pagesProcessed++
				// Obsidian .md files are in OKF format → import via OKF bundle.
				// Each file is a single "bundle" of one concept.
				const slug = source.id.replace(/\.md$/, "").replace(/[/\\]/g, "/")
				const okfBundleDir = join(this.config.vaultPath, dirname(source.id))
				await importOkfBundle(this.handle, okfBundleDir, {
					scope: opts.scope as
						| "workspace"
						| "session"
						| "user"
						| "agent"
						| "tenant"
						| "global",
					scopeRef: opts.scopeRef,
					trustTier: (opts.trustTier ?? "standard") as
						| "restricted"
						| "standard"
						| "admin",
					okfBundleId: `obsidian-${slug}`,
				})
				result.pagesCreated++
			} catch (err) {
				result.errors.push(
					`${source.id}: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}

		return result
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
		let count = 0
		for (const page of pages) {
			const filePath = join(this.config.vaultPath, `${page.slug}.md`)
			const dir = dirname(filePath)
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
			const frontmatter = `---\ntype: concept\ntitle: ${page.title}\n---\n\n`
			const content = `${frontmatter}# ${page.title}\n\n${page.summary}\n\n${page.body}\n`
			writeFileSync(filePath, content, "utf-8")
			count++
		}
		return count
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
	private handle: WikiDbHandle

	constructor(handle: WikiDbHandle, config: GitHubConnectorConfig) {
		this.handle = handle
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
			context: { token: this.config.token, repo: this.config.repo },
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
		opts: IngestOpts,
	): Promise<ConnectorIngestResult> {
		const result: ConnectorIngestResult = {
			pagesProcessed: 0,
			pagesCreated: 0,
			pagesUpdated: 0,
			errors: [],
		}

		// Convert discovered sources to ChangedSource format for git-diff maintenance.
		const changedSources: ChangedSource[] = sources.map((s) => ({
			path: s.path,
			content: s.content,
		}))

		// Use a simple LLM that extracts a summary from the file content.
		const llmGenerate: LlmGenerateFn = async (input) => ({
			title: basename(input.sourceFile),
			summary: input.changedSnippet.slice(0, 100),
			body: input.changedSnippet,
			claims: [],
		})

		const maintenanceResult = await runGitDiffMaintenance(
			this.handle,
			changedSources,
			llmGenerate,
			{
				scope: opts.scope,
				scopeRef: opts.scopeRef,
				trustTier: opts.trustTier,
				agentId: opts.agentId,
			},
		)

		result.pagesProcessed = maintenanceResult.pagesProcessed
		result.pagesCreated = maintenanceResult.pagesRegenerated
		result.pagesUpdated = maintenanceResult.pagesRegenerated
		result.errors = maintenanceResult.errors

		return result
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
