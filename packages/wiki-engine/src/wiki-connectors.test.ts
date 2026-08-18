// wiki-connectors.ts tests (T15 Obsidian + T16 GitHub).
//
// Tests:
// - Connector ABC: authenticate, discover, ingest, mapPermissions
// - Obsidian: vault discovery, .md file ingestion, export to vault, watcher
// - GitHub: auth (token required), permission mapping (public/private/secret)
// - ConnectorRegistry: register, get, list

/* eslint-disable @typescript-eslint/unbound-method -- Vitest mock assertions */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Collection, Db, Document } from "mongodb"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
	ObsidianConnector,
	GitHubConnector,
	ConfluenceConnector,
	NotionConnector,
	SlackConnector,
	CrmConnector,
	ConnectorRegistry,
} from "./wiki-connectors.js"
import type { WikiDbHandle } from "./wiki-bridge.js"

function mockHandle(): WikiDbHandle {
	const coll = {
		insertOne: vi.fn(async (doc: Document) => ({
			acknowledged: true,
			insertedId: { toString: () => `id-${doc.slug}` },
		})),
		findOne: vi.fn(async () => null),
		find: vi.fn(() => ({
			sort: vi.fn(() => ({
				skip: vi.fn(() => ({
					limit: vi.fn(() => ({ toArray: async () => [] })),
				})),
			})),
		})),
		countDocuments: vi.fn(async () => 0),
		findOneAndUpdate: vi.fn(async () => null),
		updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
		deleteOne: vi.fn(async () => ({ deletedCount: 0 })),
		aggregate: vi.fn(() => ({ toArray: async () => [] })),
	} as unknown as Collection
	const db = { collection: vi.fn(() => coll) } as unknown as Db
	return { db, prefix: "test_" }
}

