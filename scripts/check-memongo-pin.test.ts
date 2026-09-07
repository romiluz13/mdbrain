import { spawnSync } from "node:child_process"
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const REPO_ROOT = resolve(import.meta.dirname, "..")
const WORKFLOW_PATH = join(
	REPO_ROOT,
	".github",
	"workflows",
	"upgrade-rail.yml",
)
const CAPTURE_PATH = join(
	REPO_ROOT,
	"docs",
	"contracts",
	"memongo",
	"2.1.0",
	"capture.json",
)
const tempDirs: string[] = []

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "mdbrain-upgrade-rail-"))
	tempDirs.push(dir)
	return dir
}

function readMovePinExtractionPrefix(): string {
	const workflow = readFileSync(WORKFLOW_PATH, "utf8")
	const stepMarker = "      - name: Move the pin\n"
	const stepStart = workflow.indexOf(stepMarker)
	if (stepStart === -1) {
		throw new Error("Move the pin step not found")
	}

	const nextStep = workflow.indexOf(
		"\n      - name:",
		stepStart + stepMarker.length,
	)
	const step = workflow.slice(
		stepStart,
		nextStep === -1 ? workflow.length : nextStep,
	)
	const runMarker = "        run: |\n"
	const runStart = step.indexOf(runMarker)
	if (runStart === -1) {
		throw new Error("Move the pin run block not found")
	}

	const lines = step.slice(runStart + runMarker.length).split("\n")
	const prefixStart = lines.findIndex(
		(line) => line.trim() === "report=$(cat pin-report.txt)",
	)
	const prefixEnd = lines.findIndex(
		(line, index) => index > prefixStart && line.trim() === "fi",
	)
	if (prefixStart === -1 || prefixEnd === -1) {
		throw new Error("Move the pin extraction guard not found")
	}

	return lines
		.slice(prefixStart, prefixEnd + 1)
		.map((line) => line.slice(10))
		.join("\n")
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

describe("upgrade rail pin extraction", () => {
	it("reads served pin values from the captured contract", () => {
		const servedVersion = "2.2.0"
		const servedSha =
			"c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00"
		const root = createTempDir()
		const checkoutDir = join(root, "mdbrain")
		const scratchCapture = join(
			root,
			"pin-scratch",
			"docs",
			"contracts",
			"memongo",
			servedVersion,
			"capture.json",
		)
		mkdirSync(checkoutDir, { recursive: true })
		mkdirSync(resolve(scratchCapture, ".."), { recursive: true })

		const capture = JSON.parse(readFileSync(CAPTURE_PATH, "utf8")) as {
			openapi: {
				version: string
				canonicalSha256: string
			}
		}
		capture.openapi.version = servedVersion
		capture.openapi.canonicalSha256 = servedSha
		writeFileSync(scratchCapture, `${JSON.stringify(capture, null, "\t")}\n`)

		const pinCheck = spawnSync(
			"bun",
			[join(REPO_ROOT, "scripts", "check-memongo-pin.ts"), scratchCapture],
			{ cwd: checkoutDir, encoding: "utf8" },
		)
		expect(pinCheck.status).toBe(3)
		expect(pinCheck.stdout).toContain(`"version":"${servedVersion}"`)
		expect(pinCheck.stdout).toContain(`"canonicalSha256":"${servedSha}"`)
		writeFileSync(join(checkoutDir, "pin-report.txt"), pinCheck.stdout)

		const extraction = spawnSync(
			"bash",
			[
				"-c",
				`${readMovePinExtractionPrefix()}\nprintf 'version=%s\\nsha=%s\\n' "$version" "$sha"`,
			],
			{ cwd: checkoutDir, encoding: "utf8" },
		)

		expect(extraction.status).toBe(0)
		expect(extraction.stdout).toBe(
			`version=${servedVersion}\nsha=${servedSha}\n`,
		)
	})
})
