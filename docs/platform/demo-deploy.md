# Deploying the live demo

This guide publishes `/demo` on a public URL: the web console on Cloudflare, the API, Memongo and the agent runner as Fly.io containers, the Atlas cluster as is (plan decision 18, ticket 17). It covers everything except the presenter lane, which is ticket 14 (placeholder below).

The deploy, the accounts and every credential stay with the human. The repo provides the build (`apps/web`), this guide, and the deployed smoke (`scripts/demo-deploy-smoke.ts`). Anonymous access stays off until the smoke passes (decision D23).

## Topology

| Service | Runs on | Built from | Reached by |
|---|---|---|---|
| Web console (`/demo`, the read proxy, the answer route, the run read) | Cloudflare Workers, through OpenNext | `apps/web` (`bun run deploy`) | The public URL |
| Mdbrain API | Fly.io container | `apps/api/Dockerfile` (port 3847, `GET /health`, `GET /ready`) | The web proxy (server-to-server); the operator |
| Memongo | Fly.io container, private network only | the Memongo image, as `docker/compose.full.yml` builds it | The API, over Fly's private network (Flycast); never a public IP |
| Agent runner (seeding and role agents) | Fly.io container, on demand | the repo (Bun), `apps/demo-agents` scripts | The operator; nothing public |
| Atlas cluster (wiki data, the `mdbrain_demo_*` databases) | As is, unchanged | — | Memongo; the web's control-database read |
| Demo control database | A MongoDB deployment the operator picks (the demo stack's control DB) | — | The web Worker, for the run read and the answer lane |

The web Worker holds no inbound traffic rule of its own: it serves the reads and the answer route, and the edge rate rule (below) sits in front of the whole app. Memongo has no public IP: its Flycast address is reachable only inside the private network. Flycast is plain HTTP through the Fly proxy (it does no HTTPS), and the private network itself runs over Fly's WireGuard mesh. Atlas is not changed by this deploy.

One point to settle before the first deploy: the web Worker reads the control database directly (the run read and the answer lane, `MDBRAIN_DEMO_CONTROL_URI`). Cloudflare Workers have no static egress addresses, so the control database's IP access list must allow connections from any address, with the database user's credentials and TLS as the control. Confirm that trade-off before publishing (open question to the operator, not settled by this ticket).

### The control-database read under Workers (measured locally)

The local workerd smoke (the OpenNext build served by `wrangler dev`, a single-node local mongod, fake upstreams and a fake model) ran the whole path on the Workers runtime: the run read (`GET /api/demo/v1/run`) answered `200` with the full run record from the control database, and the answer route ran its complete stepwise flow (a model turn, tool calls through the read seam, a second model turn, the citation marker validated through the cite read) and settled the daily budget ledger in the control store. The MongoDB driver itself (`mongodb` 7.2.0) loads and runs under the runtime, provided it is imported lazily, as the OpenNext route chunks do.

One caveat was measured, and it shapes the web's driver use: Workers cannot reuse I/O objects across requests, so connection pooling does not work in a plain Worker (Cloudflare's MongoDB page). With one process-wide client, a request that reused a pooled connection from an earlier request hung and the runtime canceled it (a 500), on every other back-to-back run read or answer under `wrangler dev`. The web therefore gives each request on Workers its own client: every demo route runs in a control scope (`withControlScope`, `apps/web/lib/demo-data/run-store.ts`) that opens the client on first use and closes it when the route's work settles, and the presenter stores ask for the current request's client at each operation. On Node (`next start`, the local stack) the one pooled process client stays. Measured locally with `wrangler dev` (tasks 346 and 350): 20 back-to-back and 10 concurrent run reads, 5 back-to-back answers and 4 presenter sign-ins all answered. Each request now pays its own TCP and TLS connection to the cluster; a Durable Object holding the client is Cloudflare's documented way to keep one across requests, if that latency matters. A deployed Worker was not measured.

## Environment variables per service

Names and meanings only: this guide never carries values, and no value belongs in the repo. Each service takes its variables from its host's secret store.

### Web (Cloudflare Worker)

Plain `[vars]` in `apps/web/wrangler.jsonc` (routing config, not secret):

| Variable | Meaning |
|---|---|
| `MDBRAIN_DEMO_API_BASE_URL` | The Fly API origin the proxy reads from |
| `MDBRAIN_DEMO_SCOPE` | The scope, `workspace` |
| `MDBRAIN_DEMO_SCOPE_REF` | The pinned run's scope reference, `demo-run-<slot>` |
| `MDBRAIN_DEMO_AGENT_ID` | The agent the run's events were written under |
| `MDBRAIN_DEMO_RUN_ID` | The pinned run's id: the `_id` of its stored record |

Secrets, set with `wrangler secret put` (run in `apps/web`):