describe("Connector ABC — ObsidianConnector", () => {
	let tmpVault: string

	beforeEach(() => {
		tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-vault-"))
	})

	afterEach(() => {
		fs.rmSync(tmpVault, { recursive: true, force: true })
	})

	it("authenticate succeeds when vault path exists", async () => {
		const conn = new ObsidianConnector(mockHandle(), { vaultPath: tmpVault })
		const result = await conn.authenticate()
		expect(result.authenticated).toBe(true)
	})

	it("authenticate fails when vault path does not exist", async () => {
		const conn = new ObsidianConnector(mockHandle(), {
			vaultPath: "/nonexistent/vault",
		})
		const result = await conn.authenticate()
		expect(result.authenticated).toBe(false)
		expect(result.error).toContain("does not exist")
	})

	it("discover finds .md files in the vault (skips hidden dirs)", async () => {
		// Create some test .md files.
		fs.writeFileSync(path.join(tmpVault, "note1.md"), "# Note 1\n", "utf-8")
		fs.mkdirSync(path.join(tmpVault, "folder"), { recursive: true })
		fs.writeFileSync(
			path.join(tmpVault, "folder/note2.md"),
			"# Note 2\n",
			"utf-8",
		)
		// Create a hidden directory with a .md file (should be skipped).
		fs.mkdirSync(path.join(tmpVault, ".obsidian"), { recursive: true })
		fs.writeFileSync(
			path.join(tmpVault, ".obsidian/config.md"),
			"config\n",
			"utf-8",
		)

		const conn = new ObsidianConnector(mockHandle(), { vaultPath: tmpVault })
		const result = await conn.discover()
		expect(result.sources).toHaveLength(2)
		const ids = result.sources.map((s) => s.id)
		expect(ids).toContain("note1.md")
		expect(ids).toContain("folder/note2.md")
		// Hidden directory skipped.
		expect(ids).not.toContain(".obsidian/config.md")
	})

	it("discover with cursor only returns files modified since cursor", async () => {
		const oldFile = path.join(tmpVault, "old.md")
		const newFile = path.join(tmpVault, "new.md")
		fs.writeFileSync(oldFile, "old\n", "utf-8")
		// Set old file's mtime to 1 hour ago.
		const oldTime = new Date(Date.now() - 3600_000)
		fs.utimesSync(oldFile, oldTime, oldTime)
		fs.writeFileSync(newFile, "new\n", "utf-8")

		const conn = new ObsidianConnector(mockHandle(), { vaultPath: tmpVault })
		// Cursor = 30 minutes ago → only new.md should be returned.
		const cursor = new Date(Date.now() - 1800_000).toISOString()
		const result = await conn.discover(cursor)
		expect(result.sources).toHaveLength(1)
		expect(result.sources[0].id).toBe("new.md")
	})

	it("mapPermissions returns internal for Obsidian vaults", async () => {
		const conn = new ObsidianConnector(mockHandle(), { vaultPath: tmpVault })
		const result = conn.mapPermissions({
			id: "test.md",
			path: "/vault/test.md",
			content: "",
		})
		expect(result.privacyTier).toBe("internal")
	})

	it("exportToVault writes safe nested namespace slugs beneath the vault", async () => {
		const conn = new ObsidianConnector(mockHandle(), { vaultPath: tmpVault })
		const count = await conn.exportToVault([
			{
				slug: "tables/users",
				title: "Test Page",
				summary: "A test page.",
				body: "Body content.",
			},
		])
		expect(count).toBe(1)
		const content = fs.readFileSync(
			path.join(tmpVault, "tables/users.md"),
			"utf-8",
		)
		expect(content).toContain("Test Page")
		expect(content).toContain("A test page.")
		expect(content).toContain("Body content.")
	})

	it("exportToVault rejects slugs that escape the configured vault", async () => {
		const conn = new ObsidianConnector(mockHandle(), { vaultPath: tmpVault })
		await expect(
			conn.exportToVault([
				{
					slug: "../escaped",
					title: "Escaped",
					summary: "No",
					body: "No",
				},
			]),
		).rejects.toThrow(/outside the configured vault/)
	})

	it("exportToVault rejects a symlinked namespace that escapes the vault", async () => {
		const outsideDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "obsidian-outside-"),
		)
		fs.symlinkSync(
			outsideDir,
			path.join(tmpVault, "tables"),
			process.platform === "win32" ? "junction" : "dir",
		)
		const conn = new ObsidianConnector(mockHandle(), { vaultPath: tmpVault })

		try {
			await expect(
				conn.exportToVault([
					{
						slug: "tables/users",
						title: "Users",
						summary: "User records.",
						body: "Body",
					},
				]),
			).rejects.toThrow(/outside|symlink|vault|path/i)
			expect(fs.existsSync(path.join(outsideDir, "users.md"))).toBe(false)
		} finally {
			fs.rmSync(outsideDir, { recursive: true, force: true })
		}
	})

	it("exportToVault rejects a dangling final symlink before writing", async () => {
		const outsideDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "obsidian-outside-file-"),
		)
		const outsideFile = path.join(outsideDir, "escaped.md")
		fs.symlinkSync(
			outsideFile,
			path.join(tmpVault, "z-note.md"),
			process.platform === "win32" ? "file" : undefined,
		)
		const conn = new ObsidianConnector(mockHandle(), { vaultPath: tmpVault })

		try {
			await expect(
				conn.exportToVault([
					{
						slug: "a-safe-note",
						title: "Safe Note",
						summary: "Must not be partially written.",
						body: "Body",
					},
					{
						slug: "z-note",
						title: "Note",
						summary: "Must not escape.",
						body: "Body",
					},
				]),
			).rejects.toThrow(/outside|symlink|vault|path/i)
			expect(fs.existsSync(outsideFile)).toBe(false)
			expect(fs.existsSync(path.join(tmpVault, "a-safe-note.md"))).toBe(false)
		} finally {
			fs.rmSync(outsideDir, { recursive: true, force: true })
		}
	})
})

