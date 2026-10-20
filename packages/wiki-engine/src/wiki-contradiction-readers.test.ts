// The readers of a page's stored contradictions (the page read and list, the
// markdown renderer, the OKF export and wiki lint) show a record only when the
// caller may read every page it names and its claims have one owner each. The
// overview's rules (wiki-overview-ownership.test.ts) apply to all of them.
//
// The collections are an in-memory fake that evaluates the real governance
// filters (src/testing/fake-wiki-db.ts), not MongoDB.

import type { Document } from "mongodb"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { exportOkfBundle } from "./okf.js"
import { createFakeWikiDb } from "./testing/fake-wiki-db.js"
import {
	HIDDEN,
	SCOPE,
	admin,
	claim,
	contradiction,
	exec,
	linked,
	outsider,
	refs,
} from "./testing/overview-fixtures.js"
import { getWikiPage, listWikiPages } from "./wiki-bridge.js"
import { listUnresolvedContradictions } from "./wiki-contradictions.js"
import { renderWikiPageMarkdown } from "./wiki-renderer.js"

// A hidden page reuses the hub's claim id: the record cannot say which is which.
function reusedId(): Document[] {
	return linked(
		"hub",
		[
			{
				slug: "secret-src",
				extra: {
					permissions: HIDDEN,
					claims: [claim("status", "Layoffs are planned for Q4.")],
				},
			},
		],
		{
			claims: [claim("status", "Headcount is stable.")],
			contradictions: [
				contradiction("contra-status-status", ["status", "status"]),
			],
		},
	)
}

// The record names the hidden page that holds its other claim.
function hiddenCounterpart(): Document[] {
	return linked(
		"hub",
		[
			{
				slug: "secret-src",
				extra: {
					permissions: HIDDEN,
					claims: [claim("s1", "Layoffs are planned for Q4.")],
				},
			},
		],
		{
			claims: [claim("m1", "Headcount is stable.")],
			contradictions: [
				contradiction("contra-s1-m1", ["s1", "m1"], {
					claimRefs: refs(["secret-src", "s1"], ["hub", "m1"]),
				}),
			],
		},
	)
}

// Each id has one owner, and the caller may read both pages.
function unambiguous(): Document[] {
	return linked(
		"hub",
		[{ slug: "billing", extra: { claims: [claim("c-their", "Monthly.")] } }],
		{
			claims: [claim("c-mine", "Annual.")],
			contradictions: [contradiction("contra-1", ["c-their", "c-mine"])],
		},
	)
}

const read = (pages: Document[], caller = outsider) =>
	getWikiPage(
		createFakeWikiDb({ wiki_pages: pages }),
		"hub",
		SCOPE.scope,
		SCOPE.scopeRef,
		caller,
	)

const recordIds = (view: { contradictions: unknown[] } | undefined) =>
	view?.contradictions.map((c) => (c as { id: string }).id)

describe("page read", () => {
	it("does not show a hidden page's conflict that reuses a claim id", async () => {
		for (const caller of [outsider, exec, admin]) {
			expect(recordIds(await read(reusedId(), caller))).toEqual([])
		}
	})

	it("shows a record that names a hidden page only to a reader of that page", async () => {
		expect(recordIds(await read(hiddenCounterpart(), outsider))).toEqual([])
		expect(recordIds(await read(hiddenCounterpart(), exec))).toEqual([
			"contra-s1-m1",
		])
	})

	it("keeps a record whose claims each have one owner the caller may read", async () => {
		expect(recordIds(await read(unambiguous()))).toEqual(["contra-1"])
	})

	it("never carries the page references, which name pages the reader may not see", async () => {
		const view = await read(hiddenCounterpart(), exec)

		expect(JSON.stringify(view?.contradictions)).not.toContain("claimRefs")
	})

	it("leaves an ungoverned read as stored, minus the page references", async () => {
		const view = await getWikiPage(
			createFakeWikiDb({ wiki_pages: hiddenCounterpart() }),
			"hub",
			SCOPE.scope,
			SCOPE.scopeRef,
		)

		expect(recordIds(view)).toEqual(["contra-s1-m1"])
		expect(JSON.stringify(view?.contradictions)).not.toContain("claimRefs")
	})

	it("governs the records of every page a list returns", async () => {
		const hubOf = async (pages: Document[], caller: typeof outsider) =>
			(
				await listWikiPages(createFakeWikiDb({ wiki_pages: pages }), {
					...SCOPE,
					governance: caller,
				})
			).pages.find((p) => p.slug === "hub")

		expect(recordIds(await hubOf(reusedId(), exec))).toEqual([])
		expect(recordIds(await hubOf(hiddenCounterpart(), outsider))).toEqual([])
		const allowed = await hubOf(hiddenCounterpart(), exec)
		expect(recordIds(allowed)).toEqual(["contra-s1-m1"])
		expect(JSON.stringify(allowed?.contradictions)).not.toContain("claimRefs")
	})
})