| Variable | Meaning |
|---|---|
| `MDBRAIN_DEMO_READ_KEY` | The dedicated read-only key (below); never the admin key |
| `MDBRAIN_DEMO_CONTROL_URI` | The demo control database's connection string |
| `ANTHROPIC_API_KEY` | The answer service's model key; without it the answer route answers `503` |
| `MDBRAIN_DEMO_ANSWER_TOKENS` | The answer lane's global daily token ceiling. Unset or `0` keeps the lane off |

Their behavior is `docs/platform/demo.md`'s table; nothing here changes it.

### API (Fly.io)

Set with `fly secrets set`:

| Variable | Meaning |
|---|---|
| `MDBRAIN_API_KEY` | The admin key the API boots with (production refuses unauthenticated `/v1`) |
| `MDBRAIN_WIKI_MONGODB_URI` | The Atlas cluster's connection string. Without it the API still listens, but `/ready` answers 503 and every wiki route fails |
| `MDBRAIN_WIKI_DATABASE` | `mdbrain_demo_wiki`. Required: left unset, the wiki engine uses `mdbrain_wiki`, a new database on the cluster |
| `MEMONGO_API_URL` | Memongo's Flycast address, `http://<memongo-app>.flycast:<port>`, never a public URL |
| `MEMONGO_API_KEY` | The key the API uses against Memongo |
| `MEMONGO_ALLOW_INSECURE_HTTP` | `1`. Flycast is plain HTTP, and the API refuses a non-loopback `http:` Memongo URL without this opt-in for an isolated private network (`docs/platform/self-host.md`, transport note). The key then travels unencrypted by TLS, inside Fly's private network only |
| `MDBRAIN_API_SCOPED_KEYS` | The scoped-key policies, including the demo reader policy (below) |
| `MDBRAIN_API_HOST` | `0.0.0.0` so other containers reach it |

Optional second line: `MDBRAIN_API_RATE_LIMIT_MAX` / `MDBRAIN_API_RATE_LIMIT_WINDOW_MS` (per-IP, in-memory, single instance). The edge rule is the anonymous control (D28); this one stays a backstop.

### Memongo (Fly.io)

Set with `fly secrets set`:

| Variable | Meaning |
|---|---|
| `MEMONGO_API_HOST` | `0.0.0.0` |
| `MEMONGO_FORCE_MONGODB_URI` | The Atlas cluster's connection string. The force form wins over any URI in a Memongo config file, as the demo stack sets it |
| `MEMONGO_MONGODB_DATABASE` | `mdbrain_demo_memory`. Required: left unset, and with no Memongo config file naming one, Memongo uses `memongo`, a new database on the cluster |
| `MEMONGO_API_KEY` | The key the API presents |
| `VOYAGE_API_KEY` | The Atlas Model API key Memongo's reranker and embedding checks call. Its usage bills to the Atlas account that issued it |

The two database names are the only ones the demo may use. The local demo stack hard-codes them (`scripts/demo-stack-config.ts`), but nothing checks the Fly secrets, so check both names by hand before the first `fly deploy`: a wrong or missing name writes to a database outside the demo.

### Agent runner (Fly.io, on demand)

The runner is a repo checkout on the machine, driven by the `apps/demo-agents` scripts (`seed:run`, `agents:run`) with the demo stack's variables from `scripts/demo-stack-config.ts`, pointed at the Fly API's origin. It is started for a seeding run and stopped after; it serves nothing public. Its key material (`MDBRAIN_DEMO_READ_KEYS`, `MDBRAIN_DEMO_AGENT_KEYS`) lives in the operator's secrets file on that machine, never in the repo.

## The dedicated read-only key (D23(1))

One key, created before the first deploy, by the human:

1. Generate a random token (for example `openssl rand -hex 32`). It is the value of nothing else and is never committed.
2. Compose its scoped-key policy in the `MDBRAIN_API_SCOPED_KEYS` object form, as `buildDemoReadScopedKeys` (`scripts/demo-stack-config.ts`) builds it: `capabilities: ["read"]`, exactly one grant `{scope: "workspace", scopeRef: "demo-run-<slot>"}`, no agentId pin.
3. Add that policy to the API's `MDBRAIN_API_SCOPED_KEYS` secret (`fly secrets set` re-deploys the API).
4. Set the same token as `MDBRAIN_DEMO_READ_KEY` on the Worker (`wrangler secret put`).

Never the admin `MDBRAIN_API_KEY`, never a slot or proposer key. The proxy checks the key before it serves any read (`GET /v1/principal/self`: capabilities exactly `read`, one grant, the pinned scope) and refuses anything wider; the smoke proves it.

## Deploy steps, in order

The operator's runbook. Each step is a human action; nothing below runs itself.

