// The demo read proxy route: every /api/demo/v1/* GET lands here and is
// either refused or forwarded as one allowlisted upstream read. Force-dynamic
// keeps Next from caching the handler output; the server env (read keys, API
// base URL, pinned run, control database URI) never reaches the client.
//
// Which run a request reads is decided here, on the server, for every request
// (lib/demo-presenter/target.ts): a signed-in presenter's leased slot, else the
// pinned run. The browser names neither. Whichever key that target reads with
// must be an exact read-only reader of the target's scope (see
// proxy-principal.ts); anything else counts as missing configuration.

import { handleDemoRead } from "@/lib/demo-data/proxy.js"
import { createReadKeyCheck } from "@/lib/demo-data/proxy-principal.js"
import {
	createRunManifestSource,
	withControlScope,
} from "@/lib/demo-data/run-store.js"
import { readRunDeadlineMs } from "@/lib/demo-presenter/config.js"
import { presenterRuntime } from "@/lib/demo-presenter/server.js"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const checkReadKey = createReadKeyCheck()

// The presenter's cookie decides which run a URL reads, so no answer at a URL,
// refusal or body, may be reused for a request with another cookie.
const refused = (status: number, code: string, message: string): Response =>
	new Response(JSON.stringify({ error: { code, message } }), {
		status,
		headers: { "content-type": "application/json", vary: "cookie" },
	})

export const GET = (request: Request): Promise<Response> =>
	withControlScope(() => read(request))

async function read(request: Request): Promise<Response> {
	const resolved = await presenterRuntime().resolver.resolve(request)
	if (!resolved.ok) {
		return refused(resolved.status, resolved.code, resolved.message)
	}
	const { env, run, mode } = resolved.target
	if (!(await checkReadKey(env, fetch))) {
		return refused(
			503,
			"PROXY_NOT_CONFIGURED",
			"the demo read proxy is missing its server configuration",
		)
	}
	const response = await handleDemoRead(request, env, fetch, {
		run,
		manifest: run ? createRunManifestSource(run) : async () => null,
		deadline: { now: () => new Date(), ms: readRunDeadlineMs(process.env) },
	})
	const headers = new Headers(response.headers)
	headers.set("vary", "cookie")
	// A presenter's slot is theirs alone: no shared cache may keep it.
	if (mode === "presenter") headers.set("cache-control", "private, no-store")
	return new Response(response.body, { status: response.status, headers })
}
