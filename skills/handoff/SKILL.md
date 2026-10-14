---
name: handoff
description: 'Consolidate the work-stream ledger into a resumable handoff, then echo its path so the session can be cleared. Also defines the five ledger triggers that must be appended DURING work. Triggers: "handoff", "/handoff", "write the handoff", "wrap this up so I can clear".'
---

# Handoff Skill

Two jobs in one skill:

1. **During work** — append a ledger entry the moment any of the five triggers fires.
2. **On invoke** — consolidate those entries into a resumable block and echo the path.

The point of writing to disk as facts are understood is that they never enter the compaction re-compression chain. Consolidation is a lookup by tag, never a paraphrase.

## Slug rule

Derive `<slug>` from the work-stream name mechanically:

1. Normalize to Unicode NFC. Without this, the same visible name in NFD yields a different slug (base letters survive; only combining marks collapse) — two agents, two paths.
2. Lowercase the name.
3. Replace every run of characters outside ASCII `[a-z0-9]` with a single `-`.
4. Trim leading and trailing `-`.

No date prefix. No transliteration step — diacritics are outside `[a-z0-9]` and collapse like any other non-ASCII character, yielding an ugly but single-valued slug. Prefer ASCII work-stream names so the slug stays readable; the rule itself never guesses how to fold them. A one-off job with no feature name still gets a short ASCII descriptive name (e.g. `sso-probe`). Example: `Site-agent multi-account (pass 2)` → `site-agent-multi-account-pass-2`. Two agents on the same work-stream must resolve the same path independently.

**An existing file wins.** Before creating anything, look in `docs/handoffs/` for a file that already belongs to this work-stream and use it. The derivation rule settles what a _new_ file is called; it never overrides one that exists. That stops a second agent forking the stream by naming it slightly differently.

## Ledger triggers (working-session mandate)

Append one line to the work-stream file the moment any of these occurs. Resolve the path first: if a handoff for this work-stream already exists under `docs/handoffs/`, append to it; otherwise derive `<slug>` from the rule above and create `docs/handoffs/<slug>.md` with the head skeleton below — fill the H1 with the human work-stream name, a real one-sentence status, the real `/pickup` path using the derived slug, and slot 1's real branch from `git branch --show-current` when that command prints a name — if it prints nothing (detached HEAD), omit the `branch:` bullet entirely rather than writing a valueless one; never leave placeholder text on disk. Fill slot 7 with a real `smoke: <command>` only when a smoke command is known; otherwise omit the `smoke:` bullet entirely. Then append the entry. Do not batch. Do not wait for `/handoff`.

| Tag        | Append the moment                                              | Routes to |
| ---------- | -------------------------------------------------------------- | --------- |
| `VERIFIED` | a fact is confirmed by tool output and cost real time to find  | slot 4    |
| `KILLED`   | a hypothesis is refuted, or an approach is tried and abandoned | slot 3    |
| `SETTLED`  | the user makes a decision                                      | slot 2    |
| `MUTATED`  | external state is changed                                      | slot 7    |
| `IF`       | a conditional rule is learned: if X then do Y                  | slot 6    |

Entry format — one line, fixed columns (`YYYY-MM-DD HH:MM`, two spaces, a supported tag padded to the 8-char column, two spaces, body):

```
2026-09-05 15:01  KILLED    readyAt-cursor - misses rows; reverted in 0fb0d5164
```

Append below the `---` separator. Newest at the bottom. Never edit a prior line.

## Document location and head skeleton

Path: `docs/handoffs/<slug>.md`. Handoffs are local working state — never stage them. When creating the first file, run `git check-ignore -q docs/handoffs/<slug>.md`; if it exits non-zero, tell the user to add `docs/handoffs/` to `.gitignore` (do not edit `.gitignore` yourself).

Head skeleton (created by the ledger mandate before its first entry; fill every field with real values — never leave angle-bracket placeholders on disk). The H1 is the human work-stream name, not the slug. **Pinned keys are not tag-routed.** Write `- branch: <name>` at creation from `git branch --show-current` when that command prints a name, and maintain it by hand thereafter; if the command prints nothing (detached HEAD), omit the `branch:` bullet entirely — never leave a valueless `- branch:` on disk. Write `- smoke: <command>` only when a real smoke command is known, and maintain it by hand thereafter; otherwise omit that bullet entirely. Both omit rules live in this prose, not as comments inside the template below.