describe("Connector ABC — GitHubConnector", () => {
	it("authenticate fails without a token", async () => {
		const conn = new GitHubConnector(mockHandle(), { repo: "owner/repo" })
		const result = await conn.authenticate()
		expect(result.authenticated).toBe(false)
		expect(result.error).toContain("token is required")
	})

	it("authenticate succeeds with a token", async () => {
		const conn = new GitHubConnector(mockHandle(), {
			repo: "owner/repo",
			token: "ghp_testtoken",
		})
		const result = await conn.authenticate()
		expect(result.authenticated).toBe(true)
		expect(result.context).toEqual({ repo: "owner/repo", branch: "main" })
	})

	it("ingest is read-only and does not write discovered sources directly", async () => {
		const conn = new GitHubConnector(mockHandle(), {
			repo: "owner/repo",
			token: "ghp_testtoken",
		})
		const result = await conn.ingest(
			[{ id: "1", path: "README.md", content: "untrusted" }],
			{ scope: "workspace", scopeRef: "ws-1" },
		)
		expect(result).toEqual({
			pagesProcessed: 1,
			pagesCreated: 0,
			pagesUpdated: 0,
			errors: [],
		})
	})

	it("mapPermissions: public repo → public", () => {
		const conn = new GitHubConnector(mockHandle(), {
			repo: "owner/repo",
			token: "t",
		})
		const result = conn.mapPermissions({
			id: "src/api.ts",
			path: "src/api.ts",
			content: "",
			metadata: { visibility: "public" },
		})
		expect(result.privacyTier).toBe("public")
	})

	it("mapPermissions: private repo → internal", () => {
		const conn = new GitHubConnector(mockHandle(), {
			repo: "owner/repo",
			token: "t",
		})
		const result = conn.mapPermissions({
			id: "src/api.ts",
			path: "src/api.ts",
			content: "",
			metadata: { visibility: "private" },
		})
		expect(result.privacyTier).toBe("internal")
	})

	it("mapPermissions: unknown visibility → restricted", () => {
		const conn = new GitHubConnector(mockHandle(), {
			repo: "owner/repo",
			token: "t",
		})
		const result = conn.mapPermissions({
			id: "src/api.ts",
			path: "src/api.ts",
			content: "",
		})
		expect(result.privacyTier).toBe("restricted")
	})

	it("discover returns empty sources with HEAD cursor (placeholder for git API)", async () => {
		const conn = new GitHubConnector(mockHandle(), {
			repo: "owner/repo",
			token: "t",
		})
		const result = await conn.discover()
		expect(result.sources).toHaveLength(0)
		expect(result.cursor).toBe("HEAD")
	})
})

describe("ConnectorRegistry", () => {
	it("register, get, and list connectors", () => {
		const registry = new ConnectorRegistry()
		const obsidian = new ObsidianConnector(mockHandle(), {
			vaultPath: "/tmp/vault",
		})
		const github = new GitHubConnector(mockHandle(), {
			repo: "owner/repo",
			token: "t",
		})
		registry.register(obsidian)
		registry.register(github)

		expect(registry.list()).toEqual(["obsidian", "github"])
		expect(registry.get("obsidian")).toBe(obsidian)
		expect(registry.get("github")).toBe(github)
		expect(registry.get("nonexistent")).toBeUndefined()
	})
})

describe("ConfluenceConnector", () => {
	it("authenticate fails without token/email", async () => {
		const conn = new ConfluenceConnector(mockHandle(), {
			host: "https://test.atlassian.net",
			apiToken: "",
			email: "",
		})
		const result = await conn.authenticate()
		expect(result.authenticated).toBe(false)
		expect(result.error).toContain("required")
	})

	it("authenticate succeeds with token + email", async () => {
		const conn = new ConfluenceConnector(mockHandle(), {
			host: "https://test.atlassian.net",
			apiToken: "token",
			email: "user@test.com",
		})
		const result = await conn.authenticate()
		expect(result.authenticated).toBe(true)
		expect(result.context).toEqual({
			host: "https://test.atlassian.net",
			spaceKey: undefined,
		})
	})

	it("mapPermissions: restricted when space has restrictions", () => {
		const conn = new ConfluenceConnector(mockHandle(), {
			host: "https://test.atlassian.net",
			apiToken: "t",
			email: "u@test.com",
		})
		expect(
			conn.mapPermissions({
				id: "1",
				path: "p",
				content: "",
				metadata: { spaceRestrictions: ["admin"] },
			}).privacyTier,
		).toBe("restricted")
	})

	it("mapPermissions: internal when no restrictions", () => {
		const conn = new ConfluenceConnector(mockHandle(), {
			host: "https://test.atlassian.net",
			apiToken: "t",
			email: "u@test.com",
		})
		expect(
			conn.mapPermissions({ id: "1", path: "p", content: "" }).privacyTier,
		).toBe("internal")
	})
})

