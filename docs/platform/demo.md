# Live demo

Open `/demo` on the running web app. It walks nine chapters on a synthetic company, Northstar Systems (fictional): the brain as a map, a read-only question, where sources come from, agents at work, a caught contradiction, governed growth, what changed, the reads under the hood, and the pinned run. A "Synthetic company" label stays on screen in every chapter.

Every number and every citation on the page is read from a stored brain through a read-only proxy at `/api/demo/v1`. The page ships no scenario data. A citation opens the stored claim, its evidence and the stored source text, read through `cite`.

A stored source is shown as markdown, drawn as the page's own elements: no HTML in a source reaches the page. Memongo stores an event as a message, so its text opens with a role label such as `User: `; the page shows that apart, as the role the source was stored under, and the text after it as the source. A long source shows the part the claim rests on, highlighted, and the full text behind "Show full source". A claim stored with no evidence says so plainly ("No stored source"), in its chapter and in its citation; a claim that rests only on evidence that is not a source event says that instead. Neither is a loading or a not-yet state.

Chapter 5 is a walk-through of three beats: the first claim, the second claim, and what mdbrain recorded. Buttons, the left and right arrow keys (with focus on a step button) and a tap step it; nothing advances by itself, and a beat eases in only when the person has not asked for reduced motion. On a wide screen the claims stay side by side as the stamp arrives; on a phone each beat is one screen.

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
| `MDBRAIN_DEMO_AGENT_ID` | The agent the pinned run's events were written under, `demo-run-<slot>` for a seeded slot |
| `MDBRAIN_DEMO_SCOPE` | The scope, default `workspace` |

Without the first four the route answers `503 PROXY_NOT_CONFIGURED`. Both identifiers must match `[A-Za-z0-9_-]{1,128}`.

An event citation confirms its source through recall, which searches as the request's agent and falls back to `main` when none is sent. Every demo event lives under the run's own agent, so without `MDBRAIN_DEMO_AGENT_ID` no event citation resolves (`404 CITATION_UNRESOLVED`). The proxy sends the agent on the `cite` read only: no other read uses it, so sending it elsewhere would only widen what the key's grant must allow. A caller-set `agentId` is still refused.

Errors have one public shape, `{"error": {"code", "message", "retryAfterMs"?}}`, built by the proxy. When the upstream fails or cannot be reached, no transport message, no upstream message text and no other upstream field reaches the browser: they can name hosts, paths, scopes and stored page titles. Six upstream codes keep their code and get a fixed message (`WIKI_NOT_FOUND` 404, `CITATION_NOT_FOUND` 404, `CITATION_UNRESOLVED` 404, `CITATION_RECALL_DEGRADED` 503 with a bounded `retryAfterMs`, `SEARCH_UNAVAILABLE` 503, `RATE_LIMITED` 429). Anything else becomes `502 UPSTREAM_ERROR`, and an unreachable upstream, or one whose answer fails while its body is read, `502 UPSTREAM_UNREACHABLE`, each with a fixed message. The page reads the code for one thing: a source that recall cannot confirm (`CITATION_UNRESOLVED`, `CITATION_NOT_FOUND`) is said to be unconfirmed, apart from one that could not be read. It does not retry on `retryAfterMs`; a source that could not be read is asked for again the next time it is opened. Successful reads pass through unchanged, with the read key redacted.

Code: the allowlist, the env and `handleDemoRead` are in `apps/web/lib/demo-data/proxy.ts`; the route table, parameter specs and slug checks are in `proxy-routes.ts`; the error envelope is `proxy-errors.ts`.

## Tests

`bun run test:e2e` runs the journey (`e2e/demo.e2e.ts`) and the value, state, quality and walk-through checks (`e2e/demo-values.e2e.ts`, `e2e/demo-states.e2e.ts`, `e2e/demo-checks.e2e.ts`, `e2e/demo-stepper.e2e.ts`) on the desktop and mobile projects. By default the page reads a fixture upstream built from the committed Northstar corpus (`e2e/demo-upstream.ts`) and served through the real proxy handler, so the allowlist, the server-set principal and the read key are exercised. The fixture carries the shapes a live stack has (Memongo UUID event ids, a role label on event text, a changes feed of several pages, an event cite that needs the run's agent), a run with no contradiction yet (`contradiction: "none"`), and a contradiction whose second claim is stored with no evidence (`"unsourced"`); it is not a recording of a live stack. To run the same specs against a live stack, start the web app with the `MDBRAIN_DEMO_*` variables set and run with `DEMO_E2E_LIVE=1`; the comparisons of on-screen values with the proxy's responses then read the live responses, while the tests that force states (outage, empty run, a source without business time) are skipped. A live test is allowed 180 s instead of 30 s, because each source is a recall of several seconds, and a list of sources (chapter 3, a citation) is waited on for up to 90 s because it is read four at a time. Live, recall can refuse a cite: a source it cannot confirm shows as an unavailable slip that says recall could not confirm it, and a busy recall says it could not be read right now. A source the proxy refused is held to that, and the browser's one "Failed to load resource" console line for it is accounted for by the refused read; any other console or page error still fails the journey, and the fixture refusing a read fails it too. Chapter 5 branches on the proxy's own lint answer: a run before its agent run must show the honest "not recorded in this run yet" state, and a run with a contradiction must show the walk-through, each claim holding to its evidence count.

`e2e/demo-record.e2e.ts` records the reads `/demo` makes into a JSON file with no key, origin or principal in it (`DEMO_RECORD_TO=<file>`, run through the recorder script a maintainer owns), and `DEMO_REPLAY=<file>` serves that file in place of the generated fixture.

Two specs run only on demand: `e2e/demo-perf.e2e.ts` (`DEMO_PERF=1` and `--workers=1`, ready time on the throttled phone profile against a production server, with the proxy reads modelled on the link: a round trip each, then the gzipped body on a shared 9 Mbit/s downlink) and `e2e/demo-shots.e2e.ts` (`DEMO_SHOTS_DIR=<dir>`, a screenshot of every chapter on both projects).
