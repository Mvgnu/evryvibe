---
description: Scoped, domain-owned implementation cycles for EVRYVIBE
---

# Lop

1. Read `specs/00_overview.md` and the domain spec. Know the outcome, the files
   you own, the schemas you depend on, who consumes your output, and the
   acceptance criteria.
2. Before parallel work, give each agent disjoint write paths and agree on the
   interfaces between them. Anyone may read anything.
3. Build the smallest complete outcome a visitor or operator can use.
4. Verify it with the spec's commands and real examples.
5. Update the spec: paths, exports, consumers, known limitations.
6. For a substantial slice, run a Gauntlet review (`gauntlet.md`).

Cross-domain changes are normal. The coordinating agent makes integration and
schema changes within scope, updates the affected specs, and splits or
sequences the work. Hand over ownership before editing a file another running
agent owns.

Keep specs short enough to read before starting. Describe behaviour and
constraints, not every component. Frontmatter shape:

```yaml
name: discovery
paths:
  owned:
    - src/components/discovery/
exports:
  - EventCard
consumes:
  - core.Event
verification:
  typecheck: npm run check
bar:
  reference: A real event poster and its public ticket page
  property: A visitor can tell when, where and who, then reach tickets.
```

Use the real paths, exports and commands. Migration SQL comes from
`npm run db:generate`; review it as database behaviour and don't hand-edit it
to hide schema drift.
