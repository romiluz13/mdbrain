// Local demo stack: Memongo (separate clone at the pinned commit) plus the
// mdbrain API on the host, against the demo databases only.
//
// Usage:
//   bun scripts/demo-stack.ts start  --secrets <file> --memongo <clone dir> [--stack-dir <dir>]
//   bun scripts/demo-stack.ts status [--stack-dir <dir>]
//   bun scripts/demo-stack.ts stop   [--stack-dir <dir>]
//
// The clone must sit at the pinned Memongo commit. Logs and pids live in the
// stack dir, outside the repo.

import { execFileSync, spawn } from "node:child_process"
import {
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { MongoClient } from "mongodb"
import { MEMONGO_CONTRACT_SOURCE_REF } from "../packages/memory-bridge/src/memongo-runtime.js"
import {
	DEMO_API_PORT,
	DEMO_MEMONGO_PORT,
	buildDemoStackEnv,
	parseSecretsFile,
} from "./demo-stack-config.js"

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
)

type Pids = { memongo: number; api: number }

function arg(name: string): string | undefined {
	const index = process.argv.indexOf(name)
	return index > 0 ? process.argv[index + 1] : undefined
}

function fail(message: string): never {
	console.error(`demo-stack: ${message}`)
	process.exit(1)
}

const stackDir = path.resolve(
	arg("--stack-dir") ?? path.join(repoRoot, "..", "mdbrain-demo-stack"),
)
const pidsFile = path.join(stackDir, "pids.json")

function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

async function waitForUrl(
	url: string,
	pid: number,
	timeoutMs: number,
): Promise<unknown> {
	const deadline = Date.now() + timeoutMs
	let last = ""
	while (Date.now() < deadline) {
		if (!isRunning(pid))
			fail(`pid ${pid} exited before ${url} was ready; see ${stackDir}`)
		try {
			const res = await fetch(url)
			if (res.ok) return await res.json()
			last = `${res.status}`
		} catch (error) {
			last = (error as Error).message
		}
		await new Promise((resolve) => setTimeout(resolve, 1_000))
	}
	fail(`${url} not ready after ${timeoutMs}ms (last: ${last})`)
}

function startProcess(
	name: string,
	cwd: string,
	env: Record<string, string>,
): number {
	const log = openSync(path.join(stackDir, `${name}.log`), "a", 0o600)
	const child = spawn("node", ["--import", "tsx", "src/server.ts"], {
		cwd,
		env,
		detached: true,
		stdio: ["ignore", log, log],
	})
	child.unref()
	if (!child.pid) fail(`${name} did not start`)
	return child.pid
}

async function start(): Promise<void> {
	const secretsPath = arg("--secrets") ?? fail("--secrets <file> is required")
	const memongoDir = path.resolve(
		arg("--memongo") ?? fail("--memongo <clone dir> is required"),
	)
	const head = execFileSync("git", ["-C", memongoDir, "rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim()
	if (head !== MEMONGO_CONTRACT_SOURCE_REF) {
		fail(
			`Memongo clone is at ${head}, expected pin ${MEMONGO_CONTRACT_SOURCE_REF}`,
		)
	}

	const secrets = parseSecretsFile(readFileSync(secretsPath, "utf8"))
	const env = buildDemoStackEnv(secrets, { stackDir })
	mkdirSync(path.join(stackDir, "home"), { recursive: true, mode: 0o700 })

	const client = await MongoClient.connect(secrets.DEMO_ATLAS_URI ?? "")
	try {
		const { databases } = await client
			.db("admin")
			.admin()
			.listDatabases({ nameOnly: true })
		console.log(
			`demo-stack: databases before start: ${databases.map((d) => d.name).join(", ")}`,
		)
	} finally {
		await client.close()
	}

	const memongo = startProcess(
		"memongo",
		path.join(memongoDir, "apps/api"),
		env.memongo,
	)
	writeFileSync(pidsFile, JSON.stringify({ memongo, api: 0 }), { mode: 0o600 })
	await waitForUrl(
		`http://127.0.0.1:${DEMO_MEMONGO_PORT}/health`,
		memongo,
		600_000,
	)
	const api = startProcess("api", path.join(repoRoot, "apps/api"), env.api)
	writeFileSync(pidsFile, JSON.stringify({ memongo, api }), { mode: 0o600 })
	const ready = await waitForUrl(
		`http://127.0.0.1:${DEMO_API_PORT}/ready`,
		api,
		180_000,
	)
	console.log(`demo-stack: up (memongo pid ${memongo}, api pid ${api})`)
	console.log(`demo-stack: /ready ${JSON.stringify(ready)}`)
}

function stopPid(name: string, pid: number): void {
	if (!pid) return
	let command = ""
	try {
		command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
			encoding: "utf8",
		}).trim()
	} catch {
		console.log(`demo-stack: ${name} pid ${pid} not running`)
		return
	}
	if (!command.includes("src/server.ts")) {
		fail(`pid ${pid} is not the ${name} server (${command}); not stopping it`)
	}
	process.kill(pid, "SIGTERM")
	console.log(`demo-stack: stopped ${name} pid ${pid}`)
}

function stop(): void {
	const pids = JSON.parse(readFileSync(pidsFile, "utf8")) as Pids
	stopPid("api", pids.api)
	stopPid("memongo", pids.memongo)
	rmSync(pidsFile)
}

async function status(): Promise<void> {
	const res = await fetch(`http://127.0.0.1:${DEMO_API_PORT}/ready`).catch(
		() => undefined,
	)
	console.log(
		res
			? `demo-stack: /ready ${res.status} ${await res.text()}`
			: "demo-stack: API not reachable",
	)
}

const command = process.argv[2]
if (command === "start") await start()
else if (command === "stop") stop()
else if (command === "status") await status()
else fail("usage: start | stop | status")
