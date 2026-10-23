// Operator entrypoint for the presenter's runner worker (ticket 14): serves the
// run requests the web server queues in the control store. Never prints key
// values.
//
// Usage (from apps/demo-agents):
//   bun run agents:serve -- --secrets <file> [--once]
//
// The secrets file is the one `agents:run` reads. The worker stops on SIGINT or
// SIGTERM after the run in flight ends. Ceilings come from the environment, as
// for `agents:run`, plus DEMO_AGENT_RUN_DEADLINE_MS for the whole-run deadline.
import { randomUUID } from "node:crypto"
import { parseArgs } from "node:util"
import { openControl, readSecrets } from "../seeding/run.js"
import { createControlStores } from "../seeding/stores.js"
import { agentRunDeadlineMs } from "./config.js"
import { createRunRequests } from "./run-requests.js"
import { executeAgentRun } from "./run.js"
import { serveRunRequests } from "./serve.js"

const POLL_MS = 2_000

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			secrets: { type: "string" },
			once: { type: "boolean" },
		},
	})
	if (!values.secrets) {
		console.error("usage: agents:serve -- --secrets <file> [--once]")
		process.exit(2)
	}
	const secrets = readSecrets(values.secrets)
	const control = await openControl(secrets)
	const stores = createControlStores(control.db)
	const controller = new AbortController()
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => controller.abort())
	}
	const workerId = `worker-${randomUUID().slice(0, 8)}`
	console.log(`${workerId}: serving run requests`)
	try {
		await serveRunRequests({
			requests: createRunRequests(stores.runRequestStore, {
				runDeadlineMs: agentRunDeadlineMs(process.env),
			}),
			manifests: control.manifests,
			execute: (request, owner) =>
				executeAgentRun({ secrets, control }, request._id, owner),
			workerId,
			pollMs: POLL_MS,
			sleep: (ms) =>
				new Promise((resolve) => {
					const timer = setTimeout(resolve, ms)
					controller.signal.addEventListener(
						"abort",
						() => {
							clearTimeout(timer)
							resolve()
						},
						{ once: true },
					)
				}),
			signal: controller.signal,
			once: values.once,
			log: (line) => console.log(`${workerId}: ${line}`),
		})
	} finally {
		await control.close()
	}
}

if (
	process.argv[1] &&
	import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
	await main()
}
