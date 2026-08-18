# @mdbrain/tools

AI SDK tool helpers for Mdbrain. Use this package when you want to expose supported Mdbrain operations as Vercel AI SDK tools.

## Install

```bash
npm install @mdbrain/tools
```

## When to use this package

- You are wiring Mdbrain into an AI SDK agent.
- You want ready-made tool definitions for search, KB search, idempotent writes, profile, state/context hydration, lifecycle operations, and feedback.

## Example

```ts
import { MdbrainClient } from "@mdbrain/client"
import { createMdbrainTools } from "@mdbrain/tools"

const client = new MdbrainClient({ baseUrl: "http://127.0.0.1:3847" })
const tools = createMdbrainTools(client)
```

## Model middleware

The package also exports middleware for the Vercel AI SDK and OpenAI-compatible
clients:

```ts
import {
	createOpenAIMiddleware,
	type MdbrainCoreOptions,
	type MdbrainWriteFailure,
	withMdbrain,
} from "@mdbrain/tools"

const options: MdbrainCoreOptions = {
	apiUrl: "http://127.0.0.1:3847",
	apiKey: process.env.MDBRAIN_API_KEY!,
	userId: "user-123",
	agentId: "support-agent",
	onWriteError(failure: MdbrainWriteFailure) {
		console.error("Mdbrain write failed", failure)
	},
}

const memoryModel = withMdbrain(model, options)
const memoryOpenAI = createOpenAIMiddleware(openai, options)
```

`withMdbrain()` wraps a Vercel AI SDK language model.
`createOpenAIMiddleware()` wraps an OpenAI-compatible client and intercepts
`chat.completions.create()`. Both inject a context bundle and asynchronously
write user and assistant events.

Each logical event receives a distinct `Idempotency-Key`. A failed write is
retried once for network errors, HTTP 408, HTTP 429, and HTTP 5xx responses,
using the same key for the retry. Other HTTP 4xx responses are not retried.

`MdbrainCoreOptions.onWriteError` observes failures after retries are exhausted.
It receives a sanitized `MdbrainWriteFailure` with:

- `role`: `"user"` or `"assistant"`
- `kind`: `"http"` or `"network"`
- `status`: HTTP status when available
- `code`: `"HTTP_ERROR"` or `"NETWORK_ERROR"`
- `message`: a generic failure description
- `attempts`: total write attempts

The failure does not contain response bodies, API keys, message content, or
other secrets. If `onWriteError` is absent or itself fails, the middleware
falls back to `console.warn`. Writes remain fire-and-forget: write failures,
retry latency, and observer failures never change or reject the model response
or stream.

The package exposes 14 tools backed by the supported MDBrain HTTP client. It
intentionally excludes filesystem reads, sync, consolidation, benchmark,
trace, job, provider-status, probe, and raw admin operations.

If you need a different agent wrapper or a custom tool set, build on top of [`@mdbrain/client`](../client/README.md).
