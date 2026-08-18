# @mdbrain/client

TypeScript HTTP client for the Mdbrain API. Use this package when you want to call the supported public API from an app, job, or integration.

## Install

```bash
npm install @mdbrain/client
```

## When to use this package

- You are talking to `apps/api`.
- You want retrying HTTP requests and a typed client surface.
- You do not need server-side gateway access.

## Example

```ts
import { MdbrainClient } from "@mdbrain/client"

const client = new MdbrainClient({
	baseUrl: "http://127.0.0.1:3847",
})

await client.add({
	content: "The user prefers concise release notes.",
	sessionId: "main",
	idempotencyKey: crypto.randomUUID(),
})

const results = await client.search({
	query: "What does the user prefer?",
	sessionKey: "main",
})
```

## Deadlines, cancellation, and retries

Every request has a 10-second total deadline by default. Set a different client
default with `defaultDeadlineMs`, or override one call and attach caller
cancellation with its second argument:

```ts
const client = new MdbrainClient({
	baseUrl: "http://127.0.0.1:3847",
	defaultDeadlineMs: 5_000,
})

const controller = new AbortController()
const results = await client.search(
	{ query: "What does the user prefer?" },
	{ timeoutMs: 2_000, signal: controller.signal },
)
```

Safe reads retry transient transport failures plus HTTP 429 and 503 responses.
`Retry-After` is honored when it fits inside the total call deadline. `add` and
`writeEvent` may retry because their required idempotency key and exact request
body are reused. Other mutations are attempted once.

## Supported operations

The client covers conversational writes, search and advanced retrieval, state
and context hydration, lifecycle operations, feedback, and profile.
Event-producing writes require a caller-owned idempotency key. Server-local
liveness, readiness, provider status, and probes are intentionally not client
methods.

If you need server-side Memongo gateway helpers, use [`@mdbrain/memory-bridge`](../memory-bridge/README.md).
