import { createHash } from "node:crypto"

/** Deterministic digest of everything a run slot seeds: the rendered event
 * bodies, in source order, then the world's page and contradiction specs.
 * Recorded in every run manifest, so two slots seeded from the same corpus
 * carry the same boundary, and any corpus change invalidates comparisons. */
export function corpusDigest(input: {
	sources: ReadonlyArray<{ id: string }>
	records: ReadonlyMap<string, { body: string }>
	pages: unknown
	contradiction: unknown
}): string {
	const hash = createHash("sha256")
	for (const source of input.sources) {
		const record = input.records.get(source.id)
		hash.update(`${source.id}\t${record?.body ?? "<missing>"}\n`)
	}
	hash.update(JSON.stringify(input.pages))
	hash.update(JSON.stringify(input.contradiction))
	return hash.digest("hex")
}
