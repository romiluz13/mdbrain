// Checks the committed corpus: world.json must match the generator, and
// every rendered record must carry its facts. Usage: bun run corpus:check
import { readRecords, readWorld } from "./corpus-files.js"
import { CORPUS_SEED } from "./render-config.js"
import { validateRendered, validateWorld } from "./validate.js"
import { buildWorld } from "./world.js"

const committed = readWorld()
const errors = [
	...(JSON.stringify(committed) === JSON.stringify(buildWorld(CORPUS_SEED))
		? []
		: [
				"world.json differs from buildWorld(CORPUS_SEED); regenerate deliberately",
			]),
	...validateWorld(committed),
	...validateRendered(committed, readRecords()),
]
for (const e of errors) console.error(e)
console.log(
	`${committed.sources.length} sources, ${readRecords().size} rendered, ${committed.pages.length} pages, ${errors.length} errors`,
)
process.exit(errors.length ? 1 : 0)
