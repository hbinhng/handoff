import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'extract-transcript.mjs');
const fixture = join(here, 'fixture.jsonl');
const run = (...args) =>
  execFileSync(process.execPath, [script, fixture, ...args], {
    encoding: 'utf8',
  });
const runFile = (file, ...args) =>
  execFileSync(process.execPath, [script, file, ...args], { encoding: 'utf8' });

test('keeps human turns', () => assert.match(run(), /real human question/));
test('drops system-reminder turns', () =>
  assert.doesNotMatch(run(), /injected noise/));
test('drops task-notification turns', () =>
  assert.doesNotMatch(run(), /background done/));
test('keeps main-thread prose', () => assert.match(run(), /main thread prose/));
test('drops sidechain prose', () =>
  assert.doesNotMatch(run(), /subagent prose/));
test('keeps tool inputs', () => assert.match(run(), /grep -rn readyAt/));
test('keeps Edit diffs', () => assert.match(run(), /new_string/));
test('keeps operator notes beside tool_result', () =>
  assert.match(run(), /operator note about the seeded tenants/));
test('drops tool_result bodies', () =>
  assert.doesNotMatch(run(), /must not appear/));
test('counts 3 assistant turns', () =>
  assert.equal(run('--count-only').trim(), '3'));
test('counts 2 compaction boundaries', () => {
  assert.equal(run('--compactions').trim(), '2');
  assert.equal(run('--count-only').trim(), '3');
});
test('full extract reports compaction count', () => {
  const output = run();
  assert.match(output, /== COMPACTIONS ==\n2\n/);
});
test('rejects unknown flags', () => {
  assert.throws(
    () => run('-c'),
    (err) => {
      assert.match(String(err.stderr ?? err.message), /usage:/);
      assert.equal(err.status, 1);
      return true;
    },
  );
});
// The ledger nudge hook needs turns counted relative to a consolidation
// watermark, so it needs each turn's time. Default output must stay unchanged
// for the /handoff guard, which is why this rides on an opt-in flag.
test('default output carries no turn times section', () =>
  assert.doesNotMatch(run(), /== TURN TIMES ==/));

test('--turn-times lists one line per assistant turn, in order', () => {
  const directory = mkdtempSync(join(tmpdir(), 'extract-times-'));
  const file = join(directory, 'session.jsonl');
  writeFileSync(
    file,
    [
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-09-14T03:10:54.944Z',
        message: { content: [{ type: 'text', text: 'first' }] },
      }),
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'text', text: 'a human turn' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        isSidechain: true,
        timestamp: '2026-09-14T03:11:00.000Z',
        message: { content: [{ type: 'text', text: 'sidechain' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-09-14T03:12:00.000Z',
        message: { content: [{ type: 'text', text: 'second' }] },
      }),
    ].join('\n'),
  );
  try {
    const section = runFile(file, '--turn-times').split('== TURN TIMES ==')[1];
    assert.equal(section.trim().split('\n').length, 2);
    assert.match(section, /2026-09-14T03:10:54\.944Z/);
    assert.match(section, /2026-09-14T03:12:00\.000Z/);
    // Sidechain turns are not this session's work and must not be counted.
    assert.doesNotMatch(section, /03:11:00/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('caps Edit diffs at 1000 characters', () => {
  const directory = mkdtempSync(join(tmpdir(), 'extract-transcript-'));
  const file = join(directory, 'large-diff.jsonl');
  const newString = 'x'.repeat(1500);
  writeFileSync(
    file,
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Edit',
            input: { new_string: newString },
          },
        ],
      },
    }),
  );
  try {
    const output = runFile(file);
    assert.match(output, /x{900}/);
    assert.doesNotMatch(output, /x{1001}/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
