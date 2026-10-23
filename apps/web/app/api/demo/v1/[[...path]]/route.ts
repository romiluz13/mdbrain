// The demo read proxy route: every /api/demo/v1/* GET lands here and is
// either refused or forwarded as one allowlisted upstream read. Force-dynamic
// keeps Next from caching the handler output; the server env (read keys, API
// base URL, pinned run, control database URI) never reaches the client.
//
// Which run a request reads is decided here, on the server, for every request
// (lib/demo-presenter/target.ts): a signed-in presenter's leased slot, else the
// pinned run. The browser names neither.

import { handleDemoRead } from "@/lib/demo-data/proxy.js"
import { createRunManifestSource } from "@/lib/demo-data/run-store.js"
import { readRunDeadlineMs } from "@/lib/demo-presenter/config.js"
import { presenterRuntime } from "@/lib/demo-presenter/server.js"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request): Promise<Response> {
	const resolved = await presenterRuntime().resolver.resolve(request)
	if (!resolved.ok) {
		return new Response(
			JSON.stringify({
				error: { code: resolved.code, message: resolved.message },
			}),
			{
				status: resolved.status,
				headers: { "content-type": "application/json" },
			},
		)
	}
	const { env, run, mode } = resolved.target
	const response = await handleDemoRead(request, env, fetch, {
		run,
		manifest: run ? createRunManifestSource(run) : async () => null,
		deadline: { now: () => new Date(), ms: readRunDeadlineMs(process.env) },
	})
	if (mode !== "presenter") return response
	// A presenter's slot is theirs alone: no shared cache may keep it.
	const headers = new Headers(response.headers)
	headers.set("cache-control", "private, no-store")
	headers.set("vary", "cookie")
	return new Response(response.body, { status: response.status, headers })
}
