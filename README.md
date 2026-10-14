# handoff

Compaction-proof session handoffs for [Claude Code](https://claude.com/claude-code).

Long sessions compact, and every compaction re-summarises the summary before it. Facts learned early (what was ruled out, what the user decided, what live state was changed) erode a little each time. By the time you clear the session and resume, the resuming agent inherits a paraphrase of a paraphrase.

This plugin moves those facts to disk **the moment they are learned**, so they never enter the re-compression chain:

- **During work**, the agent appends one tagged line to a per-work-stream ledger whenever a trigger fires.
- **`/handoff`** consolidates the ledger into a nine-slot block by lookup, not paraphrase, and prints the path.
- **`/pickup <path>`**, in a fresh session, verifies the anchors against reality, runs the smoke check, and **refuses every mutation** until the resuming agent writes a synthesis proving it re-checked a fact itself.

## Install

```
/plugin marketplace add hbinhng/handoff
/plugin install handoff@handoff
```

Then add the handoff directory to each project's `.gitignore`. Handoffs are local working state:

```
docs/handoffs/
```

Requires Node.js 20+ on `PATH` (for the transcript extractor and the Stop hook).

## The ledger

Handoffs live at `docs/handoffs/<slug>.md`, where the slug is derived mechanically from the work-stream name, so two agents land on the same file. Five triggers, one line each, appended immediately:

| Tag        | Append the moment                                              |
| ---------- | -------------------------------------------------------------- |
| `VERIFIED` | a fact is confirmed by tool output and cost real time to find  |
| `KILLED`   | a hypothesis is refuted, or an approach is tried and abandoned |
| `SETTLED`  | the user makes a decision                                      |
| `MUTATED`  | external state is changed                                      |
| `IF`       | a conditional rule is learned: if X then do Y                  |

```
2026-09-05 15:01  KILLED    readyAt-cursor - misses rows; reverted in 0fb0d5164
```

## `/handoff`

Routes each pending ledger line verbatim into its slot (Anchors, Settled, Ruled out & traps, Verified, Assumed, Contingencies, Live state, Open actions, Synthesis log), carries the previous block forward, and appends a watermark. Nothing is reworded or dropped.

It also guards against a skipped ledger. It reads the session transcript under `~/.claude/projects/`, and if the session has **compacted** and the ledger is thin (`entries < max(2, turns / 40)`), it refuses and points at the bundled extractor so the missing entries can be reconstructed from the transcript. On an uncompacted session it only warns.

## `/pickup <path>`

1. Reads only the newest consolidated block, never the archive.
2. Checks the pinned `branch:` anchor. On a mismatch, it switches into (or creates) the worktree that has that branch.
3. Runs the pinned `smoke:` command, and stops if it fails.
4. Proposes the next move, computed fresh rather than inherited from the degraded session that wrote the handoff.
5. **Synthesis gate**: no file edits, commits or state changes until a four-part synthesis (status / owns / contingency / re-ran) is appended. One "re-ran" fact from the Verified slot must actually be re-executed.

Older free-form handoffs without the schema are accepted in legacy mode.

## Stop hook

`hooks/ledger-nudge.mjs` runs on every Stop. When the session's handoff ledger has fallen behind (the same thin predicate as `/handoff`, counted since the last consolidation), it injects a one-line reminder to the model. It is silent in every other case and always exits 0.

## Development

```
npm test
claude plugin validate .
```

## License

MIT