1. **Atlas, as is.** The `mdbrain_demo_*` databases exist with the seeded run (decision D3). Note the control-database access-list point above.
2. **Fly apps.** Create three apps: the API, Memongo, the agent runner. Give Memongo no public IP: `fly ips allocate-v6 --private` (a Flycast address). Machines bind `0.0.0.0`; the Fly proxy forwards Flycast traffic to them as plain HTTP, so Memongo's service is defined without HTTPS and without `force_https`. Check `fly ips list` shows no public address.
3. **Memongo first.** `fly deploy` the Memongo image with its five variables. The API cannot boot healthy without it.
4. **The API.** `fly deploy` from the repo root with `apps/api/Dockerfile`; set the API secrets (table above) with `MEMONGO_API_URL` pointing at Memongo's `.flycast` address (an `.internal` address skips the Fly proxy and needs the process to listen on IPv6) and `MEMONGO_ALLOW_INSECURE_HTTP=1`; without it `/ready` fails with "Memongo requires HTTPS". Check `fly status` and the health check (`/health`, `/ready`).
5. **The read key.** Create it as its section above: policy into `MDBRAIN_API_SCOPED_KEYS`, token into the Worker's `MDBRAIN_DEMO_READ_KEY`.
6. **The web.** In `apps/web`, set the `[vars]`, then `wrangler secret put` the four secrets, then `bun run deploy` (OpenNext build and deploy; the build must exit 0). The route is not public until the smoke passes.
7. **The edge rate rules (D28).** In Cloudflare, in front of the whole web app, two rate-limiting rules, both keyed on the client IP (`ip.src`), both with the Block action (Block answers `429`):
   - `starts_with(http.request.uri.path, "/api/demo/v1/")` — 120 requests per minute per IP.
   - `starts_with(http.request.uri.path, "/api/demo/answers")` — 10 requests per minute per IP.
   Use a 60-second counting period. Counters are per-datacenter with seconds of lag, so a few excess requests can pass before the first `429`; the smoke tolerates that. Check the account's plan first: the Free plan allows one rule with a fixed 10-second period, which cannot express D28's two limits; if the account cannot hold both rules, stop and raise it with the lead rather than approximating.
8. **The smoke.** From a repo checkout:

   ```sh
   bun scripts/demo-deploy-smoke.ts \
     --web https://<the web origin> \
     --api https://<the API origin> \
     --scope-ref demo-run-<slot> \
     --key <the read key>        # or: export DEMO_DEPLOY_READ_KEY=...
   ```

   `--v1-limit` and `--answers-limit` default to D28's 120 and 10; `--skip-rate` drops the two rate probes for a quick pass. Exit `0` is the gate: it proves the key reads the pinned scope and is refused on a write and on another scope, the public refusals answer the fixed envelope, the key is exactly a reader (and never echoed), the edge answers `429` past both limits, and the answer route refuses non-JSON and cross-site posts and reports the lane off. The key is sent only to the API origin and never printed. Its checks are pinned by tests that use fakes and no network.
9. **The answer lane, after the smoke.** The lane is off while `MDBRAIN_DEMO_ANSWER_TOKENS` is unset. To turn it on, `wrangler secret put MDBRAIN_DEMO_ANSWER_TOKENS` with a positive ceiling (the operator's choice; 500,000 counted tokens a day is the local default, D24). After it is on, the smoke's lane probe honestly reports the lane live instead of off — that check is for the pre-enable state; the 415 and 403 guards still pass.

## Rollback

- **Web:** `wrangler rollback` (previous deployment), or delete the Worker. Secrets: `wrangler secret delete` per name.
- **Answer lane, off in one step:** unset `MDBRAIN_DEMO_ANSWER_TOKENS` (or set it to `0`). Reads and every other chapter keep working; that is the lane's kill switch.
- **API:** `fly deploy` the previous image, or `fly secrets unset` the reader policy's variable to re-cut the key. Removing the reader policy from `MDBRAIN_API_SCOPED_KEYS` makes the proxy refuse every read (it checks the key first), which is a safe partial state.
- **Memongo:** `fly machine stop` — the proxy then answers `502 UPSTREAM_UNREACHABLE` and the page shows its error states; nothing leaks.
- **Edge rules:** delete or disable the two D28 rules. Anonymous reads then rely on the API's own limiter only, so treat a missing edge rule as a degraded state, not a steady one.

## Presenter lane (ticket 14)

> **Placeholder — ticket 14.** The presenter container, its env-var list and its key handling are ticket 14's to write. This guide deliberately says nothing about them.

## Code

The smoke is `scripts/demo-deploy-smoke.ts` (checks and CLI) with `scripts/demo-deploy-smoke.test.ts` (fakes, no network). The web deploy scripts are in `apps/web/package.json` (`preview` for a local workerd run, `deploy` for the publish). The scoped-key builders are `scripts/demo-stack-config.ts`.
