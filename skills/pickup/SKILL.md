---
name: pickup
description: 'Resume a work-stream from a handoff file. Reads the newest consolidated block, verifies anchors against reality, runs the smoke check, and refuses every mutation until a synthesis block is written. Triggers: "pickup", "/pickup", a bare path to a file under docs/handoffs/.'
---

# Pickup Skill

Resume a work-stream from a handoff path the user pastes into a fresh session. The handoff declares state; this skill determines the next move and refuses to mutate anything until the resuming session has written a synthesis entry. A document can ask; only a skill can refuse — the refusal is the point.

Invoked as `/pickup <path>`. The path is required. Relative paths are relative to the repo root (`git rev-parse --show-toplevel`); resolve to an absolute path once, up front, because step 3 may move the session into another worktree.

## Format contract (consumer of `/handoff`)

These are contract, not convention. Misreading any of them silently misreads real handoffs.

- **Slots are addressed by their `### N.` prefix.** The descriptive remainder of a heading is human-facing text and is never matched on.
- **Slot entries render as one `- ` bullet each.** Never bare lines.
- **The newest `## CONSOLIDATED` block is the topmost one**, immediately under the `> Resuming?` line. Blocks are prepended, so newest is positional — do not compare block timestamps.
- **`---` separates the head from the append-only ledger tail.** Everything below it is archive.
- **`-- consolidated <ts> --` watermark lines** live in the ledger tail.
- Nine slots: 1 Anchors, 2 Settled, 3 Ruled out & traps, 4 Verified, 5 Assumed, 6 Contingencies, 7 Live state, 8 Open actions, 9 Synthesis log.
- **Two machine-read keys are pinned** (never tag-routed; maintained by hand):
  - Slot 1: a `- branch: <branch-name>` bullet, written at file creation when `git branch --show-current` prints a name — otherwise omitted entirely.
  - Slot 7: a `- smoke: <command>` bullet, written at file creation only when a real smoke command is known — otherwise omitted entirely.
  - If either key is absent, say so and skip that check. **Never guess** which free-form line is the branch or which is a command — a wrong guess is either a bogus mismatch or an arbitrary line executed as shell. Every other line in those slots is free-form. Trim surrounding whitespace from the remainder after the pinned prefix before judging it; empty after trimming, or a remainder that is itself an angle-bracket placeholder (`<…>`), counts as absent and takes the skip path — never as a present value to compare or execute.

- **Handoffs under `docs/handoffs/` are local working state.** Never `git add` them.

## Resume procedure

Run these steps in order. Do not skip. Do not reorder.

### 1. Resolve the path and detect the format

Take the path the user supplied. If it is relative, resolve it against the repo root. **Do not load the whole file.** Scan from its start only through the head: read the `## STATUS:` line and the `> Resuming?` line, then stop the scan at the first `## CONSOLIDATED` heading or at a line that is exactly `---`.

**Bounded scan.** If neither `## CONSOLIDATED` nor a `---` line appears within the first 40 lines, stop the scan and treat the file as legacy (below). Do not continue reading to EOF looking for a marker — hand-written or pre-schema handoffs often have neither marker near the top, and an unbounded scan contradicts the "do not load the whole file" rule two clauses above.

**Schema detection.** A schema-conformant handoff has a `## CONSOLIDATED` heading in that head scan, before `---`. If it does not:

1. Print exactly (substitute the real path):
   ```
   LEGACY: <path> has no ## CONSOLIDATED block.
   Branch and smoke verification are unavailable on this file.
   Reading the whole file as free-form context. Synthesis gate still applies — until a synthesis note exists, refuse to create, edit or delete any file, to commit or push, or to run any command that changes state outside this repo. Write the note at the end of the file under a `## Synthesis` heading you create, naming (a) status in your own words, (b) outstanding obligations you now own, (c) the contingency most likely to fire, (d) one fact you re-ran with command and output.
   ```
2. Read the whole file (there is no newest-block boundary to respect).
3. Skip the newest-block / anchor / smoke steps (no slots to parse). Jump to the propose step, then enforce the synthesis gate against the `## Synthesis` heading instead of slot 9. Use the legacy refusal block in step 6.
4. Do not invent slots. Do not rewrite the file into the new schema.

