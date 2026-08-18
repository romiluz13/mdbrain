# Domain docs

This repository uses a multi-context domain-document layout.

## Before exploring

1. Read `CONTEXT-MAP.md` when it exists.
2. Follow it to the `CONTEXT.md` files relevant to the work.
3. Read applicable system-wide and context-specific ADRs.
4. If these files do not exist yet, proceed silently. Domain-modeling
   workflows create them lazily as decisions are resolved.

## Layout

```text
/
├── CONTEXT-MAP.md
├── docs/adr/
├── apps/<context>/CONTEXT.md
└── packages/<context>/CONTEXT.md
```

The context map should point to focused contexts such as the Memongo HTTP
gateway, wiki engine, delivery runtime, and public surfaces. Context-specific
ADRs live beside their context; decisions spanning multiple contexts live
under `docs/adr/`.

## Vocabulary and decisions

- Use terms exactly as defined by the relevant context glossary.
- Do not introduce synonyms for established domain concepts.
- Surface conflicts with an ADR explicitly rather than silently overriding it.
