// Upgrade rail: rewrite the exact contract pin in
// packages/memory-bridge/src/memongo-runtime.ts to a served version+sha
// (from a capture produced by capture-memongo-contract.ts), plus the git
// ref of the Memongo commit that served it. The same ref is rewritten in
// the README quickstart checkout command so a moved pin can never leave
// the documented quickstart on a stale contract. Used by the automated
// pin-bump flow; refuses to touch anything but the three exported
// constants and the one README checkout line, verifies both rewrites
// round-trip, and only writes after both are validated (all-or-nothing).
//
// Usage:
//   bun scripts/bump-memongo-pin.ts <version> <canonicalSha256> <sourceRef>

import { readFileSync, writeFileSync } from "node:fs"
import process from "node:process"

const RUNTIME_PATH = new URL(
	"../packages/memory-bridge/src/memongo-runtime.ts",
	import.meta.url,
).pathname

const README_PATH = new URL("../README.md", import.meta.url).pathname

// Whitespace-tolerant so a formatter-wrapped constant line still matches.
const VERSION_PATTERN = /export const MEMONGO_CONTRACT_VERSION =\s*"[^"]*"/
const SHA_PATTERN = /export const MEMONGO_CONTRACT_SHA256 =\s*"[a-f0-9]*"/
const REF_PATTERN = /export const MEMONGO_CONTRACT_SOURCE_REF =\s*"[a-f0-9]*"/
// Exactly one quickstart checkout command, carrying a full 40-char ref.
const README_CHECKOUT_COMMAND = /git -C \.\.\/memongo checkout ([a-f0-9]{40})/g

function fail(message: string): never {
	console.error(`bump-memongo-pin: ${message}`)
	process.exit(1)
}

function main(): void {
	const version = process.argv[2]?.trim()
	const sha = process.argv[3]?.trim()
	const sourceRef = process.argv[4]?.trim()
	if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !sha || !sourceRef) {
		fail(
			"usage: bun scripts/bump-memongo-pin.ts <version> <canonicalSha256> <sourceRef>",
		)
	}
	if (!/^[a-f0-9]{64}$/.test(sha)) {
		fail("canonicalSha256 must be a 64-char hex digest")
	}
	// Full 40-char commit ids only: actions/checkout (and a bare git fetch
	// against the remote) cannot resolve abbreviated SHAs, so a short ref
	// would fail the CI bundle-smoke checkout and the README quickstart.
	if (!/^[a-f0-9]{40}$/.test(sourceRef)) {
		fail("sourceRef must be a full 40-char Memongo git commit id")
	}

	// --- Validate and stage the runtime rewrite ---------------------------
	const source = readFileSync(RUNTIME_PATH, "utf8")
	const next = source
		.replace(
			VERSION_PATTERN,
			`export const MEMONGO_CONTRACT_VERSION = "${version}"`,
		)
		.replace(SHA_PATTERN, `export const MEMONGO_CONTRACT_SHA256 =\n\t"${sha}"`)
		.replace(
			REF_PATTERN,
			`export const MEMONGO_CONTRACT_SOURCE_REF =\n\t"${sourceRef}"`,
		)
	if (next === source) {
		fail("no pin constants matched; refusing to write an unchanged file")
	}
	// Round-trip verification: the rewritten file must expose exactly the
	// requested pin (patterns are \s*-tolerant, so formatter wrapping is
	// irrelevant to the check).
	const versionMatch = next.match(/MEMONGO_CONTRACT_VERSION =\s*"([^"]*)"/)
	const shaMatch = next.match(/MEMONGO_CONTRACT_SHA256 =\s*"([a-f0-9]*)"/)
	const refMatch = next.match(/MEMONGO_CONTRACT_SOURCE_REF =\s*"([a-f0-9]*)"/)
	if (
		versionMatch?.[1] !== version ||
		shaMatch?.[1] !== sha ||
		refMatch?.[1] !== sourceRef
	) {
		fail("rewrite did not round-trip; nothing written")
	}

	// --- Validate and stage the README rewrite ----------------------------
	// Keep the quickstart checkout in lockstep with the pin (the documented
	// command must check out the same commit CI does). Validated BEFORE any
	// write so a README problem cannot leave a half-applied bump.
	const readme = readFileSync(README_PATH, "utf8")
	const checkoutCommands = readme.match(README_CHECKOUT_COMMAND)
	if (!checkoutCommands) {
		fail(
			"README quickstart memongo checkout command not found; refusing to leave it stale",
		)
	}
	if (checkoutCommands.length > 1) {
		fail(
			"README contains more than one memongo checkout command; refusing an ambiguous rewrite",
		)
	}
	const nextReadme = readme.replace(
		README_CHECKOUT_COMMAND,
		`git -C ../memongo checkout ${sourceRef}`,
	)
	if (!nextReadme.includes(`git -C ../memongo checkout ${sourceRef}`)) {
		fail("README checkout rewrite did not round-trip; nothing written")
	}

	// --- All validations passed: commit both writes -----------------------
	writeFileSync(RUNTIME_PATH, next, "utf8")
	writeFileSync(README_PATH, nextReadme, "utf8")
	console.log(
		`bump-memongo-pin: pin moved to ${version} (${sha.slice(0, 12)}…) from ref ${sourceRef} in packages/memory-bridge/src/memongo-runtime.ts (README quickstart checkout updated to match)`,
	)
}

main()