Otherwise continue with steps 2–6. Step 2 resumes reading at the `## CONSOLIDATED` heading the head scan stopped on — it does not re-open the file from byte 0.

### 2. Read only the newest consolidated block

Extract the text beginning at the first `## CONSOLIDATED` heading and ending at (but not including) the next `## CONSOLIDATED` heading, or at the `---` separator, whichever comes first. That slice is the newest block. **Do not read older consolidated blocks. Do not read the ledger tail below `---`.** Older blocks and the ledger are archive — consulted only when a specific question needs a raw entry. This is what keeps the read bounded as a work-stream grows; without it, every resume re-loads the entire history into context.

Within the newest block, locate each slot by its `### N.` prefix (match `^### 1\.`, `^### 2\.`, … `^### 9\.`). Slot contents are the `- ` bullets under that heading, up to the next `### ` heading or the end of the block.

### 3. Verify anchors — enter the right worktree on mismatch before anything else

Always print the resolved toplevel so a wrong-tree resume is visible even where it cannot be checked mechanically (with several worktrees open, a handoff written on `main` in the primary tree would otherwise pass a branch-only check from any worktree also on `main`):

```
ANCHOR: worktree `<git rev-parse --show-toplevel>`
```

From slot 1 (`### 1.`), collect `- ` bullets. Find the bullet whose text after `- ` begins with the pinned prefix `branch: `. Trim surrounding whitespace from the remainder — that trimmed value is the expected branch name. Every other bullet is free-form — note it, do not parse it as a branch. **Never guess** a branch from a free-form path or from the filename.

**Absent key:** if no `branch: ` bullet exists, or the remainder is empty after trimming, print exactly this and continue to the smoke check — do not invent an expected branch, do not error, do not treat whitespace-only as a present value that mismatches the checked-out branch:

```
ANCHOR: no branch: key in slot 1 — skipped.
```

**Placeholder value:** if the trimmed remainder is itself an angle-bracket placeholder (`<…>`), print both of these exact lines and continue — do not invent an expected branch, do not error:

```
ANCHOR: no branch: key in slot 1 — skipped.
NOTE: slot 1 has a placeholder branch: value — fix the handoff.
```

**Present key:** compare its (trimmed, non-empty, non-placeholder) value against `git branch --show-current` (run from the current worktree). On mismatch, the mismatch report is the first thing you print after the worktree line — before status, before slot contents, before any proposal. Print exactly:

```
ANCHOR MISMATCH: handoff says branch `<expected>` but checked-out is `<actual>`.
```

Print `(detached HEAD)` for `<actual>` when `git branch --show-current` prints nothing.

Then move the session into the right tree instead of stopping. At most one switch per `/pickup`:

1. Find the worktree that has `<expected>` checked out: `git worktree list --porcelain`, the `worktree <path>` record whose `branch refs/heads/<expected>` line matches.
2. If none exists and `git rev-parse --verify --quiet refs/heads/<expected>` or `refs/remotes/origin/<expected>` resolves (no fetch), create one. The primary tree is the first `worktree` record of `git worktree list --porcelain`; from the current tree, without `cd`, run `git worktree add "<primary>/.claude/worktrees/<expected with / replaced by +>" <expected>`.
3. Switch the session with the `EnterWorktree` tool, passing `path: <worktree path>`. Never `cd` instead — the session cwd and its caches would still point at the old tree.
4. Handoffs are untracked, so the file exists only in the tree that wrote it. If the absolute handoff path is outside the new tree, copy it to `<new tree>/docs/handoffs/<basename>` unless that file already exists, and use the copy from here on — for the synthesis and every later `/handoff` append. Otherwise `/handoff` in the new tree finds no file and forks the work-stream.
5. Print exactly this, then re-run this anchor check from the top in the new tree (worktree line, then the branch check), and continue:

   ```
   ANCHOR: switched to worktree `<path>` for branch `<expected>`; handoff at `<handoff path>`.
   ```

   If step 2 created the tree, also print `NOTE: worktree freshly created — no installed dependencies, build outputs or .env; slot-7 dirty state lives in <old tree>.` before the smoke runs, so a setup failure is not misread as live-state drift.

