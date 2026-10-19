# Memory workspace

Open `/workspace` on the running web app. It uses the configured Mdbrain HTTP API and the existing scoped read/write capabilities. Follow the repository [quickstart](../../README.md#quickstart) to start the stack.

Enter the API base URL, API key, agent ID, scope, and scope reference. Remote servers must use `https://`; plain `http://` is accepted only for `localhost`, `127.0.0.1`, and `[::1]`, so the key and content are never sent over the network unencrypted. These identify the data and access rights for every request. The key stays in the tab's memory; reloading clears it. Changing the connection clears displayed records and drafts and cancels requests from the previous connection. “Configured for” identifies the selected API, rather than claiming the API is healthy or the key is valid. Request failures appear where they happen.

## Knowledge pages

Create a page, then inspect the stored content and its revision, scope, timestamps, and available provenance. A non-admin key must create pages at its own trust tier. Slugs are unique within a scope; a duplicate create reports a conflict and keeps the draft.

Edit the revision you inspected. A concurrent change produces a revision conflict and keeps your draft. “Show the latest revision” reads the current record. Explicitly choosing to keep your edits against that revision preserves your edited fields and adopts the latest values for fields you left untouched. A second concurrent change can conflict again. Ordinary editing sends title, summary, and body changes, without changing permissions or trust tier.

History first lists revision summaries. Selecting one fetches its actual stored snapshot and editor metadata. Visibility follows the API's authorization for each revision. The page list shows up to 50 accessible pages and reports the total returned by the API. History also requests up to 50 summaries.

## Conversation memory

Capture an event with a session ID. The receipt shows the actual event ID and whether Memongo created a chunk. It confirms an accepted event, without claiming that structured facts were extracted. An identical unconfirmed retry reuses its idempotency key; changing the event or session starts a new write.

Recall a session to inspect cited event previews and source identifiers. Search returns Memongo's evidence, trust fields, retrieval report, and any reported rejections or throttling. Optional **Search session ID** limits this evidence search to that session. Without it, retrieval can return related evidence from other sessions in the connected scope. Scores are reported engine values, rather than comparable quality ratings across different requests.

**Build context bundle** is a separate request over the connected scope and query; the search-session filter does not constrain it. It shows the actual rendered context and returned sections, including reported partial or truncated state. An API outage remains distinct from a successful request with zero results.

Knowledge pages and conversation memory are separate stores. Saving a page does not add an event to Memongo. Capturing an event does not create a wiki page. Search availability immediately after capture depends on the backing retrieval system; recall and search may show different available evidence.

## Inspecting storage

Essential fields remain beside the content. Open **All fields** to inspect other returned values and the names of fields the API did not report. Raw JSON disclosures preserve the complete API payload. Stored content is rendered as text, without executing HTML.

The workspace uses `@mdbrain/client`: `wikiList`, `wikiCreate`, typed `wikiGet`, `wikiUpdate` with an explicit `expectedRevision`, `wikiRevisions`, and `wikiRevision`. It deliberately uses caller-observed revisions rather than the `wikiApply` create-or-update convenience method. Conversation actions use `add`, `recallConversation`, `searchDetailed`, and `buildContextBundle`.

`/console` remains the raw API inspector. `/demo` remains a labelled synthetic simulation. This workspace contains no default synthetic memory records.
