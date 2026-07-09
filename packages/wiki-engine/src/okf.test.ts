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
import { importOkfBundle, exportOkfBundle } from "./okf.js"
import type { WikiDbHandle } from "./wiki-bridge.js"

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
			if (!existing) return { value: null }
			const updated = {
				...existing,
				...update.$set,
				revision: (existing.revision ?? 1) + (update.$inc?.revision ?? 0),
			}
			store.docs.set(k, updated)
			return { value: updated }
		}),
		updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
		deleteOne: vi.fn(async () => ({ deletedCount: 1 })),
		aggregate: vi.fn(() => ({ toArray: async () => [] })),
	} as unknown as Collection
	const db = { collection: vi.fn(() => coll) } as unknown as Db
	return { db, coll }
}

describe("OKF import + export round-trip", () => {
	let tmpDir: string
	let store: ReturnType<typeof makeStore>
	let handle: WikiDbHandle

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdbrian-okf-"))
		store = makeStore()
		const { db } = mockDb(store)
		handle = { db, prefix: "test_" }
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	function writeBundle(dir: string, files: Record<string, string>) {
		for (const [rel, content] of Object.entries(files)) {
			const full = path.join(dir, rel)
			fs.mkdirSync(path.dirname(full), { recursive: true })
			fs.writeFileSync(full, content, "utf-8")
		}
	}

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
		})
		const out = fs.readFileSync(path.join(exportDir, "person/acme.md"), "utf-8")
		expect(out).toContain("## Person Card")
		expect(out).toContain("Canonical ID:** jane")
		expect(out).toContain("Handles:** @jane")
		expect(out).toContain("Timezone:** IST")
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
})
