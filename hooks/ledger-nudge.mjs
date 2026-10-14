#!/usr/bin/env node
// Stop hook: nudges the model when a handoff ledger drifts behind the session.
// Always exits 0 — the audience is the model, never the human.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The trailing guard stops `notes.mdx` backtracking into the candidate `notes.md`.
const HandoffName =
  /\/handoffs\/([A-Za-z0-9][A-Za-z0-9._-]*\.md)(?![A-Za-z0-9._-])/g;
const Watermark = /^-- consolidated (.+) --$/;
// The counting regex and the nudge text are both built from this. Spelled out
// twice, a sixth trigger added to the skill would silently stop being counted.
export const Tags = ['VERIFIED', 'KILLED', 'SETTLED', 'MUTATED', 'IF'];
const Entry = new RegExp(
  String.raw`^\d{4}-\d{2}-\d{2} \d{2}:\d{2} {2}(?:${Tags.join('|')})\s+\S`,
);
const ToolSections = ['TOOL INPUTS', 'DIFFS'];

export function sectionsOf(extract) {
  const out = {};
  let current = null;
  for (const line of extract.split('\n')) {
    const header = /^== (.+) ==$/.exec(line);
    if (header) {
      current = header[1];
      out[current] = [];
    } else if (current) {
      out[current].push(line);
    }
  }
  return out;
}

// Positional rather than through the last-wins section map: prose that spells
// the header on its own line would otherwise rewrite the count.
export function turnsFromExtract(extract) {
  const lines = extract.split('\n');
  if (lines[0] !== '== TURNS ==') return Number.NaN;
  return Number.parseInt(lines[1] ?? '', 10);
}

// Tool INPUTS only. A name in assistant prose is aspirational; a name in a tool
// result is noise (`ls` of the handoffs dir returns every file there).
export function candidatesFromExtract(extract) {
  const sections = sectionsOf(extract);
  const text = ToolSections.flatMap((name) => sections[name] ?? []).join('\n');
  return new Set([...text.matchAll(HandoffName)].map((m) => m[1]));
}

export function countPendingEntries(text) {
  const lines = text.split('\n');
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (Watermark.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  return lines.slice(start).filter((line) => Entry.test(line)).length;
}

export function resolveWorkStream(candidates, onDisk) {
  const hits = [...candidates].filter((name) => onDisk.has(name));
  return hits.length === 1 ? hits[0] : null;
}

export function lastWatermark(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const found = Watermark.exec(lines[i]);
    if (found) return found[1].trim();
  }
  return null;
}

// The format is unpinned across the existing corpus: mostly ISO with an offset,
// occasionally a bare `YYYY-MM-DD HH:MM`, which is local time to whoever wrote it.
export function watermarkTime(raw) {
  if (!raw) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(raw)
    ? raw.replace(' ', 'T')
    : raw;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function turnTimesFromExtract(extract) {
  const lines = sectionsOf(extract)['TURN TIMES'] ?? [];
  return lines.filter((line) => line.trim() !== '');
}

export function turnsSince(turnTimes, sinceMs) {
  return turnTimes.filter((time) => {
    const ms = Date.parse(time);
    if (Number.isNaN(ms)) return false;
    return sinceMs === null || ms > sinceMs;
  }).length;
}

// The /handoff guard's own predicate. Do not introduce a second threshold here:
// two definitions of "thin" with nothing keeping them in sync is the drift that
// cost both skills their Rules blocks.
export function isThin(entries, turns) {
  return entries < Math.max(2, Math.floor(turns / 40));
}

const Extractor = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'skills',
  'handoff',
  'extract-transcript.mjs',
);

export function nudge(input) {
  if (input.stop_hook_active) return null;

  const transcript = input.transcript_path;
  if (!transcript || !existsSync(transcript)) return null;

  const dir = join(input.cwd ?? process.cwd(), 'docs', 'handoffs');
  if (!existsSync(dir)) return null;

  let extract;
  try {
    // 64 MB ceiling: a 49 MB transcript extracts to ~3 MB, well past the 1 MB
    // default, and an ENOBUFS throw here must stay silent rather than surface.
    extract = execFileSync(
      process.execPath,
      [Extractor, transcript, '--turn-times'],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch {
    return null;
  }

  if (!Number.isFinite(turnsFromExtract(extract))) return null;

  const onDisk = new Set(
    readdirSync(dir).filter((name) => name.endsWith('.md')),
  );
  const slug = resolveWorkStream(candidatesFromExtract(extract), onDisk);
  if (!slug) return null;

  const ledger = readFileSync(join(dir, slug), 'utf8');
  const entries = countPendingEntries(ledger);

  const raw = lastWatermark(ledger);
  const since = raw === null ? null : watermarkTime(raw);
  // A watermark we cannot date cannot bound the count. Stay quiet rather than
  // fall back to a session-absolute one, which nudges after every /handoff.
  if (raw !== null && since === null) return null;

  const turns = turnsSince(turnTimesFromExtract(extract), since);
  // The predicate's floor of 2 would otherwise demand two entries from the first
  // turn after a consolidation. 40 is its own divisor, not a second threshold.
  if (turns < 40) return null;
  if (!isThin(entries, turns)) return null;

  const noun = entries === 1 ? 'entry' : 'entries';
  return (
    `Ledger drift: ${slug} has ${entries} pending ${noun} across the last ` +
    `${turns} assistant turns. Append the entries you are holding - the ` +
    `triggers are ${Tags.join(', ')}.`
  );
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.exit(0);
  }

  let context = null;
  try {
    context = nudge(input);
  } catch {
    context = null;
  }

  if (context) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'Stop',
          additionalContext: context,
        },
      }),
    );
  }
  // No process.exit here: stdout to a pipe is async and exit would not flush it.
}

// argv[1] is resolved but not realpath'd, while import.meta.url is. Comparing
// them raw makes the hook a silent no-op behind any symlinked project path.
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) main();
