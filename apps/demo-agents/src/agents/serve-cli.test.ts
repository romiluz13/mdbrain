import { afterEach, describe, expect, it, vi } from "vitest"

const control = {
	db: { name: "control-db" },
	manifests: { name: "manifests" },
	close: vi.fn(async () => undefined),
}
const secrets = { anthropicKey: "sk-ant-never-printed" }
const serveRunRequests = vi.fn(async (_deps: unknown) => undefined)
const executeAgentRun = vi.fn(async (..._args: unknown[]) => undefined)

vi.mock("../seeding/run.js", () => ({
	readSecrets: vi.fn(() => secrets),
	openControl: vi.fn(async () => control),
}))
vi.mock("../seeding/stores.js", () => ({
	createControlStores: vi.fn(() => ({ runRequestStore: { name: "requests" } })),
}))
vi.mock("./run-requests.js", () => ({
	createRunRequests: vi.fn(() => ({ name: "run-requests" })),
}))
vi.mock("./run.js", () => ({
	executeAgentRun: (...args: unknown[]) => executeAgentRun(...args),
}))
vi.mock("./serve.js", () => ({
	serveRunRequests: (deps: unknown) => serveRunRequests(deps),
}))

const { main } = await import("./serve-cli.js")

type ServedDeps = {
	workerId: string
	once?: boolean
	pollMs: number
	signal: AbortSignal
	sleep: (ms: number) => Promise<void>
	execute: (request: { _id: string }, owner: string) => Promise<void>
	log: (line: string) => void
}

const served = (): ServedDeps => {
	const call = serveRunRequests.mock.calls.at(0)
	if (!call) throw new Error("the worker was never started")
	return call[0] as ServedDeps
}

afterEach(() => {
	vi.restoreAllMocks()
	serveRunRequests.mockClear()
	executeAgentRun.mockClear()
	control.close.mockClear()
})

describe("agents:serve entrypoint", () => {
	it("prints the usage and exits 2 when no secrets file is named", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: number,
		) => {
			throw new Error(`exit ${code}`)
		}) as typeof process.exit)
		await expect(main([])).rejects.toThrow("exit 2")
		expect(error).toHaveBeenCalledWith(
			"usage: agents:serve -- --secrets <file> [--once]",
		)
		expect(exit).toHaveBeenCalledWith(2)
		expect(serveRunRequests).not.toHaveBeenCalled()
	})

	it("serves with a worker id, forwards --once, and closes the control connection", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined)
		await main(["--secrets", "secrets.env", "--once"])
		const deps = served()
		expect(deps.workerId).toMatch(/^worker-[0-9a-f]{8}$/)
		expect(deps.once).toBe(true)
		expect(control.close).toHaveBeenCalledTimes(1)
	})

	it("closes the control connection when serving throws", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined)
		serveRunRequests.mockRejectedValueOnce(new Error("store down"))
		await expect(main(["--secrets", "secrets.env"])).rejects.toThrow(
			"store down",
		)
		expect(control.close).toHaveBeenCalledTimes(1)
	})

	it("runs the run named by the request and passes the claim's owner through", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined)
		await main(["--secrets", "secrets.env"])
		await served().execute({ _id: "run-13" }, "worker-1@2026-10-23T12:00:00Z")
		expect(executeAgentRun).toHaveBeenCalledWith(
			{ secrets, control },
			"run-13",
			"worker-1@2026-10-23T12:00:00Z",
		)
	})

	it("stops on SIGTERM and wakes a sleeping poll at once", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined)
		const before = new Set(process.listeners("SIGTERM"))
		await main(["--secrets", "secrets.env"])
		const handler = process
			.listeners("SIGTERM")
			.find((listener) => !before.has(listener))
		if (!handler) throw new Error("no SIGTERM handler was registered")
		const deps = served()
		const sleeping = deps.sleep(60_000)
		expect(deps.signal.aborted).toBe(false)
		handler("SIGTERM")
		await sleeping
		expect(deps.signal.aborted).toBe(true)
		process.off("SIGTERM", handler)
	})

	it("logs lines under the worker id and never prints a key value", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
		await main(["--secrets", "secrets.env"])
		const deps = served()
		deps.log("claimed run-13")
		const lines = log.mock.calls.map((call) => String(call[0]))
		expect(lines).toContain(`${deps.workerId}: serving run requests`)
		expect(lines).toContain(`${deps.workerId}: claimed run-13`)
		expect(lines.join("\n")).not.toContain(secrets.anthropicKey)
	})
})
