// Upgrade rail: rewrite the exact contract pin in
// packages/memory-bridge/src/memongo-runtime.ts to a served version+sha
// (from a capture produced by capture-memongo-contract.ts). Used by the
// automated pin-bump flow; refuses to touch anything but the two exported
// constants, and verifies the rewrite round-trips.
//
// Usage:
//   bun scripts/bump-memongo-pin.ts <version> <canonicalSha256>

import { readFileSync, writeFileSync } from "node:fs"
import process from "node:process"

const RUNTIME_PATH = new URL(
	"../packages/memory-bridge/src/memongo-runtime.ts",
	import.meta.url,
).pathname

function fail(message: string): never {
	console.error(`bump-memongo-pin: ${message}`)
	process.exit(1)
}

function main(): void {
	const version = process.argv[2]?.trim()
	const sha = process.argv[3]?.trim()
	if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
		fail("usage: bun scripts/bump-memongo-pin.ts <version> <canonicalSha256>")
	}
	if (!sha || !/^[a-f0-9]{64}$/.test(sha)) {
		fail("canonicalSha256 must be a 64-char hex digest")
	}

	const source = readFileSync(RUNTIME_PATH, "utf8")
	const next = source
		.replace(
			/export const MEMONGO_CONTRACT_VERSION = "[^"]*"/,
			`export const MEMONGO_CONTRACT_VERSION = "${version}"`,
		)
		.replace(
			/export const MEMONGO_CONTRACT_SHA256 =\n\t"[a-f0-9]*"/,
			`export const MEMONGO_CONTRACT_SHA256 =\n\t"${sha}"`,
		)
	if (next === source) {
		fail("no pin constants matched; refusing to write an unchanged file")
	}
	// Round-trip verification: the rewritten file must expose exactly the
	// requested pin.
	const versionMatch = next.match(
		/export const MEMONGO_CONTRACT_VERSION = "([^"]*)"/,
	)
	const shaMatch = next.match(
		/export const MEMONGO_CONTRACT_SHA256 =\n\t"([a-f0-9]*)"/,
	)
	if (versionMatch?.[1] !== version || shaMatch?.[1] !== sha) {
		fail("rewrite did not round-trip; nothing written")
	}
	writeFileSync(RUNTIME_PATH, next, "utf8")
	console.log(
		`bump-memongo-pin: pin moved to ${version} (${sha.slice(0, 12)}…) in packages/memory-bridge/src/memongo-runtime.ts`,
	)
}

main()