```markdown
# <work-stream name>

## STATUS: <one plain sentence declaring where the work stands>

> Resuming? Run `/pickup docs/handoffs/<slug>.md` - do not start from this file alone.

## CONSOLIDATED <ISO-8601 timestamp>

### 1. Anchors

- branch: <branch from git branch --show-current>

### 2. Settled - do not relitigate

### 3. Ruled out & traps

### 4. Verified

### 5. Assumed

### 6. Contingencies

### 7. Live state

- smoke: <command>

### 8. Open actions

### 9. Synthesis log

---
```

## Consolidation procedure

Run these steps in order when the user invokes `/handoff` (or any trigger phrase in the frontmatter).

1. **Resolve the path.** If the user points at an existing handoff, use that path. Otherwise look in `docs/handoffs/` for a file that already belongs to this work-stream and use it. Only if none exists, derive `<slug>` via the slug rule and take `docs/handoffs/<slug>.md`. **Do not create the file** — with two carve-outs only: (a) Recovery below, and (b) the Guard's thin-ledger proceed path when the file is absent. Outside those carve-outs, a refused run must leave nothing on disk; inside them the skeleton (and any appended held/reconstructed entries) may already be on disk before the guard decides. The ledger mandate creates it when the first entry is recorded during work. If it is absent, treat the pending-entry count as 0 and proceed to the guard.
   **Recovery.** When no handoff file exists and entries are being reconstructed from a transcript extract, consolidation is the step that creates the file: write the head skeleton first, append the reconstructed ledger entries below `---`, then run the normal consolidation procedure over them. The guard still applies to the reconstructed entries — recovery is not an exemption. On recovery, omit `branch:` unless the original branch is known from the transcript (`git branch --show-current` names the recovering worktree and would mislead). Everything else in the procedure is unchanged.
2. **Count pending entries and run the guard** (see Guard below). A pending entry is a ledger line below the last `-- consolidated <ts> --` watermark (or any ledger line if no watermark exists) that matches the fixed entry format: `YYYY-MM-DD HH:MM`, two spaces, a supported tag padded to the 8-char column, two spaces, then text. Blank lines, watermarks, and malformed lines are not entries and never count. The boundary is positional — never a timestamp comparison. Collect every non-blank, non-watermark line below the watermark that does not match the entry format; do not count them, do not route them, and do not invent a home for them. If the guard hard-refuses, stop. Write nothing. Print each unmatched line verbatim as `UNMATCHED: <line>`, then the refusal text. If the thin-ledger warning fires, follow its proceed path — append held entries below `---` first (creating the file via the head skeleton when absent), then re-count the pending set, re-apply the thin predicate (collect the still-thin warning if it still fails), and evaluate the soft warning against that **post-append** set; continue from step 3 over those ledger lines (do not write slots from live context). Collect every Guard warning here; print them once in step 7, never mid-procedure.
3. **Route each pending entry by tag** into its slot using the table above. Copy the body (everything after the tag column) **verbatim** into the slot as one `- ` bullet. Do not reword, summarise, or merge entries. Untagged or unknown-tag lines stay in the ledger only — do not invent a home for them.
4. **Carry forward ALL of slots 1–8** from the newest `## CONSOLIDATED` block verbatim, so the new block stands alone. An entry may be dropped **only** when a pending ledger line supersedes it **by name**. There is no judgement about what is "still live". Slot 9 (Synthesis log) does **not** carry forward — leave it empty for `/pickup` to fill.
5. **Prepend** the new `## CONSOLIDATED <ISO-8601 timestamp>` block immediately under the `> Resuming?` line (above any older consolidated blocks and above `---`). Then **append** a `-- consolidated <same-ts> --` watermark as the last line of the ledger. Delete nothing — older blocks, prior watermarks, and the full ledger tail survive byte-identical.
6. **Rewrite** the `## STATUS:` line as one plain sentence declaring where the work stands. No phase enum. No research/design/build label.
7. **Print in this order, then stop:** every `UNMATCHED: <line>` collected in step 2; then every Guard warning in collection order (thin-ledger, still-thin-after-append if any, soft); then exactly `Done <path relative to the repo root>.` — nothing after that. No summary, no section listing, no next-step suggestion. The user copies that path into a fresh session.

### Consolidated block shape

```markdown
## CONSOLIDATED <ISO-8601 timestamp>

### 1. Anchors

### 2. Settled - do not relitigate

### 3. Ruled out & traps

### 4. Verified

### 5. Assumed

### 6. Contingencies

### 7. Live state

### 8. Open actions

### 9. Synthesis log
```

