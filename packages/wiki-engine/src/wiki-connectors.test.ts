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
		findOneAndUpdate: vi.fn(async () => ({ value: null })),
		updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
		deleteOne: vi.fn(async () => ({ deletedCount: 0 })),
		aggregate: vi.fn(() => ({ toArray: async () => [] })),
	} as unknown as Collection
	const db = { collection: vi.fn(() => coll) } as unknown as Db
	return { db, prefix: "test_" }
}

// Constants SCOPE and SCOPE_REF are used in integration tests that mock
// the OKF import — the mock handle doesn't actually call importOkfBundle.

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

	it("exportToVault writes .md files for wiki pages", async () => {
		const conn = new ObsidianConnector(mockHandle(), { vaultPath: tmpVault })
		const count = await conn.exportToVault([
			{
				slug: "test-page",
				title: "Test Page",
				summary: "A test page.",
				body: "Body content.",
			},
		])
		expect(count).toBe(1)
		const content = fs.readFileSync(
			path.join(tmpVault, "test-page.md"),
			"utf-8",
		)
		expect(content).toContain("Test Page")
		expect(content).toContain("A test page.")
		expect(content).toContain("Body content.")
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
		expect(result.context?.token).toBe("ghp_testtoken")
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
