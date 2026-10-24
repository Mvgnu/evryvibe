---
description: Independent review of a working EVRYVIBE product slice
---

# Gauntlet

Passing tests show the checked behaviour works. They don't show that a visitor
finds a useful event or that an agent can finish queue work safely.

For a substantial slice, give a separate agent (fresh context, medium
reasoning) the goal, the acceptance bar, the spec and the working artifact.
The reviewer reads the code or drives the running app. The builder's report is
context, not evidence.

Pick the question that fits the slice:

| Slice      | Question                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| Discovery  | Can a visitor find a relevant date and city and understand the event without signing up?                    |
| Event page | Does it keep the essentials of the source poster and reach the real ticket and source links?                |
| DJ sample  | Can the visitor open or play the linked post, with a working fallback when Instagram is blocked?            |
| Queue/MCP  | Can two workers process packages without losing work, duplicating entities or accepting a stale completion? |

The reviewer reports the largest real gap with evidence and a concrete next
check, and flags any other critical correctness or security problem straight
away. The builder fixes it and the affected behaviour is rechecked. Stop when
the outcome holds or the remaining limitation is written down. Don't loop on
taste.

Match effort to risk: a copy change needs a read, a queue state change needs
behavioural evidence, a new discovery flow needs the real UI at mobile and
desktop widths.

Be precise about what a check proves. A screenshot doesn't verify navigation,
an in-memory test doesn't verify Postgres locking, and an embed link doesn't
prove playback. Check the available tools before calling a capability
unavailable. This review is a development practice, not a gate on runtime
ingestion.
