# MDBrain Launch Strategy: How to Publish + Crush OpenWiki

**Date:** 2026-07-12
**Goal:** Publish MDBrain to npm + GitHub, get 5x more stars than OpenWiki (~53k stars target)

## OpenWiki Current State (the target to beat)

| Metric | OpenWiki | Source |
| --- | --- | --- |
| GitHub stars | ~10.6k | [github.com/langchain-ai/openwiki](https://github.com/langchain-ai/openwiki) |
| npm downloads | ~15k total, 12k weekly | [youmind.com](https://youmind.com/de-DE/landing/x-viral-articles/openwiki-automated-repo-documentation-agent) |
| Launched | Late June 2026 | Same |
| Growth rate | +400% daily in first week | Same |
| Backing | LangChain (established company) | Same |

**5x target: ~53,000 GitHub stars.** This is ambitious but achievable if MDBrain launches
with a superior product + viral README + coordinated launch.

## What MDBrain Has That OpenWiki Doesn't (the differentiator story)

| Feature | OpenWiki | MDBrain | Why it matters |
| --- | --- | --- | --- |
| Storage | File-system markdown | MongoDB Atlas | Searchable at scale, no file proliferation |
| Hybrid search | "Exploring" | ✅ $vectorSearch + $search + $rankFusion | Agents find context faster |
| Auto-embeddings | None | ✅ Voyage AI via Atlas | Zero-config vector search |
| Governance | ❌ | ✅ Scope + trust tiers + permissions | Enterprise-ready |
| Contradiction detection | ❌ | ✅ Cross-page, before dedup | Self-correcting knowledge |
| MCP tools | "Exploring" | ✅ 5 tools shipped | Agent-native access |
| OKF interchange | In progress | ✅ Import + export | Interoperable with Google's format |
| Connectors | 6 (Gmail, Notion, etc.) | 6 (Obsidian, GitHub, Confluence, Notion, Slack, CRM) | Enterprise sources |
| Web console | ❌ (CLI only) | ✅ Next.js | Human-browsable |
| LLM maintenance | ✅ Scheduled runs | ✅ Grove/Anthropic wired | Real LLM regeneration |

**The pitch:** "OpenWiki is a markdown wiki. MDBrain is a MongoDB-native wiki brain with
hybrid search, governance, and contradiction detection — and it's already wired to real LLMs."

## Pre-Publish Checklist (what to fix before going public)

### 1. Add `files` field to wiki-engine package.json (CRITICAL)

```
⚠️ @mdbrain/wiki-engine — NO files field, private=false
```

Without `files`, `npm publish` will publish EVERYTHING including `src/`, `test/`,
`node_modules/`, `.turbo/`, etc. Every other package has `files: ['dist', 'README.md']`.
**Fix:** Add `"files": ["dist", "README.md"]` to `packages/wiki-engine/package.json`.

### 2. Add `.loop-plan.md` to .gitignore

`.loop-plan.md` is a scratch file from the loop engine — it shouldn't be in the repo.
Add `.loop-*` to `.gitignore`.

### 3. Add `private: true` to apps that shouldn't be published

```
@mdbrain/api — NO files field (private=True ✅)
@mdbrain/docs — NO files field (private=True ✅)
@mdbrain/mcp — NO files field (private=True ✅)
@mdbrain/web — NO files field (private=True ✅)
```

These are fine — they're private. But they lack a `files` field, so if someone
accidentally removes `private: true`, they'd publish everything. **Recommend:** add
`"files": ["dist"]` to all private packages as a safety net.

### 4. Clean up tracked research artifacts

`docs/research/llm-wiki/` contains research artifacts with `.out` files (raw tool
output). These are useful for provenance but look unprofessional. **Recommend:** move
to `docs/research/llm-wiki/raw/` or remove `.out` files.

### 5. Verify no hardcoded secrets

✅ No `sk-`, `pa-`, `al-`, or long password strings found in tracked files.
✅ `.env.example` is tracked (good — shows required env vars without secrets).
✅ `.gitignore` covers `.env`, `.env.*`, `*.env`, `dist/`, `.turbo/`, `node_modules/`.

### 6. README improvements (based on research)

The current README is good but missing 3 things that the research says are critical:

#### a. Demo GIF / video (the "3-second rule")
>
> "Repositories with comprehensive READMEs reportedly receive up to 4x more stars"
> — [rivereditor.com](https://rivereditor.com/blogs/write-perfect-readme-github-repo)

**Action:** Create a 5-10 second looping GIF showing:

1. `curl` creates a wiki page
2. Search returns ranked results
3. Web console shows the page

#### b. Star hook + social proof
>
> "Effective tactics include explicit 'star hooks', a contributors' Hall of Fame"
> — [dev.to](https://dev.to/belal_zahran/the-github-readme-template-that-gets-stars-used-by-top-repos-4hi7)

**Action:** Add a "⭐ If MDBrain helps you, give it a star!" banner after the hero.

#### c. AI-ready metadata (2026 SEO for agents)
>
> "Including CLAUDE.md or AGENTS.md files is described as the 'SEO for 2026' for
> letting agents recommend your project"
> — [cxl.com](https://cxl.com/blog/github-for-marketing-ai-workflows/)

**Action:** MDBrain already has `AGENTS.md` ✅. Add an `llms.txt` file that points
agents to the README + key docs.

## Launch Strategy (from Reddit + HN research)

### Phase 1: Pre-launch (before posting anywhere)

1. **Fix the 6 items above** (files field, .gitignore, README improvements)
2. **npm publish** the 7 public packages (`@mdbrain/{wiki-engine,client,lib,memory,memory-bridge,memory-engine,tools}`)
3. **Get 10-20 initial stars** from friends/colleagues (don't launch at zero)
4. **Create a demo GIF** (5-10 seconds, looping, showing the killer feature)
5. **Write a blog post** (not in the repo — on Medium/dev.to/your blog)

### Phase 2: Hacker News launch

> "The title should be descriptive, not salesy: 'Show HN: MDBrain — MongoDB-native
> LLM wiki with hybrid search, governance, and contradiction detection'"
> — [flowjam.com](https://www.flowjam.com/blog/how-to-get-on-the-front-page-of-hacker-news-in-2025-the-complete-up-to-date-playbook)

> "Optimal posting time is Tuesday-Thursday, 7-9 AM EST"
> — Same source

**Title:** `Show HN: MDBrain – MongoDB-native LLM wiki brain (hybrid search + governance + auto-embeddings)`

**First comment:** Explain the technical struggle (mock tests missed 3 critical bugs
that only real MongoDB + Voyage surfaced), the arXiv pipeline-ordering fix, and the
OpenWiki comparison. Ask for feedback.

### Phase 3: Reddit launch

> "Tone should be enthusiastic and relatable. Video/GIF posts often outperform
> direct links."
> — [reddit.com](https://www.reddit.com/r/SaaS/comments/1kifs12/)

**Subreddits:** `r/programming`, `r/MongoDB`, `r/LocalLLaMA`, `r/selfhosted`,
`r/ChatGPTCoding`, `r/ClaudeAI`

**Format:** GIF post (not link post) → link in comments.

### Phase 4: Sustaining momentum

> "GitHub's Trending algorithm rewards star velocity. Use minor updates as
> mini-marketing events."
> — [repoclip.io](https://repoclip.io/blog/how-to-get-more-stars-on-github)

- Release v1.1 with write-back connectors (already scoped)
- Add a "MDBrain vs OpenWiki" benchmark blog post
- Create an awesome-list PR
- Enable GitHub Sponsors

## The README Template (based on best practices)

```markdown
# MDBrain

> MongoDB-native LLM wiki brain — self-maintaining company knowledge for AI agents.

[![npm version](badge)](npm)
[![GitHub stars](badge)](stars)
[![License: MIT](badge)](license)

## 🎬 Demo

[5-second looping GIF: create page → search → see results with scores]

## ⭐ If MDBrain helps you, give it a star!

[star banner]

## Why MDBrain?

[3-sentence pitch: MongoDB not files, hybrid search, governance + contradictions]

## Quickstart

[3 commands: clone → docker → bun run dev]

## Comparison

[the comparison table from COMPARISON.md]

## Features

[bullet list with ✅/❌ vs OpenWiki]
```

## Contradictions in the research

1. **Emoji usage:** Some sources say use emojis functionally (✅ for success), others
   say HN users prefer text-first READMEs without "walls of badges."
   **Resolution:** Use emojis sparingly (✅/❌ in comparison tables only), no emoji
   in the title or first paragraph.

2. **Star velocity vs organic growth:** Some sources say "don't launch at zero stars,"
   others say "organic growth is more sustainable."
   **Resolution:** Get 10-20 organic stars first, then launch on HN/Reddit for velocity.

3. **GitHub restricted stargazer data (June 2026):** Can't track competitor stars via
   third-party tools anymore.
   **Impact:** Can't verify OpenWiki's exact star count in real-time. Use manual checks.

## Sources

- [rivereditor.com — Perfect GitHub README](https://rivereditor.com/blogs/write-perfect-readme-github-repo)
- [dev.to — README template that gets stars](https://dev.to/belal_zahran/the-github-readme-template-that-gets-stars-used-by-top-repos-4hi7)
- [cxl.com — GitHub for marketing AI workflows](https://cxl.com/blog/github-for-marketing-ai-workflows/)
- [flowjam.com — How to get on HN front page](https://www.flowjam.com/blog/how-to-get-on-the-front-page-of-hacker-news-in-2025-the-complete-up-to-date-playbook)
- [repoclip.io — How to get more GitHub stars](https://repoclip.io/blog/how-to-get-more-stars-on-github)
- [jsmanifest.com — Create modern npm package 2026](https://jsmanifest.com/create-modern-npm-package-2026)
- [github.com/langchain-ai/openwiki](https://github.com/langchain-ai/openwiki)
- [youmind.com — OpenWiki viral article](https://youmind.com/de-DE/landing/x-viral-articles/openwiki-automated-repo-documentation-agent)
- [reddit.com — SaaS launch strategy](https://www.reddit.com/r/SaaS/comments/1kifs12/)
- [matiassingers/awesome-readme](https://github.com/matiassingers/awesome-readme)
