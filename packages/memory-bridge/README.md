# @mdbrain/memory-bridge

Version-pinned Memongo HTTP gateway used by MDBrain server applications. It validates Memongo contract compatibility and exposes only supported remote operations.

## Install

```bash
npm install @mdbrain/memory-bridge
```

## When to use this package

- You are implementing the MDBrain HTTP API or another trusted server.
- You need compatibility-checked access to a Memongo 2.0.1 deployment.
- You do not need direct access to Memongo storage internals.

## Example

```ts
import { mdbrainBridgeSearch, mdbrainBridgeStatus } from "@mdbrain/memory-bridge"

const status = await mdbrainBridgeStatus({ agentId: "main" })
const results = await mdbrainBridgeSearch({
	query: "deployment notes",
	agentId: "main",
	maxResults: 10,
})
```

If you are building against the public HTTP surface, prefer [`@mdbrain/client`](../client/README.md).