Nine slots, always present, in this order. Empty slots stay as the bare heading. Slot contents are the verbatim bodies from routed ledger lines (and any carried-forward lines), **one `- ` bullet per entry** — never a bare line, never rephrased.

**Slots are addressed by their `### N.` prefix.** The descriptive remainder of a heading is human-facing text and is never what a consumer matches on.

| Slot                           | Filled by                                                                                                                                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Anchors                     | carried forward and hand-maintained (absolute paths: spec, plan, PR, prior handoff). Pinned `- branch: <name>` written at creation from `git branch --show-current` when that prints a name — omit on detached HEAD; maintain by hand thereafter. Not tag-routed. |
| 2. Settled - do not relitigate | `SETTLED` only — routed ledger entries, never hand-written.                                                                                                                                                                                                       |
| 3. Ruled out & traps           | `KILLED` only — routed ledger entries, never hand-written.                                                                                                                                                                                                        |
| 4. Verified                    | `VERIFIED` only — routed ledger entries, never hand-written.                                                                                                                                                                                                      |
| 5. Assumed                     | carried forward and hand-maintained. Not tag-routed. Leaves only when a later `VERIFIED` or `KILLED` ledger entry supersedes it by name — never by eviction.                                                                                                      |
| 6. Contingencies               | `IF` only — routed ledger entries, never hand-written.                                                                                                                                                                                                            |
| 7. Live state                  | `MUTATED` only for claim bullets — routed ledger entries, never hand-written. Pinned `- smoke: <command>` written at creation when known, and maintain by hand thereafter — omit when unknown. Neither key is tag-routed.                                         |
| 8. Open actions                | carried forward and hand-maintained (outstanding obligations). Not tag-routed.                                                                                                                                                                                    |
| 9. Synthesis log               | written by `/pickup` on resume — leave empty at consolidation                                                                                                                                                                                                     |

**Invariant scope.** The ledger-only rule binds the **tag-routed** slots (2 Settled, 3 Ruled out, 4 Verified, 6 Contingencies, 7 Live state claim bullets): those are where a live-context belief could be laundered into an established fact, and they receive only routed ledger entries. Slots 1, 5 and 8 are hand-maintained by nature — pointers, the explicitly unverified bucket, and obligations rather than claims — so none of them asserts that something was established. No ANCHOR/ASSUMED/OPEN tags; eight triggers for three slots costs more than the purity is worth.

## Guard

Three tiers. Run as procedure step 2, using the pending-entry count already gathered there. Pending means only entry lines matching the fixed entry format (tag padded to the 8-char column); blank lines, watermarks, and malformed lines never count.

The guard keys on **compaction**, not entry count alone. A thin ledger on an uncompacted session is a mandate lapse against intact context; a thin ledger after compaction is irrecoverable re-compression. Only the second hard-refuses.

### Locate the transcript (mandatory)

Always resolve a transcript before deciding the tier. Do not skip the lookup — an unchecked session always lands on the permissive branch and makes hard refusal unreachable by omission.

**Launch directory.** Use the working directory recorded in the session context. If it cannot be determined, use `pwd` and rely on the toplevel fallback below — and say which you used in the warning text. (Do not silently substitute `pwd` for a known launch directory.) A user-named path wins when given.

Derive the project key by replacing every character outside `[A-Za-z0-9]` with `-`, and look under `~/.claude/projects/<that-key>/`.

**Fallback:** sessions running inside a git worktree commonly record their transcript under the repo toplevel's key rather than the worktree's, leaving the worktree key with no top-level `*.jsonl`. So if the launch-directory key holds no `*.jsonl`, retry with the repo toplevel key (`git rev-parse --show-toplevel`, same character substitution) before declaring a genuine miss.

**Soundness (applies to whichever key resolves — launch or toplevel).** Accept the key only if exactly one top-level `*.jsonl` has an mtime within **10 minutes** of now; zero or more than one ⇒ undeterminable, do not pick. The live transcript is typically seconds old, while a concurrent session's is usually tens of minutes stale, so 10 minutes leaves headroom on both sides. A tighter window (e.g. ~2 min) fails open at the end of a long wait when the live transcript has not flushed, which is exactly when `/handoff` runs. An honest miss beats a confident wrong neighbour, the same principle as never guessing `branch:`. Known limit: freshness proves uniqueness, not identity — a fresh neighbour plus an unflushed own transcript can still yield a confident wrong pick; no cheap positive check exists.