describe("NotionConnector", () => {
	it("authenticate fails without token", async () => {
		const conn = new NotionConnector(mockHandle(), { integrationToken: "" })
		const result = await conn.authenticate()
		expect(result.authenticated).toBe(false)
	})

	it("authenticate succeeds with token", async () => {
		const conn = new NotionConnector(mockHandle(), {
			integrationToken: "ntn_test",
		})
		const result = await conn.authenticate()
		expect(result.authenticated).toBe(true)
		expect(result.context).toEqual({ databaseId: undefined })
	})

	it("mapPermissions: public when shared with public", () => {
		const conn = new NotionConnector(mockHandle(), { integrationToken: "t" })
		expect(
			conn.mapPermissions({
				id: "1",
				path: "p",
				content: "",
				metadata: { sharedWith: ["public"] },
			}).privacyTier,
		).toBe("public")
	})

	it("mapPermissions: restricted when not shared", () => {
		const conn = new NotionConnector(mockHandle(), { integrationToken: "t" })
		expect(
			conn.mapPermissions({
				id: "1",
				path: "p",
				content: "",
				metadata: { sharedWith: [] },
			}).privacyTier,
		).toBe("restricted")
	})
})

describe("SlackConnector", () => {
	it("authenticate fails without valid bot token", async () => {
		const conn = new SlackConnector(mockHandle(), { botToken: "invalid" })
		const result = await conn.authenticate()
		expect(result.authenticated).toBe(false)
		expect(result.error).toContain("xoxb-")
	})

	it("authenticate succeeds with xoxb- token", async () => {
		const conn = new SlackConnector(mockHandle(), { botToken: "xoxb-test" })
		const result = await conn.authenticate()
		expect(result.authenticated).toBe(true)
		expect(result.context).toEqual({ channelIds: undefined })
	})

	it("mapPermissions: restricted for private channels", () => {
		const conn = new SlackConnector(mockHandle(), { botToken: "xoxb-t" })
		expect(
			conn.mapPermissions({
				id: "C1",
				path: "C1",
				content: "",
				metadata: { isPrivate: true },
			}).privacyTier,
		).toBe("restricted")
	})

	it("mapPermissions: internal for public channels", () => {
		const conn = new SlackConnector(mockHandle(), { botToken: "xoxb-t" })
		expect(
			conn.mapPermissions({ id: "C1", path: "C1", content: "" }).privacyTier,
		).toBe("internal")
	})
})

describe("CrmConnector", () => {
	it("authenticate fails without API key", async () => {
		const conn = new CrmConnector(mockHandle(), {
			provider: "salesforce",
			apiKey: "",
		})
		const result = await conn.authenticate()
		expect(result.authenticated).toBe(false)
		expect(result.error).toContain("salesforce")
	})

	it("authenticate succeeds with API key", async () => {
		const conn = new CrmConnector(mockHandle(), {
			provider: "hubspot",
			apiKey: "key",
		})
		const result = await conn.authenticate()
		expect(result.authenticated).toBe(true)
		expect(result.context).toEqual({
			provider: "hubspot",
			instanceUrl: undefined,
		})
	})

	it("mapPermissions: restricted when owned and not shared", () => {
		const conn = new CrmConnector(mockHandle(), {
			provider: "salesforce",
			apiKey: "k",
		})
		expect(
			conn.mapPermissions({
				id: "1",
				path: "p",
				content: "",
				metadata: { ownerId: "user-1", isShared: false },
			}).privacyTier,
		).toBe("restricted")
	})

	it("mapPermissions: internal when shared", () => {
		const conn = new CrmConnector(mockHandle(), {
			provider: "salesforce",
			apiKey: "k",
		})
		expect(
			conn.mapPermissions({
				id: "1",
				path: "p",
				content: "",
				metadata: { ownerId: "u", isShared: true },
			}).privacyTier,
		).toBe("internal")
	})
})
