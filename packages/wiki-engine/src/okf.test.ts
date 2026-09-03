// OKF interchange round-trip tests (T4).
//
// Verifies: import a bundle → wiki_pages (via mocked bridge), export → bundle
// on disk, re-import → assert structure preserved. Uses a temp directory and
// mocks the MongoDB collection so no live DB is required.

/* eslint-disable @typescript-eslint/unbound-method -- Vitest mock method assertions */
import type { Collection, Db, Document } from "mongodb"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	importOkfBundle,
	exportOkfBundle,
	parseOkfAllowedRoots,
} from "./okf.js"
import { getWikiPage, type WikiDbHandle } from "./wiki-bridge.js"
import { filterPagesByGovernance } from "./wiki-governance.js"

// In-memory wiki_pages store keyed by slug+scope+scopeRef.
function makeStore() {
	const docs = new Map<string, Document>()
	const key = (slug: string, scope: string, scopeRef: string) =>
		`${slug}|${scope}|${scopeRef}`
	return { docs, key }
}

function mockDb(store: ReturnType<typeof makeStore>): {
	db: Db
	coll: Collection
	revisionsInsertOne: ReturnType<typeof vi.fn>
} {
	const coll = {
		collectionName: "test_wiki_pages",
		insertOne: vi.fn(async (doc: Document) => {
			const k = store.key(doc.slug, doc.scope, doc.scopeRef)
			if (store.docs.has(k)) {
				const err = new Error("E11000 duplicate key error")
				throw err
			}
			const id = { toString: () => `id-${k}` }
			store.docs.set(k, { ...doc, _id: id })
			return { acknowledged: true, insertedId: id }
		}),
		findOne: vi.fn(async (filter: Document) => {
			for (const doc of Array.from(store.docs.values())) {
				if (
					(!filter.slug || doc.slug === filter.slug) &&
					(!filter.scope || doc.scope === filter.scope) &&
					(!filter.scopeRef || doc.scopeRef === filter.scopeRef)
				) {
					return doc
				}
			}
			return null
		}),
		find: vi.fn((filter: Document) => {
			const matched = Array.from(store.docs.values()).filter((doc) => {
				for (const [k, v] of Object.entries(filter)) {
					if (doc[k] !== v) return false
				}
				return true
			})
			const sorted = matched.sort(
				(a, b) =>
					new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
			)
			return {
				sort: vi.fn(() => ({
					skip: vi.fn(() => ({
						limit: vi.fn(() => ({ toArray: async () => sorted })),
					})),
				})),
			}
		}),
		countDocuments: vi.fn(async (filter: Document) => {
			let n = 0
			for (const doc of Array.from(store.docs.values())) {
				let ok = true
				for (const [k, v] of Object.entries(filter)) {
					if (doc[k] !== v) ok = false
				}
				if (ok) n++
			}
			return n
		}),
		findOneAndUpdate: vi.fn(async (filter: Document, update: Document) => {
			const k = store.key(filter.slug, filter.scope, filter.scopeRef)
			const existing = store.docs.get(k)
			if (!existing) return null
			const updated = {
				...existing,
				...update.$set,
				revision: (existing.revision ?? 1) + (update.$inc?.revision ?? 0),
			}
			store.docs.set(k, updated)
			return updated
		}),
		updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
		deleteOne: vi.fn(async () => ({ deletedCount: 1 })),
		aggregate: vi.fn(() => ({ toArray: async () => [] })),
	} as unknown as Collection
	// wiki_revisions is a separate collection from wiki_pages — routing every
	// name to the same mock `coll` would make importOkfBundle's best-effort
	// revision-history writes land in the wiki_pages store and corrupt
	// document counts these tests assert on.
	const revisionsInsertOne = vi.fn(async () => ({
		acknowledged: true,
		insertedId: { toString: () => "rev" },
	}))
	const revisionsColl = {
		insertOne: revisionsInsertOne,
	} as unknown as Collection
	const db = {
		collection: vi.fn((name: string) =>
			name.endsWith("wiki_revisions") ? revisionsColl : coll,
		),
	} as unknown as Db
	return { db, coll, revisionsInsertOne }
}

