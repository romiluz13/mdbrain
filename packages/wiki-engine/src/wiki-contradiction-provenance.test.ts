// A contradiction record names the page that owns each claim. Claim ids are
// unique only within a page, so a record of bare ids cannot say which page a
// claim is on; readers would have to guess.

import type { Db, Document } from "mongodb"
import { describe, expect, it, vi } from "vitest"
import { createFakeWikiDb } from "./testing/fake-wiki-db.js"
import { claim, page } from "./testing/overview-fixtures.js"
import {
	detectContradictions,
	runWritePipelineGate,
} from "./wiki-contradictions.js"
import { ensureWikiSchemaValidation } from "./wiki-schema.js"

const WORKSPACE = { scope: "workspace", scopeRef: "ws-1" }

// billing links to hub; hub holds the claim billing's new claim contradicts.
function billingAndHub() {
	return [
		page("billing", {
			relationships: [
				{ targetPageSlug: "hub", targetTitle: "Hub", kind: "mentions" },
			],
		}),
		page("hub", {
			claims: [claim("status", "The renewal term is annual for every plan")],
		}),
	]
}

const NEW_CLAIM = {
	id: "status",
	text: "The renewal term is not annual for every plan",
}

describe("contradiction provenance on write", () => {
	it("names the owning page of each claim beside the bare ids", async () => {
		const fake = createFakeWikiDb({ wiki_pages: billingAndHub() })

		const found = await detectContradictions(
			fake,
			"billing",
			NEW_CLAIM,
			WORKSPACE.scope,
			WORKSPACE.scopeRef,
		)

		expect(found).toHaveLength(1)
		expect(found[0]?.pageSlug).toBe("hub")
		expect(found[0]?.contradiction.claimIds).toEqual(["status", "status"])
		expect(found[0]?.contradiction.claimRefs).toEqual([
			{ pageSlug: "billing", claimId: "status" },
			{ pageSlug: "hub", claimId: "status" },
		])
	})

	it("stores the page-qualified record on the page the other claim lives on", async () => {
		const pages = billingAndHub()
		const fake = createFakeWikiDb({ wiki_pages: pages })

		await runWritePipelineGate(
			fake,
			"billing",
			NEW_CLAIM,
			[],
			WORKSPACE.scope,
			WORKSPACE.scopeRef,
		)

		const stored = (await fake.db
			.collection("t_wiki_pages")
			.findOne({ slug: "hub" })) as Document
		expect(stored.contradictions).toHaveLength(1)
		expect(stored.contradictions[0].claimRefs).toEqual([
			{ pageSlug: "billing", claimId: "status" },
			{ pageSlug: "hub", claimId: "status" },
		])
	})
})

describe("contradiction provenance in the page validator", () => {
	async function appliedValidator(): Promise<Document> {
		const command = vi.fn(async (_: Document) => ({ ok: 1 }))
		await ensureWikiSchemaValidation({ command } as unknown as Db, "t_")
		const call = command.mock.calls
			.map(([cmd]) => cmd)
			.find((cmd) => cmd.collMod === "t_wiki_pages")
		if (!call) throw new Error("collMod for wiki_pages was not issued")
		return call
	}

	it("accepts claimRefs as an optional page-qualified pair list", async () => {
		const command = await appliedValidator()

		const item = command.validator.$jsonSchema.properties.contradictions.items
		expect(item.properties.claimRefs).toMatchObject({
			bsonType: "array",
			minItems: 2,
			items: {
				bsonType: "object",
				required: ["pageSlug", "claimId"],
				properties: {
					pageSlug: { bsonType: "string" },
					claimId: { bsonType: "string" },
				},
			},
		})
		expect(item.required).not.toContain("claimRefs")
	})

	it("is applied to existing collections as metadata, without revalidating stored documents", async () => {
		const command = await appliedValidator()

		expect(command.validationLevel).toBe("moderate")
		expect(command.validationAction).toBe("error")
	})
})
