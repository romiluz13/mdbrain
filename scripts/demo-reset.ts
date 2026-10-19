// Human-only: drops the three demo databases on the demo cluster. Agents,
// demo chapters and automation never run this (plan decision 11).
//
// Usage:
//   bun scripts/demo-reset.ts --secrets <file> --i-am-a-human-dropping-mdbrain-demo-databases

import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { MongoClient } from "mongodb"
import { DEMO_DATABASES, parseSecretsFile } from "./demo-stack-config.js"

export const CONFIRM_FLAG = "--i-am-a-human-dropping-mdbrain-demo-databases"

type ResetClient = {
	db(name: string): { dropDatabase(): Promise<unknown> }
	close(): Promise<void>
}

export async function runDemoReset(
	argv: string[],
	deps: {
		connect: () => Promise<ResetClient>
		log: (message: string) => void
	},
): Promise<number> {
	if (!argv.includes(CONFIRM_FLAG)) {
		deps.log(
			`demo-reset: refusing. This drops ${DEMO_DATABASES.join(", ")}. Re-run with ${CONFIRM_FLAG} if you are the human operator.`,
		)
		return 2
	}
	const client = await deps.connect()
	try {
		for (const name of DEMO_DATABASES) {
			await client.db(name).dropDatabase()
			deps.log(`demo-reset: dropped ${name}`)
		}
	} finally {
		await client.close()
	}
	return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const argv = process.argv.slice(2)
	const secretsPath = argv[argv.indexOf("--secrets") + 1]
	const code = await runDemoReset(argv, {
		connect: async () => {
			if (!argv.includes("--secrets") || !secretsPath) {
				throw new Error("demo-reset: --secrets <file> is required")
			}
			const uri = parseSecretsFile(
				readFileSync(secretsPath, "utf8"),
			).DEMO_ATLAS_URI
			if (!uri)
				throw new Error("demo-reset: DEMO_ATLAS_URI missing from secrets")
			return MongoClient.connect(uri)
		},
		log: (message) => console.log(message),
	})
	process.exit(code)
}
