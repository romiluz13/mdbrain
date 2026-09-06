// wiki-connectors.ts tests (T15 Obsidian, beta).
//
// Tests:
// - Connector ABC: authenticate, discover, mapPermissions
// - Obsidian (beta): vault discovery, ingest throws ConnectorNotImplementedError
//   (honest surface), export to vault, watcher
// - ConnectorRegistry: register, get, list

/* eslint-disable @typescript-eslint/unbound-method -- Vitest mock assertions */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Collection, Db, Document } from "mongodb"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
	ConnectorNotImplementedError,
	ConnectorRegistry,
	ObsidianConnector,
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

describe("Connector ABC — ObsidianConnector (beta)", () => {
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

	it("ingest throws ConnectorNotImplementedError (honest beta surface)", async () => {
		const conn = new ObsidianConnector(mockHandle(), { vaultPath: tmpVault })
		await expect(
			conn.ingest([{ id: "note.md", path: "note.md", content: "# Note" }], {
				scope: "workspace",
				scopeRef: "ws-1",
			}),
		).rejects.toBeInstanceOf(ConnectorNotImplementedError)
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

describe("ConnectorRegistry", () => {
	it("register, get, and list connectors", () => {
		const registry = new ConnectorRegistry()
		const obsidian = new ObsidianConnector(mockHandle(), {
			vaultPath: "/tmp/vault",
		})
		registry.register(obsidian)

		expect(registry.list()).toEqual(["obsidian"])
		expect(registry.get("obsidian")).toBe(obsidian)
		expect(registry.get("nonexistent")).toBeUndefined()
	})
})