describe("a listing that includes superseded pages", () => {
	it("does not take a superseded page for a readable one when a record names it", async () => {
		const pages = linked(
			"hub",
			[
				{
					slug: "old-src",
					extra: { state: "superseded", claims: [claim("s1", "Old.")] },
				},
			],
			{
				claims: [claim("m1", "Mine.")],
				contradictions: [
					contradiction("contra-s1-m1", ["s1", "m1"], {
						claimRefs: refs(["old-src", "s1"], ["hub", "m1"]),
					}),
				],
			},
		)

		const listed = await listWikiPages(
			createFakeWikiDb({ wiki_pages: pages }),
			{
				...SCOPE,
				state: "all",
				governance: admin,
			},
		)

		expect(listed.pages.find((p) => p.slug === "hub")?.contradictions).toEqual(
			[],
		)
	})
})

describe("markdown render", () => {
	it("leaves a hidden page's conflict out of the rendered page", async () => {
		const outside = await read(reusedId(), outsider)
		const hidden = await read(hiddenCounterpart(), outsider)
		const allowed = await read(hiddenCounterpart(), exec)

		expect(renderWikiPageMarkdown(outside as never)).not.toContain(
			"Contradictions",
		)
		expect(renderWikiPageMarkdown(hidden as never)).not.toContain("s1")
		expect(renderWikiPageMarkdown(allowed as never)).toContain(
			"[unresolved] s1 ↔ m1",
		)
	})
})

describe("OKF export", () => {
	let dir: string
	const previousRoots = process.env.MDBRAIN_OKF_ALLOWED_ROOTS

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdbrain-okf-"))
		process.env.MDBRAIN_OKF_ALLOWED_ROOTS = os.tmpdir()
	})

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true })
		if (previousRoots === undefined)
			delete process.env.MDBRAIN_OKF_ALLOWED_ROOTS
		else process.env.MDBRAIN_OKF_ALLOWED_ROOTS = previousRoots
	})

	const exported = async (pages: Document[], caller = outsider) =>
		(
			await exportOkfBundle(createFakeWikiDb({ wiki_pages: pages }), {
				...SCOPE,
				outDir: path.join(dir, "bundle"),
				governance: caller,
				returnContent: true,
			})
		).fileContents?.["hub.md"] ?? ""

	it("leaves a hidden page's conflict out of the exported page", async () => {
		expect(await exported(reusedId(), exec)).not.toContain("Contradictions")
		expect(await exported(hiddenCounterpart(), outsider)).not.toContain("s1")
	})

	it("exports a record from the pages it names when other pages reuse its claim id", async () => {
		const pages = linked(
			"hub",
			[
				{ slug: "open-src", extra: { claims: [claim("status", "Open.")] } },
				{ slug: "other-src", extra: { claims: [claim("status", "Other.")] } },
			],
			{
				claims: [claim("status", "Hub.")],
				contradictions: [
					contradiction("contra-status-status", ["status", "status"], {
						claimRefs: refs(["open-src", "status"], ["hub", "status"]),
					}),
				],
			},
		)

		expect(await exported(pages, outsider)).toContain(
			"[unresolved] status ↔ status",
		)
	})

	it("exports a record to a reader who may see every page it names", async () => {
		expect(await exported(hiddenCounterpart(), exec)).toContain(
			"[unresolved] s1 ↔ m1",
		)
		expect(await exported(unambiguous(), outsider)).toContain(
			"[unresolved] c-their ↔ c-mine",
		)
	})
})

describe("wiki lint", () => {
	const lint = async (pages: Document[], caller?: typeof outsider) =>
		(
			await listUnresolvedContradictions(
				createFakeWikiDb({ wiki_pages: pages }),
				SCOPE.scope,
				SCOPE.scopeRef,
				caller,
			)
		).map((entry) => entry.contradiction.id)

	it("does not list a hidden page's conflict that reuses a claim id", async () => {
		for (const caller of [outsider, exec, admin]) {
			expect(await lint(reusedId(), caller)).toEqual([])
		}
	})

	it("lists a record that names a hidden page only to a reader of that page", async () => {
		expect(await lint(hiddenCounterpart(), outsider)).toEqual([])
		expect(await lint(hiddenCounterpart(), exec)).toEqual(["contra-s1-m1"])
	})

	it("does not give an id to a readable page when a hidden page holds it too", async () => {
		const pages = linked(
			"hub",
			[
				{
					slug: "secret-src",
					extra: { permissions: HIDDEN, claims: [claim("x", "Hidden x.")] },
				},
				{ slug: "open-src", extra: { claims: [claim("x", "Readable x.")] } },
			],
			{
				claims: [claim("m1", "Mine.")],
				contradictions: [contradiction("contra-x", ["x", "m1"])],
			},
		)

		expect(await lint(pages, outsider)).toEqual([])
	})

	it("lists a record whose claims each have one owner the caller may read", async () => {
		expect(await lint(unambiguous(), outsider)).toEqual(["contra-1"])
	})

	it("lists every record when no caller is given, as an internal check", async () => {
		expect(await lint(reusedId())).toEqual(["contra-status-status"])
	})
})