Stop when the switch cannot happen: `<expected>` exists neither locally nor on `origin`, `git worktree add` fails (git's error is the `<reason>`), `EnterWorktree` rejects the path (e.g. the target is the primary tree and this session already runs inside a worktree), or the re-run still mismatches — a second mismatch never triggers another switch. Then print exactly this and stop — no smoke, proposal, or synthesis:

```
ANCHOR UNRESOLVED: cannot enter a worktree on branch `<expected>` — <reason>.
Stop. Switch to the right worktree/branch, or fix slot 1, then re-run /pickup.
```

Do not edit the handoff to "fix" the anchor.

On match, print exactly this and continue:

```
ANCHOR: branch `<name>` matches.
```

### 4. Run the smoke command

From slot 7 (`### 7.`), find the bullet whose text after `- ` begins with the pinned prefix `smoke: `. Trim surrounding whitespace from the remainder — that trimmed value is the shell command, run as-is from the repo root. Every other bullet is free-form live-state — never treat a free-form line as a command. **Never guess** which line is the smoke.

**Absent key:** if no `smoke: ` bullet exists, or the remainder is empty after trimming, print exactly this and continue — do not invent a command, do not error:

```
SMOKE: no smoke: key in slot 7 — skipped.
```

**Placeholder value:** if the trimmed remainder is itself an angle-bracket placeholder (`<…>`), print both of these exact lines and continue — do not invent a command, do not error, do not hand a literal `<command>` to a shell:

```
SMOKE: no smoke: key in slot 7 — skipped.
NOTE: slot 7 has a placeholder smoke: value — fix the handoff.
```

**Present key:** run the (trimmed, non-empty, non-placeholder) command. On non-zero exit, print exactly this shape (include stdout/stderr) and stop — no proposal, no synthesis, no mutations:

```
SMOKE FAILED (exit <code>): <command>
<stdout/stderr>
Stop. Fix the live state (see slot 7 revert commands) or update the smoke, then re-run /pickup.
```

On zero exit, print exactly this and continue:

```
SMOKE PASSED: <command>
```

### 5. Propose the next move (computed fresh)

Print a short resume briefing. The `## STATUS:` line lives in the file head (above every consolidated block) and is always readable; every other item below is drawn only from the newest block — never from older blocks or the ledger:

1. The `## STATUS:` line.
2. Slot 1 non-`branch:` paths (anchors only — the `branch: ` key was already handled in step 3).
3. Slot 8 open actions (the obligations now owned).
4. Slot 7 live state (what is dirty; free-form lines only — the `smoke: ` key was already handled in step 4).
5. Slot 6 contingencies (what might fire).
6. Slot 2 settled decisions (do not relitigate).
7. Slot 3 ruled-out & traps.
8. Slot 5 assumed (treated as true but never observed — the objective/subjective wall; without this a belief becomes a fact across a discontinuity).

On a legacy file (no slots), draw the same eight categories from the free-form text where present, and say which were unavailable.

Then compare that declared state against the skills available in this session and **propose one next move**. Say plainly, in the briefing, that this proposal is computed now and is never inherited from the handoff — the session that wrote the handoff was the degraded one and is worst-placed to route.

Do not start the proposed work yet. The synthesis gate is still closed.

### 6. Synthesis gate — refuse every mutation until written

Until a synthesis entry exists at the synthesis location, refuse to create, edit or delete any file, to commit or push, or to run any command that changes state outside this repo. This is a hard refusal, not a request. Scoping the refusal to "edits" alone would leave commits, deletes, seeds and deploys as an open path past the gate — and slot 7 exists precisely because agents routinely mutate live state.

**Three carve-outs**, because the procedure mandates them before a synthesis can exist:

1. The step-3 worktree switch, including the `git worktree add` and handoff copy it may run.
2. The slot-7 smoke command in step 4.
3. The synthesis write itself.

Without those the gate forbids the very steps that precede it.

**Schema-conformant refusal** (print exactly when the synthesis location is slot 9):

```
REFUSED: no synthesis in slot 9 of the newest consolidated block.
Write the synthesis into ### 9. of the newest ## CONSOLIDATED block, then re-attempt.
Required four items: status / owns / contingency / re-ran.
```

**Legacy refusal** (print exactly when the synthesis location is the `## Synthesis` heading):

```
REFUSED: no ## Synthesis note on this legacy handoff.
Append a ## Synthesis heading at the end of the file with the four required items, then re-attempt.
Required four items: status / owns / contingency / re-ran.
```

**User override.** An explicit user instruction waives the gate for the requested action. A waived action obliges the synthesis to be written at the next opportunity — do not leave a waived session without a synthesis entry. The waiver line in that bullet must name what was waived (e.g. `waiver: user instructed <action>`), so a bypass is visible rather than silent. Without an explicit user instruction, do not waive.

**Synthesis entry shape.** Append exactly one `- ` bullet to the synthesis location — under `### 9.` of the newest block on a schema-conformant file (create no second `### 9.`; leave older blocks untouched), or under a `## Synthesis` heading you create at the end of a legacy file — in this form:

```
- <YYYY-MM-DD HH:MM> status: <status in this session's own words> | owns: <outstanding obligations from slot 8, or "none"> | contingency: <the slot-6 contingency most likely to fire, or "none"> | re-ran: `<command>` → <actual output, single-line condensed>
```

All four items are required. Each value after `status:`, `owns:`, `contingency:`, and `re-ran:` must be non-empty. The `re-ran:` value must carry both a command and its actual output (the `→` separator and text on both sides), **or** the exact `UNRUNNABLE — <why>` form from the derivation ladder below. Empty markers such as `status: | owns: | contingency: | re-ran:` do **not** open the gate.

The `re-ran` item must be one fact from slot 4 (`### 4.`), re-executed now — not copied from the handoff. Derive the command from the entry itself:

- If the entry embeds a shell command, re-run that command.
- If the entry cites `path:line` (or a bare path), run a read/grep against that path that would confirm or refute the claim (e.g. `sed -n '<line>p' <path>` or `rg -n '<claim-token>' <path>`). Record the actual stdout, or `MISSING: <path>` if the path is absent.
- If the chosen fact cannot be re-run here (its command path is absent from this worktree, a required tool is unavailable, etc.), pick another slot-4 fact that can. If none can, write `re-ran: UNRUNNABLE — <why>` where `<why>` names at least one slot-4 fact that was attempted and why it could not run (e.g. `slot-4 "readyAt-cursor reverts" — path absent from this worktree; no other slot-4 fact runnable`). The escape is not reachable by not trying.
- If slot 4 is empty (or the file is legacy and has no slot 4), re-run any cheap verifying command that confirms a claim from the briefing and say so.

The timestamp is local time in `YYYY-MM-DD HH:MM`.

**Writing the synthesis entry itself is the one permitted write to the handoff before the gate opens.** It is an append to the synthesis location only (slot 9, or the `## Synthesis` heading on a legacy file) — do not reorder bullets, do not edit other slots, do not touch older blocks or the ledger.

After a complete entry exists at the synthesis location, the gate is open for this session. Subsequent mutations proceed normally. A later `/pickup` on the same block treats the gate as already open only when the synthesis location contains at least one `- ` bullet whose four values are all non-empty and whose `re-ran:` either carries both a command and its output or is the `UNRUNNABLE — <why>` form — a partial or empty entry re-arms the refusal. A new consolidated block (empty slot 9) also re-arms the gate.
