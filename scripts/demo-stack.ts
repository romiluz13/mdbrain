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
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { createConnection } from "node:net"
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
import {
	type Observed,
	type ProcessIdentity,
	type StackRecord,
	isSameProcess,
	planStart,
	planStop,
} from "./demo-stack-process.js"

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
)

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
const recordFile = path.join(stackDir, "processes.json")

function identify(pid: number): ProcessIdentity | undefined {
	try {
		const read = (field: string) =>
			execFileSync("ps", ["-p", String(pid), "-o", `${field}=`], {
				encoding: "utf8",
			}).trim()
		return { pid, startedAt: read("lstart"), command: read("command") }
	} catch {
		return undefined
	}
}

function readRecord(): StackRecord | undefined {
	return existsSync(recordFile)
		? (JSON.parse(readFileSync(recordFile, "utf8")) as StackRecord)
		: undefined
}

function observe(record: StackRecord | undefined): Observed {
	return record
		? { memongo: identify(record.memongo.pid), api: identify(record.api.pid) }
		: {}
}

function portInUse(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host: "127.0.0.1", port })
		socket.once("connect", () => {
			socket.destroy()
			resolve(true)
		})
		socket.once("error", () => resolve(false))
	})
}

// Stops only children this run started, identified exactly, then fails.
function abortStart(started: ProcessIdentity[], message: string): never {
	for (const child of started) {
		if (isSameProcess(child, identify(child.pid)))
			process.kill(child.pid, "SIGTERM")
	}
	rmSync(recordFile, { force: true })
	fail(message)
}

async function waitForUrl(
	url: string,
	child: ProcessIdentity,
	started: ProcessIdentity[],
	timeoutMs: number,
): Promise<unknown> {
	const deadline = Date.now() + timeoutMs
	let last = ""
	while (Date.now() < deadline) {
		if (!isSameProcess(child, identify(child.pid)))
			abortStart(
				started,
				`pid ${child.pid} exited before ${url} was ready; see ${stackDir}`,
			)
		try {
			const res = await fetch(url)
			if (res.ok) return await res.json()
			last = `${res.status}`
		} catch (error) {
			last = (error as Error).message
		}
		await new Promise((resolve) => setTimeout(resolve, 1_000))
	}
	abortStart(started, `${url} not ready after ${timeoutMs}ms (last: ${last})`)
}

function startProcess(
	name: string,
	cwd: string,
	env: Record<string, string>,
): ProcessIdentity {
	const log = openSync(path.join(stackDir, `${name}.log`), "a", 0o600)
	const child = spawn("node", ["--import", "tsx", "src/server.ts"], {
		cwd,
		env,
		detached: true,
		stdio: ["ignore", log, log],
	})
	child.unref()
	const identity = child.pid ? identify(child.pid) : undefined
	if (!identity) fail(`${name} did not start`)
	return identity
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

	const record = readRecord()
	const plan = planStart(record, observe(record), {
		memongo: await portInUse(DEMO_MEMONGO_PORT),
		api: await portInUse(DEMO_API_PORT),
	})
	if (plan.action === "refuse") fail(plan.reason)
	if (plan.discardStaleRecord) {
		console.log("demo-stack: discarding a stale process record")
		rmSync(recordFile)
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
	await waitForUrl(
		`http://127.0.0.1:${DEMO_MEMONGO_PORT}/health`,
		memongo,
		[memongo],
		600_000,
	)
	const api = startProcess("api", path.join(repoRoot, "apps/api"), env.api)
	writeFileSync(recordFile, JSON.stringify({ memongo, api }), { mode: 0o600 })
	const ready = await waitForUrl(
		`http://127.0.0.1:${DEMO_API_PORT}/ready`,
		api,
		[memongo, api],
		180_000,
	)
	console.log(`demo-stack: up (memongo pid ${memongo.pid}, api pid ${api.pid})`)
	console.log(`demo-stack: /ready ${JSON.stringify(ready)}`)
}

function stop(): void {
	const record = readRecord() ?? fail(`no process record at ${recordFile}`)
	const plan = planStop(record, observe(record))
	for (const pid of plan.signal) {
		process.kill(pid, "SIGTERM")
		console.log(`demo-stack: stopped pid ${pid}`)
	}
	for (const { name, reason } of plan.skipped) {
		console.log(`demo-stack: left ${name} alone: ${reason}`)
	}
	rmSync(recordFile)
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
