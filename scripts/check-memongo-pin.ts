// Upgrade rail: compare the contract a Memongo server actually serves
// against the exact pin enforced by the memory bridge
// (packages/memory-bridge/src/memongo-runtime.ts). The bridge fail-closes
// on any mismatch at runtime; this script makes the same comparison
// observable WITHOUT a full mdbrain boot, so CI can report drift as data
// (new version + sha) instead of an opaque readiness failure.
//
// Exit codes:
//   0  conformant — served version and canonical sha equal the pin
//   3  drift — served contract differs from the pin (details on stdout)
//   1  error — server unreachable, malformed capture, or unparsable pin
//
// Usage (capture first, e.g. into a scratch directory):
//   cd <scratch-dir> && MEMONGO_API_URL=http://127.0.0.1:3848 \
//     bun <repo>/scripts/capture-memongo-contract.ts
//   bun <repo>/scripts/check-memongo-pin.ts <scratch-dir>/docs/contracts/memongo/<version>/capture.json

import { readFileSync } from "node:fs"
import process from "node:process"
import {
	MEMONGO_CONTRACT_SHA256,
	MEMONGO_CONTRACT_VERSION,
} from "../packages/memory-bridge/src/memongo-runtime.js"

type CaptureDocument = {
	openapi?: {
		version?: unknown
		canonicalSha256?: unknown
		rawSha256?: unknown
		pathCount?: unknown
	}
}

function fail(message: string): never {
	console.error(`check-memongo-pin: ${message}`)
	process.exit(1)
}

function main(): void {
	const capturePath = process.argv[2]
	if (!capturePath) {
		fail("usage: bun scripts/check-memongo-pin.ts <capture.json>")
	}
	let capture: CaptureDocument
	try {
		capture = JSON.parse(readFileSync(capturePath, "utf8")) as CaptureDocument
	} catch (err) {
		fail(`could not read capture ${capturePath}: ${err}`)
	}
	const openApi = capture.openapi ?? {}
	if (
		typeof openApi.version !== "string" ||
		typeof openApi.canonicalSha256 !== "string"
	) {
		fail(`capture ${capturePath} is missing openapi.version/canonicalSha256`)
	}

	const served = {
		version: openApi.version,
		canonicalSha256: openApi.canonicalSha256,
	}
	const pinned = {
		version: MEMONGO_CONTRACT_VERSION,
		canonicalSha256: MEMONGO_CONTRACT_SHA256,
	}

	if (
		served.version === pinned.version &&
		served.canonicalSha256 === pinned.canonicalSha256
	) {
		console.log(
			`check-memongo-pin: CONFORMANT served ${served.version} matches the pin (${served.canonicalSha256.slice(0, 12)}…)`,
		)
		return
	}

	// Drift is data, not an error: print the values the pin-bump step needs.
	console.log(
		`check-memongo-pin: DRIFT served ${JSON.stringify({
			...served,
			pinned,
			versionChanged: served.version !== pinned.version,
			shaChanged: served.canonicalSha256 !== pinned.canonicalSha256,
			pathCount:
				typeof openApi.pathCount === "number" ? openApi.pathCount : null,
		})}`,
	)
	process.exit(3)
}

main()
