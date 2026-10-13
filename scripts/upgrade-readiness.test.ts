import { spawnSync } from "node:child_process"
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const workflow = readFileSync(
	new URL("../.github/workflows/upgrade-rail.yml", import.meta.url),
	"utf8",
)
const bootStep = workflow
	.split("      - name: Boot mongodb + memongo only\n")[1]
	?.split("\n      - name:")[0]
const bootScript = bootStep
	?.split("        run: |\n")[1]
	?.split("\n")
	.map((line) => line.slice(10))
	.join("\n")

describe("upgrade rail startup", () => {
	it.each([
		false,
		true,
	])("waits for health and preserves boot failure=%s", (failBoot) => {
		const dir = mkdtempSync(join(tmpdir(), "mdbrain-health-wait-"))
		try {
			expect(bootScript).toBeTruthy()
			writeFileSync(
				join(dir, "docker"),
				`#!/bin/sh
printf '%s\\n' "$*"
case "$*" in
  *"up -d --wait --wait-timeout 180 mongodb memongo"*) exit ${failBoot ? 1 : 0} ;;
  *"logs"*) echo "startup diagnostics"; exit 0 ;;
  *) echo "unexpected command"; exit 2 ;;
esac
`,
			)
			chmodSync(join(dir, "docker"), 0o755)
			const run = spawnSync(
				"bash",
				[
					"-e",
					"-c",
					`${bootScript?.replace("cd mdbrain", `cd '${dir}'`)}\necho capture-reached`,
				],
				{
					cwd: dir,
					encoding: "utf8",
					env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
				},
			)
			expect(run.status).toBe(failBoot ? 1 : 0)
			if (failBoot) {
				expect(run.stdout).toContain("startup diagnostics")
				expect(run.stdout).not.toContain("capture-reached")
			} else {
				expect(run.stdout).toContain("capture-reached")
				expect(run.stdout).not.toContain("startup diagnostics")
			}
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})
