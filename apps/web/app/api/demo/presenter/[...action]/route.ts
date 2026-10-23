// The presenter routes (ticket 14): sign in with the presenter token, lease a
// slot, run the agents, decide the pending proposal, pin a run. One dispatcher
// over a fixed route table; see lib/demo-presenter/presenter-api.ts. Public
// visitors reach only `state`, which answers "public" without a session.

import { handlePresenterRequest } from "@/lib/demo-presenter/presenter-api.js"
import { presenterRuntime } from "@/lib/demo-presenter/server.js"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Context = { params: Promise<{ action: string[] }> }

async function handle(request: Request, context: Context): Promise<Response> {
	const { action } = await context.params
	return handlePresenterRequest(request, action, presenterRuntime().services)
}

export const GET = handle
export const POST = handle
