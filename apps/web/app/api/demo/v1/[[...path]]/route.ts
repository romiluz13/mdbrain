// The demo read proxy route: every /api/demo/v1/* GET lands here and is
// either refused or forwarded as one allowlisted upstream read. Force-dynamic
// keeps Next from caching the handler output; the server env (read key, API
// base URL, pinned scope, control database URI) never reaches the client.

import {
	handleDemoRead,
	readDemoProxyEnv,
	type DemoProxyEnv,
} from "@/lib/demo-data/proxy.js"
import { readDemoRunEnv } from "@/lib/demo-data/proxy-run.js"
import { createRunManifestSource } from "@/lib/demo-data/run-store.js"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request): Promise<Response> {
	const env: DemoProxyEnv | null = readDemoProxyEnv(process.env)
	if (!env) {
		return new Response(
			JSON.stringify({
				error: {
					code: "PROXY_NOT_CONFIGURED",
					message: "the demo read proxy is missing its server configuration",
				},
			}),
			{ status: 503, headers: { "content-type": "application/json" } },
		)
	}
	// The run's record is read from the control database; with no run env the
	// run paths say so and every other read is unaffected.
	const run = readDemoRunEnv(process.env)
	return handleDemoRead(request, env, fetch, {
		run,
		manifest: run ? createRunManifestSource(run) : async () => null,
	})
}
