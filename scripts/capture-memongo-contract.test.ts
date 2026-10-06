import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { expect, it } from "vitest"

const run = promisify(execFile)
const script = resolve(import.meta.dirname, "capture-memongo-contract.ts")

it("captures a changed same-version contract without replacing historical evidence", async () => {
	const document = { info: { version: "2.1.0" }, openapi: "3.0.3", paths: {} }
	const sha = createHash("sha256")
		.update(JSON.stringify(document))
		.digest("hex")
	const root = await mkdtemp(join(tmpdir(), "mdbrain-contract-"))
	const server = createServer((request, response) => {
		response.setHeader("content-type", "application/json")
		response.end(
			JSON.stringify(request.url === "/openapi.json" ? document : { ok: true }),
		)
	})
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
	const address = server.address()
	if (!address || typeof address === "string")
		throw new Error("Missing test port")
	const env = {
		...process.env,
		MEMONGO_API_URL: `http://127.0.0.1:${address.port}`,
	}
	const versionDir = join(root, "docs/contracts/memongo/2.1.0")
	try {
		await mkdir(versionDir, { recursive: true })
		await writeFile(join(versionDir, "openapi.json"), "historical evidence\n")
		await run("bun", [script], { cwd: root, env })
		expect(await readFile(join(versionDir, "openapi.json"), "utf8")).toBe(
			"historical evidence\n",
		)
		const captured = JSON.parse(
			await readFile(join(versionDir, sha, "capture.json"), "utf8"),
		)
		expect(captured.openapi).toMatchObject({
			version: "2.1.0",
			canonicalSha256: sha,
		})
		await expect(
			run("bun", [script], { cwd: root, env }),
		).rejects.toMatchObject({
			stderr: expect.stringContaining(
				"Refusing to overwrite existing contract evidence",
			),
		})
	} finally {
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		)
		await rm(root, { recursive: true, force: true })
	}
})
