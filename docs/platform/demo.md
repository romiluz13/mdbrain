# Live demo

Open `/demo` on the running web app. It walks nine chapters on a synthetic company, Northstar Systems (fictional): the brain as a map, a read-only question, where sources come from, agents at work, a caught contradiction, governed growth, what changed, the reads under the hood, and the pinned run. A "Synthetic company" label stays on screen in every chapter.

Every number and every citation on the page is read from a stored brain through a read-only proxy at `/api/demo/v1`. The page ships no scenario data. A citation opens the stored claim, its evidence and the full stored source text, read through `cite`.

## Time

Two clocks are shown apart and always named. **Ingestion time** is when mdbrain stored something (a page's creation and update times, a revision, the moment a contradiction was detected). **Business time** is when a source says something happened (the event's own timestamp, read through `cite`). When a source carries no business time, the page says "missing in this source" rather than showing the ingestion time in its place.

## States

Each chapter shows loading, empty, error and incomplete-run states. Two chapters are "not yet in this run" today and are shown as such, never as errors: the run's source list (the read API has no run manifest route) and agent activity (no stored read carries it). The governed-growth chapter states that the review queue is private by design: a proposed page is invisible to every wiki read until a reviewer approves it.

## The proxy

The proxy forwards one fixed list of reads and refuses everything else (other methods, writes, admin routes, and any caller-set `scope`, `scopeRef`, `agentId` or `containerTag`). The question read is the only upstream `POST`; the caller still sends a `GET` with a bounded `query` and the proxy builds the whole upstream body (text lane, no model). Configure it with server environment variables, none of which reaches the browser:

| Variable | Meaning |
|---|---|
| `MDBRAIN_DEMO_API_BASE_URL` | The Mdbrain API to read from |
| `MDBRAIN_DEMO_READ_KEY` | A read-capable key the proxy sends upstream |
| `MDBRAIN_DEMO_SCOPE_REF` | The pinned run's scope reference |
| `MDBRAIN_DEMO_SCOPE` | The scope, default `workspace` |

Without the first three the route answers `503 PROXY_NOT_CONFIGURED`.

## Tests

`bun run test:e2e` runs `e2e/demo.e2e.ts` and `e2e/demo-checks.e2e.ts` on the desktop and mobile projects. By default the page reads a fixture upstream built from the committed Northstar corpus (`e2e/demo-upstream.ts`) and served through the real proxy handler, so the allowlist, the server-set principal and the read key are exercised. The fixture is not a recording of a live stack. To run the same specs against a live stack, start the web app with the `MDBRAIN_DEMO_*` variables set and run with `DEMO_E2E_LIVE=1`; the comparisons of on-screen values with the proxy's responses then read the live responses, while the tests that force states (outage, empty run, a source without business time) are skipped.

Two specs run only on demand: `e2e/demo-perf.e2e.ts` (`DEMO_PERF=1`, ready time on the throttled phone profile, against a production server) and `e2e/demo-shots.e2e.ts` (`DEMO_SHOTS_DIR=<dir>`, a screenshot of every chapter on both projects).