Run both extractor invocations from the **repo root** (the plugin ships the extractor; invoke it through `node`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/handoff/extract-transcript.mjs" <session.jsonl> --count-only
node "${CLAUDE_PLUGIN_ROOT}/skills/handoff/extract-transcript.mjs" <session.jsonl> --compactions
```

`--count-only` prints a bare integer of main-thread assistant turns; `--compactions` prints a bare integer of `type:system` / `subtype:compact_boundary` entries. A third flag, `--turn-times`, appends a `== TURN TIMES ==` section carrying one timestamp per assistant turn; `/handoff` does not use it, but this plugin's Stop hook (`hooks/ledger-nudge.mjs`) does, to count turns relative to the last watermark rather than to session start. Default output carries no such section, so it stays a stable contract for this guard — but the hook parses the `== NAME ==` headers and the ledger entry format below, so renaming either silently disables it. The ledger is thin when:

```
entries < max(2, floor(turns / 40))
```

Only a genuine miss (no usable key with exactly one fresh candidate, and no user-named path) may treat the session as uncompacted. Apply the floor only then (thin means `entries < 2`). Failing open is deliberate: blocking without evidence of re-compression is the defect this guard exists to avoid — but the miss must appear in the warning text below.

### Hard refusal

Hard-refuse only when the session has compacted (`compactions >= 1`) **and** the ledger is thin. On refusal, print exactly this shape (substitute the real counts) and stop. Write no new `## CONSOLIDATED` block, append no watermark, and create no file.

```
REFUSED: 1 ledger entry across 180 assistant turns.
Reconstruct with:
  node "${CLAUDE_PLUGIN_ROOT}/skills/handoff/extract-transcript.mjs" <session.jsonl>
then append the missing entries and re-run /handoff.
```

**The extract is grepped, not read whole.** A real session emits ~3 MB even after filtering. Direct the operator to search the extract for the missing entries (`rg`, `grep`); never tell anyone to read the whole extract into context.

### Thin-ledger warning (uncompacted or unknown)

When the ledger is thin and the session is uncompacted (`compactions = 0`), collect exactly this warning — substitute the real counts and singularize `entry`/`entries` to match — then follow the proceed path:

```
WARNING: 0 ledger entries across 128 assistant turns on an uncompacted session — the ledger mandate was skipped. Append the held entries below ---, then consolidate from them. Slots receive only routed ledger entries.
```

When the ledger is thin and compaction state could not be determined (no transcript resolved, or the mtime window was empty/ambiguous), collect this complete variant instead — still substitute the real pending-entry count and singularize `entry`/`entries`; do not leave the sample `0` when the real count differs, and do not compose the rest by substituting into the block above:

```
WARNING: 0 ledger entries across an uncounted session (no transcript — treating as uncompacted) — the ledger mandate was skipped. Append the held entries below ---, then consolidate from them. Slots receive only routed ledger entries.
```

**Held entries.** A held entry is a fact from this session that one of the five ledger triggers required and that was never appended: one tagged line per fact, in the fixed entry format, timestamped with the append moment (not the turn the fact was learned). Appending zero held entries after a thin-ledger warning is itself a failure — the warning exists because the mandate was skipped; an empty append leaves that failure unremediated.

**Proceed path.** Do not write claim content into tag-routed slots from live context. If the handoff file does not yet exist, write the head skeleton first (same _file-creation_ ordering as Recovery — fill real values; omit `branch:` only on detached HEAD). Then append every held entry to the ledger below `---` in the fixed entry format. Re-count the pending set and **re-apply the thin predicate** to it. If the ledger is still thin after the append, collect a second distinct warning naming the post-append counts — do not refuse; the escape must stay available — then continue. Soft-warning evaluation also uses that post-append pending set. Then run the normal consolidation (steps 3–7) over those ledger lines. Tag-routed slots receive only routed ledger entries; slots 1/5/8 and the pinned keys may be hand-maintained (see Invariant scope).

Pinned shapes for the still-thin second warning (substitute real counts; singularize). When turns are known:

```
WARNING: ledger still thin after append (0 entries across 128 assistant turns) — held entries were not written.
```

When turns are unknown (undeterminable / no transcript), use this complete variant instead:

```
WARNING: ledger still thin after append (0 entries across an uncounted session) — held entries were not written.
```

### Soft warning

When a transcript is available and `turns > 60`, and the pending ledger — the **post-append** set when the thin-ledger proceed path ran, otherwise the set counted at the start of step 2 — has zero `KILLED` entries **or** zero `MUTATED` entries, collect a one-line warning naming the empty category, then proceed with consolidation. Soft warning never refuses.
