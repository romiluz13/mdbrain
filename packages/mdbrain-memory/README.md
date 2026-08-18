# @mdbrain/memory

Convenience barrel over the supported MDBrain memory surfaces. It re-exports the public HTTP client and the server-side Memongo gateway.

## Install

```bash
npm install @mdbrain/memory
```

## When to use this package

- You want one import for the typed HTTP client and server-side gateway.
- You do not need direct database or Memongo implementation access.

## Example

```ts
import { MdbrainClient, mdbrainBridgeStatus } from "@mdbrain/memory"
```

Prefer the direct packages when you want a narrower dependency surface:

- [`@mdbrain/memory-bridge`](../memory-bridge/README.md)
- [`@mdbrain/client`](../client/README.md)
