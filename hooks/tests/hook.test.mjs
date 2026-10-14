import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { nudge } from '../ledger-nudge.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hook = join(here, '..', 'ledger-nudge.mjs');

const scratch = [];
after(() => {
  for (const root of scratch) rmSync(root, { recursive: true, force: true });
});

function scratchDir(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(root);
  return root;
}

function workspace(files) {
  const root = scratchDir('nudge-');
  const dir = join(root, 'docs', 'handoffs');
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body);
  }
  return root;
}

const Midnight = Date.parse('2026-09-14T00:00:00.000Z');
const at = (minutes) => new Date(Midnight + minutes * 60_000).toISOString();

// One assistant turn per minute from midnight; `human` lands in == HUMAN ==.
function transcript(turns, { mention = 'drifting.md', human } = {}) {
  const file = join(scratchDir('nudge-tx-'), 'session.jsonl');
  const lines = [];
  for (let i = 0; i < turns; i += 1) {
    const content =
      i === 0
        ? [
            {
              type: 'tool_use',
              name: 'Read',
              input: {
                file_path: `/repo/docs/handoffs/${mention}`,
              },
            },
          ]
        : [{ type: 'text', text: `turn ${i}` }];
    lines.push(
      JSON.stringify({
        type: 'assistant',
        timestamp: at(i),
        message: { content },
      }),
    );
  }
  if (human) {
    lines.push(
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'text', text: human }] },
      }),
    );
  }
  writeFileSync(file, lines.join('\n'));
  return file;
}

function run(input, script = hook) {
  return execFileSync(process.execPath, [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
}

const ledger = (...tail) => ['# drifting', '---', ...tail].join('\n');
const entries = (count, fromHour = 1) =>
  Array.from(
    { length: count },
    (_, i) => `2026-09-14 ${fromHour}${i}:00  VERIFIED  fact ${i}`,
  );
const watermarkAt = (minutes) => `-- consolidated ${at(minutes)} --`;

test('fires when the ledger has drifted', () => {
  const cwd = workspace({ 'drifting.md': ledger() });
  const out = run({
    hook_event_name: 'Stop',
    transcript_path: transcript(50),
    cwd,
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'Stop');
  assert.match(parsed.hookSpecificOutput.additionalContext, /drifting\.md/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /0 pending/);
  // Pins the turn plumbing: gutting it would otherwise leave this green.
  assert.match(
    parsed.hookSpecificOutput.additionalContext,
    /last 50 assistant turns/,
  );
  assert.match(
    parsed.hookSpecificOutput.additionalContext,
    /VERIFIED, KILLED, SETTLED, MUTATED, IF/,
  );
});

// The gate constant is otherwise only inferable from unrelated fixtures.
test('silent one turn below the gate', () => {
  const cwd = workspace({ 'drifting.md': ledger() });
  assert.equal(
    run({ hook_event_name: 'Stop', transcript_path: transcript(39), cwd }),
    '',
  );
});

test('fires at exactly the gate', () => {
  const cwd = workspace({ 'drifting.md': ledger() });
  const out = run({
    hook_event_name: 'Stop',
    transcript_path: transcript(40),
    cwd,
  });
  assert.match(
    JSON.parse(out).hookSpecificOutput.additionalContext,
    /last 40 assistant turns/,
  );
});

// The defect this hook shipped with: consolidation appends the watermark as the
// ledger's last line, so pending resets to 0 by design and the hook nudged about
// a ledger just legitimately emptied.
test('silent immediately after a consolidation', () => {
  const cwd = workspace({
    'drifting.md': ledger(...entries(3), watermarkAt(60)),
  });
  assert.equal(
    run({ hook_event_name: 'Stop', transcript_path: transcript(50), cwd }),
    '',
  );
});

test('silent while too little work has happened since the watermark', () => {
  const cwd = workspace({
    'drifting.md': ledger(...entries(3), watermarkAt(20)),
  });
  assert.equal(
    run({ hook_event_name: 'Stop', transcript_path: transcript(50), cwd }),
    '',
  );
});

test('fires again once the session has worked on past the watermark', () => {
  const cwd = workspace({
    'drifting.md': ledger(...entries(3), watermarkAt(5)),
  });
  const out = run({
    hook_event_name: 'Stop',
    transcript_path: transcript(60),
    cwd,
  });
  assert.match(
    JSON.parse(out).hookSpecificOutput.additionalContext,
    /last 54 assistant turns/,
  );
});

test('silent when a watermark cannot be dated', () => {
  const cwd = workspace({
    'drifting.md': ledger('-- consolidated whenever --'),
  });
  assert.equal(
    run({ hook_event_name: 'Stop', transcript_path: transcript(50), cwd }),
    '',
  );
});

test('silent when the ledger is keeping up', () => {
  const cwd = workspace({ 'drifting.md': ledger(...entries(6)) });
  assert.equal(
    run({ hook_event_name: 'Stop', transcript_path: transcript(50), cwd }),
    '',
  );
});

test('silent when stop_hook_active is set', () => {
  const cwd = workspace({ 'drifting.md': ledger() });
  const out = run({
    hook_event_name: 'Stop',
    transcript_path: transcript(50),
    cwd,
    stop_hook_active: true,
  });
  assert.equal(out, '');
});

// Both names are on disk, so scanning prose too yields two candidates and the
// cardinality rule silences the hook — failing this test.
test('a name seen only in human prose is not a candidate', () => {
  const cwd = workspace({
    'drifting.md': ledger(),
    'other-stream.md': ledger(),
  });
  const file = transcript(50, {
    human: 'also see docs/handoffs/other-stream.md',
  });
  const out = run({ hook_event_name: 'Stop', transcript_path: file, cwd });
  assert.match(
    JSON.parse(out).hookSpecificOutput.additionalContext,
    /drifting\.md/,
  );
});

test('silent on malformed stdin', () => {
  assert.equal(
    execFileSync(process.execPath, [hook], {
      input: 'not json',
      encoding: 'utf8',
    }),
    '',
  );
});

test('fires when invoked through a symlink', () => {
  const link = join(scratchDir('nudge-link-'), 'ledger-nudge.mjs');
  symlinkSync(hook, link);
  const cwd = workspace({ 'drifting.md': ledger() });
  const out = run(
    { hook_event_name: 'Stop', transcript_path: transcript(50), cwd },
    link,
  );
  assert.match(
    JSON.parse(out).hookSpecificOutput.additionalContext,
    /drifting\.md/,
  );
});

// Driving the script cannot distinguish a guard returning null from an exception
// swallowed by main()'s blanket catch — both are empty stdout and exit 0 — so
// removing any guard below leaves the script-level assertions green.
test('returns null, without throwing, when the handoff is absent from disk', () => {
  const cwd = workspace({ 'unrelated.md': ledger() });
  assert.equal(nudge({ transcript_path: transcript(50), cwd }), null);
});

test('returns null, without throwing, when the handoffs directory is missing', () => {
  assert.equal(
    nudge({ transcript_path: transcript(50), cwd: scratchDir('nudge-bare-') }),
    null,
  );
});

test('returns null, without throwing, on a missing transcript', () => {
  const cwd = workspace({ 'drifting.md': ledger() });
  assert.equal(nudge({ transcript_path: '/nope/none.jsonl', cwd }), null);
});

test('returns null, without throwing, when stop_hook_active is set', () => {
  const cwd = workspace({ 'drifting.md': ledger() });
  assert.equal(
    nudge({ transcript_path: transcript(50), cwd, stop_hook_active: true }),
    null,
  );
});
