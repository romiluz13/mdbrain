# Self-hosting

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
`MEMONGO_ALLOW_INSECURE_LOCAL` outside local development. Configure the
orchestrator readiness probe to `GET /ready`, not `/health`.

`/ready` requires the accepted pinned Memongo contract and a non-mutating
tenant retrieval. To require server-local control checks, set
`MEMONGO_CONTROL_API_KEY` and list `control`, `embedding`, and/or `vector` in
`MEMONGO_READINESS_CONTROL_LANES`. Unlisted control lanes are optional and are
not probed.