describe("OKF import + export round-trip", () => {
	let tmpDir: string
	let store: ReturnType<typeof makeStore>
	let handle: WikiDbHandle

	const previousAllowedRoots = process.env.MDBRAIN_OKF_ALLOWED_ROOTS

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdbrain-okf-"))
		store = makeStore()
		const { db } = mockDb(store)
		handle = { db, prefix: "test_" }
		// validateOkfPath fails closed by default (see okf.ts) — tests must opt
		// the tmp sandbox in explicitly, exactly like a real deployment would.
		process.env.MDBRAIN_OKF_ALLOWED_ROOTS = os.tmpdir()
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
		if (previousAllowedRoots === undefined) {
			delete process.env.MDBRAIN_OKF_ALLOWED_ROOTS
		} else {
			process.env.MDBRAIN_OKF_ALLOWED_ROOTS = previousAllowedRoots
		}
	})

	function writeBundle(dir: string, files: Record<string, string>) {
		for (const [rel, content] of Object.entries(files)) {
			const full = path.join(dir, rel)
			fs.mkdirSync(path.dirname(full), { recursive: true })
			fs.writeFileSync(full, content, "utf-8")
		}
	}

	function addExportPage(slug: string): void {
		store.docs.set(store.key(slug, "workspace", "ws-1"), {
			_id: { toString: () => `id-${slug}` },
			kind: "concept",
			title: "Unsafe path",
			slug,
			aliases: [],
			summary: "Must not be written.",
			body: "",
			frontmatter: { type: "concept" },
			claims: [],
			contradictions: [],
			questions: [],
			relationships: [],
			personCard: null,
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			permissions: {},
			state: "active",
			revision: 1,
			validFrom: new Date(),
			freshness: "fresh",
			backlinks: [],
			embedding: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		})
	}

	it("rejects a parent-traversal page slug before writing the export", async () => {
		const slug = "../escaped-parent"
		addExportPage(slug)
		const exportDir = path.join(tmpDir, "exported-traversal")
		const escapedPath = path.join(tmpDir, "escaped-parent.md")

		await expect(
			exportOkfBundle(handle, {
				scope: "workspace",
				scopeRef: "ws-1",
				outDir: exportDir,
				governance: {
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: "admin",
				},
			}),
		).rejects.toThrow(/slug|path|traversal/i)
		expect(fs.existsSync(exportDir)).toBe(false)
		expect(fs.existsSync(escapedPath)).toBe(false)
	})

	it("rejects a Windows-separator traversal slug on every platform", async () => {
		const slug = String.raw`..\escaped-windows`
		addExportPage(slug)
		const exportDir = path.join(tmpDir, "exported-windows-traversal")

		await expect(
			exportOkfBundle(handle, {
				scope: "workspace",
				scopeRef: "ws-1",
				outDir: exportDir,
				governance: {
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: "admin",
				},
			}),
		).rejects.toThrow(/slug|path|traversal/i)
		expect(fs.existsSync(exportDir)).toBe(false)
	})

	it("rejects a non-traversal backslash slug before writing the export", async () => {
		const slug = String.raw`tables\users`
		addExportPage(slug)
		const exportDir = path.join(tmpDir, "exported-backslash")

		await expect(
			exportOkfBundle(handle, {
				scope: "workspace",
				scopeRef: "ws-1",
				outDir: exportDir,
				governance: {
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: "admin",
				},
			}),
		).rejects.toThrow(/platform separator|slug|path/i)
		expect(fs.existsSync(exportDir)).toBe(false)
	})

	it("rejects an absolute page slug before writing the export", async () => {
		const slug = "/absolute-page"
		addExportPage(slug)
		const exportDir = path.join(tmpDir, "exported-absolute")

		await expect(
			exportOkfBundle(handle, {
				scope: "workspace",
				scopeRef: "ws-1",
				outDir: exportDir,
				governance: {
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: "admin",
				},
			}),
		).rejects.toThrow(/absolute|slug|path/i)
		expect(fs.existsSync(exportDir)).toBe(false)
	})

	it("rejects a Windows drive path slug on every platform", async () => {
		const slug = "C:/absolute-page"
		addExportPage(slug)
		const exportDir = path.join(tmpDir, "exported-windows-absolute")

		await expect(
			exportOkfBundle(handle, {
				scope: "workspace",
				scopeRef: "ws-1",
				outDir: exportDir,
				governance: {
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: "admin",
				},
			}),
		).rejects.toThrow(/absolute|slug|path/i)
		expect(fs.existsSync(exportDir)).toBe(false)
	})

	it("rejects a Windows drive-relative slug on every platform", async () => {
		const slug = "C:relative-page"
		addExportPage(slug)
		const exportDir = path.join(tmpDir, "exported-windows-drive-relative")

		await expect(
			exportOkfBundle(handle, {
				scope: "workspace",
				scopeRef: "ws-1",
				outDir: exportDir,
				governance: {
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: "admin",
				},
			}),
		).rejects.toThrow(/drive|slug|path/i)
		expect(fs.existsSync(exportDir)).toBe(false)
	})

	it("rejects a symlinked namespace that redirects an export outside its root", async () => {
		const srcDir = path.join(tmpDir, "src-symlink")
		writeBundle(srcDir, {
			"tables/users.md": `---
type: table
title: Users
---

User records.
`,
		})
		await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
		})

		const exportDir = path.join(tmpDir, "exported-symlink")
		const outsideDir = path.join(tmpDir, "outside")
		fs.mkdirSync(exportDir)
		fs.mkdirSync(outsideDir)
		fs.symlinkSync(
			outsideDir,
			path.join(exportDir, "tables"),
			process.platform === "win32" ? "junction" : "dir",
		)

		await expect(
			exportOkfBundle(handle, {
				scope: "workspace",
				scopeRef: "ws-1",
				outDir: exportDir,
				governance: {
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: "admin",
				},
			}),
		).rejects.toThrow(/outside|symlink|root|path/i)
		expect(fs.existsSync(path.join(outsideDir, "users.md"))).toBe(false)
	})

	it("rejects a new export directory reached through an allowed-root symlink", async () => {
		const srcDir = path.join(tmpDir, "src-new-symlink")
		writeBundle(srcDir, {
			"users.md": `---
type: concept
title: Users
---

User records.
`,
		})
		await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
		})

		const allowedRoot = path.join(tmpDir, "allowed")
		const outsideDir = path.join(tmpDir, "outside-new")
		fs.mkdirSync(allowedRoot)
		fs.mkdirSync(outsideDir)
		fs.symlinkSync(
			outsideDir,
			path.join(allowedRoot, "linked"),
			process.platform === "win32" ? "junction" : "dir",
		)
		process.env.MDBRAIN_OKF_ALLOWED_ROOTS = allowedRoot
		const exportDir = path.join(allowedRoot, "linked", "new-export")

		await expect(
			exportOkfBundle(handle, {
				scope: "workspace",
				scopeRef: "ws-1",
				outDir: exportDir,
				governance: {
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: "admin",
				},
			}),
		).rejects.toThrow(/outside|symlink|root|path/i)
		expect(fs.existsSync(path.join(outsideDir, "new-export"))).toBe(false)
	})

	it("maps frontmatter.privacyTier into permissions on import so governance enforces it", async () => {
		const srcDir = path.join(tmpDir, "src-restricted")
		writeBundle(srcDir, {
			"secret.md": `---
type: concept
title: Secret
privacyTier: restricted
---

Classified content.
`,
		})
		const result = await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "b",
		})
		expect(result.imported).toBe(1)

		const doc = store.docs.get(store.key("secret", "workspace", "ws-1"))
		expect(doc).toBeDefined()
		// The OKF interchange tier is mapped into the governance SSOT...
		expect((doc as Record<string, unknown>).permissions).toMatchObject({
			privacyTier: "restricted",
		})
		// ...while still round-tripping in frontmatter for export.
		expect(
			((doc as Record<string, unknown>).frontmatter as Record<string, unknown>)
				.privacyTier,
		).toBe("restricted")

		// Unauthorized governed read returns EMPTY: governance reads only
		// page.permissions, and the imported tier now gates the page.
		const standardCtx = {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard" as const,
		}
		expect(filterPagesByGovernance([doc as Document], standardCtx)).toEqual([])
		// Admin still sees it.
		expect(
			filterPagesByGovernance([doc as Document], {
				...standardCtx,
				trustTier: "admin" as const,
			}),
		).toHaveLength(1)

		// Export under the standard context must not leak the restricted page.
		const stdExportDir = path.join(tmpDir, "export-std")
		const stdExport = await exportOkfBundle(handle, {
			scope: "workspace",
			scopeRef: "ws-1",
			outDir: stdExportDir,
			governance: standardCtx,
		})
		expect(stdExport.exported).toBe(0)
		// Admin export round-trips the frontmatter tier.
		const adminExportDir = path.join(tmpDir, "export-admin")
		await exportOkfBundle(handle, {
			scope: "workspace",
			scopeRef: "ws-1",
			outDir: adminExportDir,
			governance: { ...standardCtx, trustTier: "admin" as const },
		})
		const exported = fs.readFileSync(
			path.join(adminExportDir, "secret.md"),
			"utf-8",
		)
		expect(exported).toContain("privacyTier: restricted")
	})

	it("rejects an unknown frontmatter.privacyTier instead of importing it as open access", async () => {
		const srcDir = path.join(tmpDir, "src-bad-tier")
		writeBundle(srcDir, {
			"weird.md": `---
type: concept
title: Weird
privacyTier: top-secret
---

Content.
`,
		})
		const result = await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "b",
		})
		expect(result.imported).toBe(0)
		expect(result.skipped).toBe(1)
		expect(result.errors[0]?.error).toMatch(/privacyTier/)
		expect(store.docs.size).toBe(0)
	})

	it("keeps permissions in step with the frontmatter tier on re-import (update path)", async () => {
		const dir = path.join(tmpDir, "src-reimport")
		writeBundle(dir, {
			"concept.md": `---
type: concept
title: V1
---

V1 body.
`,
		})
		await importOkfBundle(handle, dir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "b",
		})
		const v1 = store.docs.get(store.key("concept", "workspace", "ws-1"))
		expect((v1 as Record<string, unknown>).permissions).toEqual({})

		// Re-import the same slug, now declaring a restricted tier. The update
		// path must carry the mapped permissions or the page would stay open
		// access despite the restricted frontmatter.
		writeBundle(dir, {
			"concept.md": `---
type: concept
title: V2
privacyTier: restricted
---

V2 body.
`,
		})
		await importOkfBundle(handle, dir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "b2",
		})
		const v2 = store.docs.get(store.key("concept", "workspace", "ws-1"))
		expect((v2 as Record<string, unknown>).permissions).toMatchObject({
			privacyTier: "restricted",
		})
	})

	it("rejects empty entries in MDBRAIN_OKF_ALLOWED_ROOTS", () => {
		expect(() => parseOkfAllowedRoots("a,,b")).toThrow(/empty entries/)
		expect(() => parseOkfAllowedRoots("a,")).toThrow(/empty entries/)
		expect(() => parseOkfAllowedRoots(" ,b")).toThrow(/empty entries/)
		expect(parseOkfAllowedRoots("a, b")).toEqual(["a", "b"])
		expect(parseOkfAllowedRoots("")).toEqual([])
		// The undefined default reads the live env, which sibling tests in
		// this file set — isolate it to assert the unset behavior.
		const prev = process.env.MDBRAIN_OKF_ALLOWED_ROOTS
		delete process.env.MDBRAIN_OKF_ALLOWED_ROOTS
		try {
			expect(parseOkfAllowedRoots(undefined)).toEqual([])
		} finally {
			if (prev !== undefined) process.env.MDBRAIN_OKF_ALLOWED_ROOTS = prev
		}
	})

	it("rejects an import directory reached through an allowed-root symlink", async () => {
		const allowedRoot = path.join(tmpDir, "allowed-import")
		const outsideDir = path.join(tmpDir, "outside-import")
		fs.mkdirSync(allowedRoot)
		fs.mkdirSync(outsideDir)
		writeBundle(outsideDir, {
			"a.md": "---\ntype: concept\ntitle: A\n---\n\nBody.\n",
		})
		fs.symlinkSync(
			outsideDir,
			path.join(allowedRoot, "linked"),
			process.platform === "win32" ? "junction" : "dir",
		)
		process.env.MDBRAIN_OKF_ALLOWED_ROOTS = allowedRoot

		await expect(
			importOkfBundle(handle, path.join(allowedRoot, "linked"), {
				scope: "workspace",
				scopeRef: "ws-1",
				trustTier: "standard",
				okfBundleId: "b",
			}),
		).rejects.toThrow(/outside|root|path/i)
		expect(store.docs.size).toBe(0)
	})

	it("imports a bundle, exports it, re-imports, and preserves structure", async () => {
		// 1. Write a source bundle.
		const srcDir = path.join(tmpDir, "src")
		writeBundle(srcDir, {
			"tables/accounts.md": `---
type: table
title: Accounts Table
description: Holds customer balance data.
tags: [finance]
timestamp: 2026-07-09T00:00:00Z
---

## Schema

- id: uuid
- balance: numeric

## Claims

- Balance is always positive _[active]_

## Relationships

- [relates_to] → [[tables/users]] Users
`,
			"tables/users.md": `---
type: table
title: Users Table
description: Application users.
tags: [auth]
---

## Schema

- id: uuid
- email: string
`,
			"index.md": `---
type: index
---

# Index

- [Accounts Table](tables/accounts.md)
- [Users Table](tables/users.md)
`,
		})

		// 2. Import → wiki_pages.
		const importResult = await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "bundle-1",
		})
		expect(importResult.imported).toBe(2)
		expect(importResult.errors).toEqual([])
		expect(store.docs.size).toBe(2)

		// 3. Export → bundle on disk.
		const exportDir = path.join(tmpDir, "exported")
		const exportResult = await exportOkfBundle(handle, {
			scope: "workspace",
			scopeRef: "ws-1",
			okfBundleId: "bundle-1",
			outDir: exportDir,
			governance: { scope: "workspace", scopeRef: "ws-1", trustTier: "admin" },
		})
		expect(exportResult.exported).toBe(2)
		expect(fs.existsSync(path.join(exportDir, "tables/accounts.md"))).toBe(true)
		expect(fs.existsSync(path.join(exportDir, "tables/users.md"))).toBe(true)
		expect(fs.existsSync(path.join(exportDir, "index.md"))).toBe(true)

		// 4. Re-import the exported bundle into a fresh store and verify structure.
		const store2 = makeStore()
		const { db: db2 } = mockDb(store2)
		const handle2: WikiDbHandle = { db: db2, prefix: "test_" }
		const reimport = await importOkfBundle(handle2, exportDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "bundle-1",
		})
		expect(reimport.imported).toBe(2)
		expect(reimport.errors).toEqual([])

		// 5. Assert structure preserved: the accounts page round-trips its
		//    title, frontmatter.type, tags, body schema section, claims, AND
		//    relationships — the fields the reviewers flagged as previously
		//    masked by weak assertions (claims status doubled, relationships
		//    duplicated). These assertions would have caught the original bugs.
		const accountsKey = store2.key("tables/accounts", "workspace", "ws-1")
		const accounts = store2.docs.get(accountsKey)!
		expect(accounts.title).toBe("Accounts Table")
		expect(accounts.frontmatter.type).toBe("table")
		expect(accounts.frontmatter.tags).toEqual(["finance"])
		expect(accounts.body).toContain("## Schema")
		expect(accounts.body).toContain("- id: uuid")
		expect(accounts.okfConceptId).toBe("tables/accounts")
		expect(accounts.okfBundleId).toBe("bundle-1")

		// Claims round-trip: status marker must NOT be doubled in the text.
		const claims = accounts.claims as Array<{ text: string; status: string }>
		expect(claims.length).toBe(1)
		expect(claims[0].text).toBe("Balance is always positive")
		expect(claims[0].text).not.toContain("_[active]_")

		// Relationships round-trip: the body [[tables/users]] link survives,
		// and is not duplicated. (Index siblings may add a users relationship too.)
		const rels = accounts.relationships as Array<{ targetPageSlug: string }>
		const usersRels = rels.filter((r) => r.targetPageSlug === "tables/users")
		expect(usersRels.length).toBeGreaterThanOrEqual(1)
		// The body must NOT contain a duplicated ## Relationships section.
		const bodyRelSections = (accounts.body.match(/## Relationships/g) || [])
			.length
		expect(bodyRelSections).toBe(0)

		// Round-trip stability: export the re-imported store again and verify
		// the claims count does NOT grow (no status-marker accumulation).
		const exportDir2 = path.join(tmpDir, "exported2")
		await exportOkfBundle(handle2, {
			scope: "workspace",
			scopeRef: "ws-1",
			okfBundleId: "bundle-1",
			outDir: exportDir2,
			governance: { scope: "workspace", scopeRef: "ws-1", trustTier: "admin" },
		})
		const exportedAccounts = fs.readFileSync(
			path.join(exportDir2, "tables/accounts.md"),
			"utf-8",
		)
		const exportedClaimLines = (
			exportedAccounts.match(/^- Balance is always positive/gm) || []
		).length
		expect(exportedClaimLines).toBe(1)
	})

	it("returns fileContents matching disk content when returnContent is true", async () => {
		const srcDir = path.join(tmpDir, "src-rc")
		writeBundle(srcDir, {
			"a.md": `---
type: concept
title: A
---

Body A.
`,
			"b.md": `---
type: concept
title: B
---

Body B.
`,
		})
		await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "bundle-rc",
		})
		const exportDir = path.join(tmpDir, "exported-rc")
		const result = await exportOkfBundle(handle, {
			scope: "workspace",
			scopeRef: "ws-1",
			okfBundleId: "bundle-rc",
			outDir: exportDir,
			governance: { scope: "workspace", scopeRef: "ws-1", trustTier: "admin" },
			returnContent: true,
		})
		expect(result.fileContents).toBeDefined()
		expect(Object.keys(result.fileContents!).sort()).toEqual(
			result.files.slice().sort(),
		)
		for (const file of result.files) {
			const onDisk = fs.readFileSync(path.join(exportDir, file), "utf-8")
			expect(result.fileContents![file]).toBe(onDisk)
		}
	})

	it("does not populate fileContents when returnContent is omitted or false", async () => {
		const srcDir = path.join(tmpDir, "src-noRc")
		writeBundle(srcDir, {
			"a.md": `---
type: concept
title: A
---

Body A.
`,
		})
		await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "bundle-noRc",
		})
		const exportDir1 = path.join(tmpDir, "exported-noRc-1")
		const resultDefault = await exportOkfBundle(handle, {
			scope: "workspace",
			scopeRef: "ws-1",
			okfBundleId: "bundle-noRc",
			outDir: exportDir1,
			governance: { scope: "workspace", scopeRef: "ws-1", trustTier: "admin" },
		})
		expect(resultDefault.fileContents).toBeUndefined()

		const exportDir2 = path.join(tmpDir, "exported-noRc-2")
		const resultFalse = await exportOkfBundle(handle, {
			scope: "workspace",
			scopeRef: "ws-1",
			okfBundleId: "bundle-noRc",
			outDir: exportDir2,
			governance: { scope: "workspace", scopeRef: "ws-1", trustTier: "admin" },
			returnContent: false,
		})
		expect(resultFalse.fileContents).toBeUndefined()
	})

	it("still writes files to disk when returnContent is true", async () => {
		const srcDir = path.join(tmpDir, "src-diskcheck")
		writeBundle(srcDir, {
			"a.md": `---
type: concept
title: A
---

Body A.
`,
		})
		await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "bundle-diskcheck",
		})
		const exportDir = path.join(tmpDir, "exported-diskcheck")
		const result = await exportOkfBundle(handle, {
			scope: "workspace",
			scopeRef: "ws-1",
			okfBundleId: "bundle-diskcheck",
			outDir: exportDir,
			governance: { scope: "workspace", scopeRef: "ws-1", trustTier: "admin" },
			returnContent: true,
		})
		for (const file of result.files) {
			expect(fs.existsSync(path.join(exportDir, file))).toBe(true)
		}
		expect(fs.existsSync(path.join(exportDir, "index.md"))).toBe(true)
	})

	it("skips concept files missing the required frontmatter.type", async () => {
		const srcDir = path.join(tmpDir, "src")
		writeBundle(srcDir, {
			"good.md": `---
type: concept
title: Good
---

Body.
`,
			"bad.md": `---
title: No Type
---

Body.
`,
		})
		const result = await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "b",
		})
		expect(result.imported).toBe(1)
		expect(result.conceptIds).toEqual(["good"])
		expect(store.docs.size).toBe(1)
	})

	it("refuses to overwrite a manually-authored page with a colliding slug", async () => {
		// Simulate a page created through the wiki UI (not via OKF import): it
		// has no okfConceptId. A bundle importing a concept with the same slug
		// must not silently clobber it.
		const key = store.key("tables/accounts", "workspace", "ws-1")
		store.docs.set(key, {
			_id: { toString: () => "manual-id" },
			slug: "tables/accounts",
			scope: "workspace",
			scopeRef: "ws-1",
			title: "Manually Authored Accounts Page",
			body: "Hand-written content.",
			frontmatter: { type: "concept" },
			claims: [],
			questions: [],
			relationships: [],
			revision: 1,
			// no okfConceptId — this page was never OKF-imported.
		})

		const srcDir = path.join(tmpDir, "src")
		writeBundle(srcDir, {
			"tables/accounts.md": `---
type: table
title: Bundle Accounts
---

Bundle content.
`,
		})
		const result = await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "bundle-x",
		})
		expect(result.imported).toBe(0)
		expect(result.skipped).toBe(1)
		expect(result.errors[0]?.error).toContain("refusing to overwrite")

		// The manually-authored page must be untouched.
		const unchanged = store.docs.get(key)!
		expect(unchanged.title).toBe("Manually Authored Accounts Page")
		expect(unchanged.body).toBe("Hand-written content.")
	})

	it("allows re-importing a bundle over a page it previously OKF-imported", async () => {
		const srcDir = path.join(tmpDir, "src")
		writeBundle(srcDir, {
			"concept.md": `---
type: concept
title: Version One
---

First version.
`,
		})
		await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "bundle-y",
		})
		writeBundle(srcDir, {
			"concept.md": `---
type: concept
title: Version Two
---

Second version.
`,
		})
		const result = await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "bundle-y",
		})
		expect(result.imported).toBe(1)
		expect(result.errors).toEqual([])
		const doc = store.docs.get(store.key("concept", "workspace", "ws-1"))!
		expect(doc.title).toBe("Version Two")
	})

	it("round-trips OKF v0.2 provenance/trust vocabulary (status/generated/verified/stale_after/sources)", async () => {
		const srcDir = path.join(tmpDir, "src")
		writeBundle(srcDir, {
			"metrics/income-statement.md": `---
type: Metric
title: Income statement
status: stable
generated: { by: reference_agent/gemini-2.5-pro, at: 2026-06-20T22:53:05Z }
verified: { by: human:ahormati, at: 2026-06-25T09:00:00Z }
stale_after: 2026-12-31
sources:
  - id: fpa-handbook
    resource: https://wiki.acme/finance/fpa-handbook
    title: FP&A reporting handbook
---

Body.
`,
		})
		await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "b",
		})
		const doc = store.docs.get(
			store.key("metrics/income-statement", "workspace", "ws-1"),
		)!
		expect(doc.frontmatter.status).toBe("stable")
		// js-yaml parses unquoted ISO timestamps as Date objects; coerceOkfActorEvent
		// normalizes them back to strings via toISOString(), which is millisecond-
		// precision — hence ".000Z" rather than the bundle's bare "Z" input.
		expect(doc.frontmatter.generated).toEqual({
			by: "reference_agent/gemini-2.5-pro",
			at: "2026-06-20T22:53:05.000Z",
		})
		// Spec §5.2: bare {by, at} mapping normalizes to a one-element list.
		expect(doc.frontmatter.verified).toEqual([
			{ by: "human:ahormati", at: "2026-06-25T09:00:00.000Z" },
		])
		expect(doc.frontmatter.stale_after).toBe("2026-12-31")
		expect(doc.frontmatter.sources).toEqual([
			{
				id: "fpa-handbook",
				resource: "https://wiki.acme/finance/fpa-handbook",
				title: "FP&A reporting handbook",
			},
		])

		const exportDir = path.join(tmpDir, "exported-provenance")
		await exportOkfBundle(handle, {
			scope: "workspace",
			scopeRef: "ws-1",
			outDir: exportDir,
			governance: { scope: "workspace", scopeRef: "ws-1", trustTier: "admin" },
		})
		const out = fs.readFileSync(
			path.join(exportDir, "metrics/income-statement.md"),
			"utf-8",
		)
		expect(out).toContain("status: stable")
		expect(out).toContain("by: reference_agent/gemini-2.5-pro")
		expect(out).toContain("by: human:ahormati")
		// yaml.dump quotes the date-like string so it round-trips as a string on
		// re-import rather than being auto-parsed as a YAML Date scalar again.
		expect(out).toContain("stale_after: '2026-12-31'")
		expect(out).toContain("resource: https://wiki.acme/finance/fpa-handbook")

		// Re-import the export and confirm the fields survive a second round-trip.
		const store2 = makeStore()
		const { db: db2 } = mockDb(store2)
		const handle2: WikiDbHandle = { db: db2, prefix: "test_" }
		await importOkfBundle(handle2, exportDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "b2",
		})
		const doc2 = store2.docs.get(
			store2.key("metrics/income-statement", "workspace", "ws-1"),
		)!
		expect(doc2.frontmatter.status).toBe("stable")
		expect(doc2.frontmatter.verified).toEqual([
			{ by: "human:ahormati", at: "2026-06-25T09:00:00.000Z" },
		])
	})

	it("preserves unknown OKF frontmatter extensions on import + export", async () => {
		const srcDir = path.join(tmpDir, "src")
		writeBundle(srcDir, {
			"concept.md": `---
type: concept
title: With Extension
customField: preserved-value
anotherExt: 42
---

Body.
`,
		})
		await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "b",
		})
		const doc = store.docs.get(store.key("concept", "workspace", "ws-1"))!
		expect(doc.frontmatter.customField).toBe("preserved-value")
		expect(doc.frontmatter.anotherExt).toBe(42)

		// Export and verify the extensions appear in the .md frontmatter.
		const exportDir = path.join(tmpDir, "exported")
		await exportOkfBundle(handle, {
			scope: "workspace",
			scopeRef: "ws-1",
			outDir: exportDir,
			governance: { scope: "workspace", scopeRef: "ws-1", trustTier: "admin" },
		})
		const out = fs.readFileSync(path.join(exportDir, "concept.md"), "utf-8")
		expect(out).toContain("customField: preserved-value")
		expect(out).toContain("anotherExt: 42")
	})

	it("projects personCard to a ## Person Card section on export", async () => {
		store.docs.set(store.key("person/acme", "workspace", "ws-1"), {
			_id: { toString: () => "id1" },
			kind: "entity",
			title: "Jane Doe",
			slug: "person/acme",
			aliases: [],
			summary: "A person.",
			body: "",
			frontmatter: { type: "person" },
			claims: [],
			contradictions: [],
			questions: [],
			relationships: [],
			personCard: {
				canonicalId: "jane",
				handles: ["@jane"],
				timezone: "IST",
				bestUsedFor: "intro",
			},
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			permissions: {},
			state: "active",
			revision: 1,
			validFrom: new Date(),
			freshness: "fresh",
			backlinks: [],
			embedding: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		const exportDir = path.join(tmpDir, "exported")
		await exportOkfBundle(handle, {
			scope: "workspace",
			scopeRef: "ws-1",
			outDir: exportDir,
			governance: { scope: "workspace", scopeRef: "ws-1", trustTier: "admin" },
		})
		const out = fs.readFileSync(path.join(exportDir, "person/acme.md"), "utf-8")
		expect(out).toContain("## Person Card")
		expect(out).toContain("Canonical ID:** jane")
		expect(out).toContain("Handles:** @jane")
		expect(out).toContain("Timezone:** IST")
	})

	it("filters export through governance — never exports a page the requester couldn't otherwise read", async () => {
		const baseDoc = {
			kind: "concept" as const,
			aliases: [],
			body: "",
			claims: [],
			contradictions: [],
			questions: [],
			relationships: [],
			personCard: null,
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			state: "active",
			revision: 1,
			validFrom: new Date(),
			freshness: "fresh",
			backlinks: [],
			embedding: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		}
		store.docs.set(store.key("open-page", "workspace", "ws-1"), {
			...baseDoc,
			_id: { toString: () => "id-open" },
			title: "Open Page",
			slug: "open-page",
			summary: "Visible to everyone.",
			frontmatter: { type: "concept" },
			permissions: {},
		})
		store.docs.set(store.key("restricted-page", "workspace", "ws-1"), {
			...baseDoc,
			_id: { toString: () => "id-restricted" },
			title: "Restricted Page",
			slug: "restricted-page",
			summary: "Only admins/finance should see this.",
			frontmatter: { type: "concept" },
			permissions: { privacyTier: "confidential", allowedRoles: ["finance"] },
		})

		const exportDir = path.join(tmpDir, "exported-governed")
		const result = await exportOkfBundle(handle, {
			scope: "workspace",
			scopeRef: "ws-1",
			outDir: exportDir,
			// Standard trust tier, no roles — should see the open page only.
			governance: {
				scope: "workspace",
				scopeRef: "ws-1",
				trustTier: "standard",
			},
		})
		expect(result.exported).toBe(1)
		expect(fs.existsSync(path.join(exportDir, "open-page.md"))).toBe(true)
		expect(fs.existsSync(path.join(exportDir, "restricted-page.md"))).toBe(
			false,
		)

		// A caller with the matching role sees it.
		const exportDir2 = path.join(tmpDir, "exported-governed-finance")
		const result2 = await exportOkfBundle(handle, {
			scope: "workspace",
			scopeRef: "ws-1",
			outDir: exportDir2,
			governance: {
				scope: "workspace",
				scopeRef: "ws-1",
				trustTier: "standard",
				roles: ["finance"],
			},
		})
		expect(result2.exported).toBe(2)
		expect(fs.existsSync(path.join(exportDir2, "restricted-page.md"))).toBe(
			true,
		)
	})

	it("derives index.md sibling relationships from single-link lines", async () => {
		const srcDir = path.join(tmpDir, "src")
		writeBundle(srcDir, {
			"a.md": `---\ntype: concept\ntitle: A\n---\n\nBody.\n`,
			"b.md": `---\ntype: concept\ntitle: B\n---\n\nBody.\n`,
			"index.md": `---\ntype: index\n---\n\n# Concepts\n\n- [A](a.md)\n- [B](b.md)\n`,
		})
		await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "b",
		})
		const a = store.docs.get(store.key("a", "workspace", "ws-1"))!
		const aRels = a.relationships as Array<{ targetPageSlug: string }>
		expect(aRels.some((r) => r.targetPageSlug === "b")).toBe(true)
	})

	it("export is a strict-subset projection (no embedding/backlinks/trustTier in output)", async () => {
		// Insert a page with embedding/backlinks/trustTier directly.
		store.docs.set(store.key("x", "workspace", "ws-1"), {
			_id: { toString: () => "id1" },
			kind: "concept",
			title: "X",
			slug: "x",
			aliases: [],
			summary: "Sum",
			body: "Body",
			frontmatter: { type: "concept", tags: ["t"] },
			claims: [],
			contradictions: [],
			questions: [],
			relationships: [],
			personCard: null,
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "admin",
			permissions: { allowedRoles: ["r"] },
			state: "active",
			revision: 1,
			validFrom: new Date(),
			freshness: "fresh",
			backlinks: [{ sourcePageSlug: "y", sourceTitle: "Y" }],
			embedding: [0.1, 0.2, 0.3],
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		const exportDir = path.join(tmpDir, "exported")
		await exportOkfBundle(handle, {
			scope: "workspace",
			scopeRef: "ws-1",
			outDir: exportDir,
			governance: { scope: "workspace", scopeRef: "ws-1", trustTier: "admin" },
		})
		const out = fs.readFileSync(path.join(exportDir, "x.md"), "utf-8")
		// OKF-expressible fields present
		expect(out).toContain("type: concept")
		expect(out).toContain("Sum")
		expect(out).toContain("Body")
		// Strict-subset: unexpressible fields absent
		expect(out).not.toContain("embedding")
		expect(out).not.toContain("backlinks")
		expect(out).not.toContain("trustTier")
		expect(out).not.toContain("allowedRoles")
	})

	it("resolves reference-style markdown links ([text][ref] + [ref]: target) into relationships", async () => {
		const srcDir = path.join(tmpDir, "src")
		writeBundle(srcDir, {
			"concept.md": `---
type: concept
title: With Ref Links
---

See [the users table][users-ref] for details.

Also [tables/accounts][].

[users-ref]: tables/users.md "Users Table"
[tables/accounts]: /tables/accounts.md
`,
			"tables/users.md": `---
type: table
title: Users Table
---

Body.
`,
			"tables/accounts.md": `---
type: table
title: Accounts Table
---

Body.
`,
		})
		const result = await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "b",
		})
		expect(result.errors).toEqual([])
		const doc = store.docs.get(store.key("concept", "workspace", "ws-1"))!
		const rels = doc.relationships as Array<{
			targetPageSlug: string
			targetTitle: string
		}>
		expect(rels).toContainEqual(
			expect.objectContaining({
				targetPageSlug: "tables/users",
				targetTitle: "the users table",
			}),
		)
		expect(rels).toContainEqual(
			expect.objectContaining({
				targetPageSlug: "tables/accounts",
				targetTitle: "tables/accounts",
			}),
		)
		// Reference-link definition lines must not leak into the stored body.
		expect(doc.body).not.toContain("[users-ref]:")
		expect(doc.body).not.toContain("[tables/accounts]:")
	})

	it("ignores a reference-style link inside a fenced code block", async () => {
		const srcDir = path.join(tmpDir, "src")
		writeBundle(srcDir, {
			"concept.md": `---
type: concept
title: With Fenced Ref Link
---

\`\`\`
See [example][ex-ref] for syntax.
[ex-ref]: should/not/be-a-relationship.md
\`\`\`

No real links here.
`,
		})
		const result = await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "b",
		})
		expect(result.errors).toEqual([])
		const doc = store.docs.get(store.key("concept", "workspace", "ws-1"))!
		const rels = doc.relationships as Array<{ targetPageSlug: string }>
		expect(
			rels.some((r) => r.targetPageSlug === "should/not/be-a-relationship"),
		).toBe(false)
	})

	it("rejects a bundle exceeding the maximum bundle file count", async () => {
		const srcDir = path.join(tmpDir, "src")
		const { readBundleConcepts } = await import("./okf.js")
		fs.mkdirSync(srcDir, { recursive: true })
		// Use a lowered internal override so the test doesn't need to create
		// 10,000+ real files on disk.
		for (let i = 0; i < 5; i++) {
			fs.writeFileSync(
				path.join(srcDir, `c${i}.md`),
				`---\ntype: concept\ntitle: C${i}\n---\n\nBody.\n`,
			)
		}
		await expect(readBundleConcepts(srcDir, { maxFiles: 3 })).rejects.toThrow(
			/maximum file count/,
		)
	})

	it("rejects a bundle exceeding the maximum cumulative byte cap", async () => {
		const srcDir = path.join(tmpDir, "src")
		const { readBundleConcepts } = await import("./okf.js")
		fs.mkdirSync(srcDir, { recursive: true })
		const body = "x".repeat(200)
		for (let i = 0; i < 5; i++) {
			fs.writeFileSync(
				path.join(srcDir, `c${i}.md`),
				`---\ntype: concept\ntitle: C${i}\n---\n\n${body}\n`,
			)
		}
		await expect(
			readBundleConcepts(srcDir, { maxTotalBytes: 300 }),
		).rejects.toThrow(/maximum total size/)
	})

	it("still imports a normal bundle correctly with the async walk (regression check)", async () => {
		const srcDir = path.join(tmpDir, "src")
		writeBundle(srcDir, {
			"a.md": `---\ntype: concept\ntitle: A\n---\n\nBody A.\n`,
			"nested/b.md": `---\ntype: concept\ntitle: B\n---\n\nBody B.\n`,
		})
		const result = await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "b",
		})
		expect(result.imported).toBe(2)
		expect(result.errors).toEqual([])
		expect(result.conceptIds.sort()).toEqual(["a", "nested/b"])
	})

	it("rejects a concept with a $-prefixed or dotted frontmatter extension key (MongoDB field-name injection)", async () => {
		const srcDir = path.join(tmpDir, "src")
		writeBundle(srcDir, {
			"good.md": `---
type: concept
title: Good
---

Body.
`,
			"bad.md": `---
type: concept
title: Bad
$where: "malicious"
"a.b": "x"
---

Body.
`,
		})
		const result = await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "b",
		})
		expect(result.imported).toBe(1)
		expect(result.conceptIds).toEqual(["good"])
		// The rejection must be visible in the import result, not silent.
		const badError = result.errors.find((e) => e.conceptId === "bad")
		expect(badError).toBeDefined()
		expect(badError!.error).toMatch(/\$where/)
		expect(badError!.error).toMatch(/a\.b/)
		// The bad concept must never have been written to the store at all.
		expect(store.docs.has(store.key("bad", "workspace", "ws-1"))).toBe(false)
	})

	it("degrades a malformed non-array tags value to undefined instead of corrupting the stored shape", async () => {
		const srcDir = path.join(tmpDir, "src")
		writeBundle(srcDir, {
			"concept.md": `---
type: concept
title: Bad Tags
tags: "oops"
---

Body.
`,
		})
		const result = await importOkfBundle(handle, srcDir, {
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			okfBundleId: "b",
		})
		expect(result.errors).toEqual([])
		const doc = store.docs.get(store.key("concept", "workspace", "ws-1"))!
		expect(doc.frontmatter.tags).toBeUndefined()
	})

	describe("transactional import (fix 5)", () => {
		it("reports pre-mutation validation errors and imports valid concepts", async () => {
			const transactionalStore = makeStore()
			const { db } = mockDb(transactionalStore)
			const withTransaction = vi.fn(async (operation: () => Promise<void>) =>
				operation(),
			)
			const endSession = vi.fn(async () => {})
			const session = { withTransaction, endSession }
			const client = {
				startSession: vi.fn(() => session),
			} as unknown as WikiDbHandle["client"]
			const transactionalHandle: WikiDbHandle = {
				db,
				prefix: "test_",
				client,
			}
			const srcDir = path.join(tmpDir, "transactional-validation")
			writeBundle(srcDir, {
				"bad.md": `---
type: concept
title: Bad
$where: "invalid extension"
---

Invalid concept.
`,
				"good.md": `---
type: concept
title: Good
---

Valid concept.
`,
			})

			const result = await importOkfBundle(transactionalHandle, srcDir, {
				scope: "workspace",
				scopeRef: "ws-1",
				trustTier: "standard",
				okfBundleId: "bundle-1",
			})

			expect(result.imported).toBe(1)
			expect(result.skipped).toBe(1)
			expect(result.errors).toEqual([
				expect.objectContaining({
					conceptId: "bad",
					error: expect.stringContaining("$where"),
				}),
			])
			await expect(
				getWikiPage(transactionalHandle, "bad", "workspace", "ws-1"),
			).resolves.toBeUndefined()
			await expect(
				getWikiPage(transactionalHandle, "good", "workspace", "ws-1"),
			).resolves.toEqual(expect.objectContaining({ slug: "good" }))
			expect(withTransaction).toHaveBeenCalledTimes(1)
			expect(endSession).toHaveBeenCalledTimes(1)
		})

		it("rolls back the complete bundle when a later strict revision recording fails", async () => {
			const transactionalStore = makeStore()
			const { db, revisionsInsertOne } = mockDb(transactionalStore)
			revisionsInsertOne
				.mockResolvedValueOnce({
					acknowledged: true,
					insertedId: { toString: () => "first-revision" },
				})
				.mockRejectedValueOnce(new Error("injected revision recording failure"))
			const withTransaction = vi.fn(async (operation: () => Promise<void>) => {
				const snapshot = new Map(transactionalStore.docs)
				try {
					await operation()
				} catch (error) {
					transactionalStore.docs.clear()
					for (const [key, value] of snapshot) {
						transactionalStore.docs.set(key, value)
					}
					throw error
				}
			})
			const endSession = vi.fn(async () => {})
			const session = { withTransaction, endSession }
			const client = {
				startSession: vi.fn(() => session),
			} as unknown as WikiDbHandle["client"]
			const transactionalHandle: WikiDbHandle = {
				db,
				prefix: "test_",
				client,
			}
			const srcDir = path.join(tmpDir, "strict-revision-failure")
			writeBundle(srcDir, {
				"01-accounts.md": `---
type: concept
title: Accounts
---

Account records.
`,
				"02-users.md": `---
type: concept
title: Users
---

User records.
`,
			})

			await expect(
				importOkfBundle(transactionalHandle, srcDir, {
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: "standard",
					okfBundleId: "bundle-1",
				}),
			).rejects.toThrow("injected revision recording failure")
			await expect(
				getWikiPage(transactionalHandle, "01-accounts", "workspace", "ws-1"),
			).resolves.toBeUndefined()
			await expect(
				getWikiPage(transactionalHandle, "02-users", "workspace", "ws-1"),
			).resolves.toBeUndefined()
			expect(revisionsInsertOne).toHaveBeenCalledTimes(2)
			expect(withTransaction).toHaveBeenCalledTimes(1)
			expect(endSession).toHaveBeenCalledTimes(1)
		})

		it("detects the MongoDB standalone-server transaction-unsupported error", async () => {
			const { isTransactionNotSupported } = await import("./okf.js")
			const codeErr = Object.assign(new Error("some msg"), { code: 20 })
			expect(isTransactionNotSupported(codeErr)).toBe(true)
			const msgErr = new Error(
				"Transaction numbers are only allowed on a replica set member or mongos",
			)
			expect(isTransactionNotSupported(msgErr)).toBe(true)
			expect(isTransactionNotSupported(new Error("unrelated"))).toBe(false)
		})

		it("fails closed when the deployment does not support transactions", async () => {
			const withTransaction = vi.fn(async (fn: () => Promise<void>) => {
				const err = Object.assign(
					new Error(
						"Transaction numbers are only allowed on a replica set member or mongos",
					),
					{ code: 20 },
				)
				throw err
			})
			const endSession = vi.fn(async () => {})
			const session = { withTransaction, endSession }
			const client = {
				startSession: vi.fn(() => session),
			} as unknown as WikiDbHandle["client"]
			const handleWithClient: WikiDbHandle = { ...handle, client }

			const srcDir = path.join(tmpDir, "src")
			writeBundle(srcDir, {
				"a.md": `---\ntype: concept\ntitle: A\n---\n\nBody.\n`,
				"b.md": `---\ntype: concept\ntitle: B\n---\n\nBody.\n`,
			})
			await expect(
				importOkfBundle(handleWithClient, srcDir, {
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: "standard",
					okfBundleId: "b",
				}),
			).rejects.toThrow(/replica set member/)
			expect(client.startSession).toHaveBeenCalledTimes(1)
			expect(withTransaction).toHaveBeenCalledTimes(1)
			expect(endSession).toHaveBeenCalledTimes(1)
			expect(store.docs.size).toBe(0)
		})
	})

	describe("path safety defaults", () => {
		const previousAllowedRoots = process.env.MDBRAIN_OKF_ALLOWED_ROOTS
		const previousUnrestricted = process.env.MDBRAIN_OKF_ALLOW_UNRESTRICTED

		afterEach(() => {
			if (previousAllowedRoots === undefined) {
				delete process.env.MDBRAIN_OKF_ALLOWED_ROOTS
			} else {
				process.env.MDBRAIN_OKF_ALLOWED_ROOTS = previousAllowedRoots
			}
			if (previousUnrestricted === undefined) {
				delete process.env.MDBRAIN_OKF_ALLOW_UNRESTRICTED
			} else {
				process.env.MDBRAIN_OKF_ALLOW_UNRESTRICTED = previousUnrestricted
			}
		})

		it("refuses an unrestricted path with MDBRAIN_OKF_ALLOWED_ROOTS unset (fails closed by default)", async () => {
			delete process.env.MDBRAIN_OKF_ALLOWED_ROOTS
			delete process.env.MDBRAIN_OKF_ALLOW_UNRESTRICTED
			writeBundle(tmpDir, {
				"a.md": "---\ntype: concept\ntitle: A\n---\n\nBody.\n",
			})
			await expect(
				importOkfBundle(handle, tmpDir, {
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: "standard",
					okfBundleId: "b",
				}),
			).rejects.toThrow(/MDBRAIN_OKF_ALLOWED_ROOTS/)
		})

		it("allows an unrestricted path only with explicit MDBRAIN_OKF_ALLOW_UNRESTRICTED=true opt-in", async () => {
			delete process.env.MDBRAIN_OKF_ALLOWED_ROOTS
			process.env.MDBRAIN_OKF_ALLOW_UNRESTRICTED = "true"
			writeBundle(tmpDir, {
				"a.md": "---\ntype: concept\ntitle: A\n---\n\nBody.\n",
			})
			const result = await importOkfBundle(handle, tmpDir, {
				scope: "workspace",
				scopeRef: "ws-1",
				trustTier: "standard",
				okfBundleId: "b",
			})
			expect(result.imported).toBe(1)
		})

		it("rejects a path outside a configured MDBRAIN_OKF_ALLOWED_ROOTS", async () => {
			const otherDir = fs.mkdtempSync(
				path.join(os.tmpdir(), "mdbrain-okf-other-"),
			)
			try {
				process.env.MDBRAIN_OKF_ALLOWED_ROOTS = otherDir
				writeBundle(tmpDir, {
					"a.md": "---\ntype: concept\ntitle: A\n---\n\nBody.\n",
				})
				await expect(
					importOkfBundle(handle, tmpDir, {
						scope: "workspace",
						scopeRef: "ws-1",
						trustTier: "standard",
						okfBundleId: "b",
					}),
				).rejects.toThrow(/must resolve inside/)
			} finally {
				fs.rmSync(otherDir, { recursive: true, force: true })
			}
		})
	})
})
