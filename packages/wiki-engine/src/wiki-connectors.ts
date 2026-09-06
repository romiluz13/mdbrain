// @mdbrain/wiki-engine — source connectors.
//
// Connector ABC for ingesting external sources into wiki_pages, plus the
// Obsidian connector (beta): real vault discovery + path-contained export;
// `ingest` throws `ConnectorNotImplementedError` until the post-sale roadmap
// item lands. The GitHub/Confluence/Notion/Slack/CRM shell connectors were
// removed (agreed plan W4): they reported success while writing nothing.
//
// T15 (Obsidian).

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
	/** Connector name (e.g. "obsidian"). */
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

/** Thrown when a connector method is intentionally unimplemented, so the
 *  connector surface stays honest about what ships. */
export class ConnectorNotImplementedError extends Error {
	constructor(
		public readonly connectorName: string,
		detail: string,
	) {
		super(`connector "${connectorName}": ${detail}`)
		this.name = "ConnectorNotImplementedError"
	}
}

// ---------------------------------------------------------------------------
// Obsidian connector (T15) — beta
// ---------------------------------------------------------------------------

export interface ObsidianConnectorConfig {
	/** Path to the Obsidian vault root directory. */
	vaultPath: string
	/** File watcher enabled (default true). */
	watch?: boolean
}

/** Obsidian connector (beta): real vault discovery + path-contained export;
 *  `ingest` throws `ConnectorNotImplementedError` until the post-sale
 *  roadmap item lands. */
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
		_sources: DiscoveredSource[],
		_opts: IngestOpts,
	): Promise<ConnectorIngestResult> {
		// Honest surface: discovery and export are implemented; ingest is a
		// post-sale roadmap item. Never report success without writing.
		throw new ConnectorNotImplementedError(
			"obsidian",
			"ingest is a post-sale roadmap item (vault discovery and path-contained export are implemented today)",
		)
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
