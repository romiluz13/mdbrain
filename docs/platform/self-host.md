# Self-hosting

## One-command local bundle (compose)

The full stack — MongoDB (Atlas Local + Search) → Memongo → MDBrain API →
web console — boots with a single command when the
[memongo](https://github.com/romiluz13/Memongo) repository is cloned as a
sibling of mdbrain (the compose file builds the memongo image from
`../../memongo`):

```bash
git clone https://github.com/romiluz13/mdbrain
git clone https://github.com/romiluz13/Memongo memongo
cd mdbrain
docker compose -f docker/compose.full.yml up -d
open http://127.0.0.1:3040
```

Defaults and overrides:

- Every host port is bound to loopback only. API: `127.0.0.1:3847`
  (override with `MDBRAIN_API_PORT`), web: `127.0.0.1:3040`
  (`MDBRAIN_WEB_PORT`), memongo (capture/debug): `127.0.0.1:3848`
  (`MEMONGO_HOST_PORT`).
- `MDBRAIN_API_KEY` and `MEMONGO_API_KEY` default to development
  placeholders (`dev-mdbrain-key`, `dev-memongo-key`). Set real secrets
  before exposing anything beyond localhost.
- `VOYAGE_API_KEY` (Atlas model API key) is optional; without it the stack
  boots degraded with text search only.
- The API talks to memongo over plain HTTP inside the isolated compose
  network via `MEMONGO_ALLOW_INSECURE_HTTP=1` (see the transport note below).
- `docker compose -f docker/compose.full.yml down -v` tears the stack down
  and removes its volumes.

`scripts/compose-smoke.ts` verifies a running bundle end to end (no
LLM/embedding keys required): `MDBRAIN_API_KEY=dev-mdbrain-key bun
scripts/compose-smoke.ts`.

## Manual service setup

MDBrain requires a compatible Memongo HTTP service and a separate
transaction-capable MongoDB deployment for the wiki.

```bash
export MDBRAIN_WIKI_MONGODB_URI="mongodb://wiki-rs/?replicaSet=rs0"
export MDBRAIN_WIKI_DATABASE="mdbrain_wiki"
export MEMONGO_API_URL="https://memongo.example.com"
export MEMONGO_API_KEY="..."
export MDBRAIN_API_KEY="..."
bun run --cwd apps/api start
```

Terminate TLS at the service or trusted ingress. Do not enable
`MEMONGO_ALLOW_INSECURE_LOCAL` (loopback plain HTTP) or
`MEMONGO_ALLOW_INSECURE_HTTP` (any-host plain HTTP, isolated private
networks such as a compose bridge network only) outside trusted
environments; both fail closed unless set explicitly to `1`. Configure the
orchestrator readiness probe to `GET /ready`, not `/health`.

`/ready` requires the accepted pinned Memongo contract and a non-mutating
tenant retrieval. To require server-local control checks, set
`MEMONGO_CONTROL_API_KEY` and list `control`, `embedding`, and/or `vector` in
`MEMONGO_READINESS_CONTROL_LANES`. Unlisted control lanes are optional and are
not probed.
