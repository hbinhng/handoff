import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  candidatesFromExtract,
  countPendingEntries,
  isThin,
  lastWatermark,
  resolveWorkStream,
  Tags,
  turnsFromExtract,
  turnsSince,
  turnTimesFromExtract,
  watermarkTime,
} from '../ledger-nudge.mjs';

const extract = [
  '== TURNS ==',
  '120',
  '== HUMAN ==',
  'please check docs/handoffs/from-human.md',
  '== ASSISTANT ==',
  'I think docs/handoffs/from-prose.md is relevant',
  '== TOOL INPUTS ==',
  'Bash {"command":"ls docs/handoffs/"}',
  'Bash {"command":"cat docs/handoffs/config-lib.md"}',
  'Read {"file_path":"/repo/docs/handoffs/config-lib.md"}',
  '== DIFFS ==',
  '{"file_path":"/repo/docs/handoffs/digo-pullable-platform.md","old_string":"a"}',
].join('\n');

test('reads the turn count', () =>
  assert.equal(turnsFromExtract(extract), 120));
test('missing turn count is NaN', () =>
  assert.ok(Number.isNaN(turnsFromExtract('== HUMAN ==\nx'))));

test('collects handoff names from tool inputs and diffs', () => {
  const got = candidatesFromExtract(extract);
  assert.ok(got.has('config-lib.md'));
  assert.ok(got.has('digo-pullable-platform.md'));
});
test('ignores names that appear only in human turns', () =>
  assert.ok(!candidatesFromExtract(extract).has('from-human.md')));
test('ignores names that appear only in assistant prose', () =>
  assert.ok(!candidatesFromExtract(extract).has('from-prose.md')));
test('a bare handoffs directory contributes no candidate', () => {
  const onlyDir =
    '== TOOL INPUTS ==\nBash {"command":"ls docs/handoffs/"}';
  assert.equal(candidatesFromExtract(onlyDir).size, 0);
});
test('deduplicates a name seen twice', () => {
  const names = [...candidatesFromExtract(extract)];
  assert.equal(names.filter((n) => n === 'config-lib.md').length, 1);
});

const ledger = [
  '# stream',
  '## CONSOLIDATED 2026-09-14T10:00:00+07:00',
  '### 4. Verified',
  '- 2026-09-14 09:00 something already routed',
  '---',
  '2026-09-14 09:00  VERIFIED  routed already',
  '-- consolidated 2026-09-14T10:00:00+07:00 --',
  '2026-09-14 11:00  KILLED    pending one',
  '2026-09-14 11:05  IF        pending two',
  '',
  'not an entry line',
].join('\n');

test('counts only entries below the last watermark', () =>
  assert.equal(countPendingEntries(ledger), 2));
test('counts every entry when no watermark exists', () =>
  assert.equal(
    countPendingEntries(
      '---\n2026-09-14 11:00  SETTLED   a\n2026-09-14 11:01  MUTATED   b',
    ),
    2,
  ));
test('slot bullets are not entries', () =>
  assert.equal(
    countPendingEntries('- 2026-09-14 09:00 status: x | owns: y'),
    0,
  ));

test('one intersecting name resolves', () =>
  assert.equal(
    resolveWorkStream(new Set(['a.md', 'ghost.md']), new Set(['a.md', 'b.md'])),
    'a.md',
  ));
test('no intersection resolves to null', () =>
  assert.equal(
    resolveWorkStream(new Set(['ghost.md']), new Set(['a.md'])),
    null,
  ));
test('two intersecting names resolve to null', () =>
  assert.equal(
    resolveWorkStream(new Set(['a.md', 'b.md']), new Set(['a.md', 'b.md'])),
    null,
  ));

test('thin below the floor', () => assert.equal(isThin(1, 10), true));
test('not thin at the floor', () => assert.equal(isThin(2, 10), false));
test('ratio governs long sessions', () => assert.equal(isThin(9, 400), true));
test('keeping up on a long session', () =>
  assert.equal(isThin(10, 400), false));

test('a longer extension is not a handoff candidate', () => {
  const extract =
    '== TOOL INPUTS ==\nRead {"file_path":"/r/handoffs/notes.mdx"}';
  assert.equal(candidatesFromExtract(extract).size, 0);
});
test('a suffixed backup is not a handoff candidate', () => {
  const extract =
    '== TOOL INPUTS ==\nRead {"file_path":"/r/handoffs/a.md.bak"}';
  assert.equal(candidatesFromExtract(extract).size, 0);
});

// Real ledgers accumulate one watermark per consolidation, so "the last one" is
// the load-bearing part of the scan.
test('counts below the last of several watermarks', () => {
  const many = [
    '-- consolidated 2026-09-14T09:00:00+07:00 --',
    '2026-09-14 09:30  VERIFIED  older pending',
    '-- consolidated 2026-09-14T10:00:00+07:00 --',
    '2026-09-14 10:30  KILLED    newer pending',
  ].join('\n');
  assert.equal(countPendingEntries(many), 1);
});

test('prose spelling a section header cannot clobber the turn count', () => {
  const extract = [
    '== TURNS ==',
    '120',
    '== ASSISTANT ==',
    'the extractor prints its count under',
    '== TURNS ==',
    '7 things worth noting',
  ].join('\n');
  assert.equal(turnsFromExtract(extract), 120);
});

test('reads the timestamp of the last watermark', () =>
  assert.equal(lastWatermark(ledger), '2026-09-14T10:00:00+07:00'));
test('no watermark yields no timestamp', () =>
  assert.equal(lastWatermark('# stream\n---\n'), null));

test('parses an offset-bearing watermark timestamp', () =>
  assert.equal(
    watermarkTime('2026-09-14T10:00:00+07:00'),
    Date.parse('2026-09-14T03:00:00Z'),
  ));
// Two of the watermarks in the existing corpus are written in this bare form.
test('parses a bare watermark timestamp as local time', () =>
  assert.equal(
    watermarkTime('2026-09-14 10:00'),
    new Date(2026, 8, 14, 10, 0).getTime(),
  ));
test('an unparseable watermark yields null', () =>
  assert.equal(watermarkTime('whenever'), null));

const timed = [
  '== TURNS ==',
  '3',
  '== DIFFS ==',
  '== TURN TIMES ==',
  '2026-09-14T02:00:00.000Z',
  '2026-09-14T04:00:00.000Z',
  '2026-09-14T05:00:00.000Z',
].join('\n');

test('reads the turn times section', () =>
  assert.equal(turnTimesFromExtract(timed).length, 3));
test('counts only turns after the watermark', () =>
  assert.equal(
    turnsSince(turnTimesFromExtract(timed), Date.parse('2026-09-14T03:00:00Z')),
    2,
  ));
test('counts every turn when there is no watermark', () =>
  assert.equal(turnsSince(turnTimesFromExtract(timed), null), 3));
test('an undateable turn is not counted', () =>
  assert.equal(
    turnsSince(['', 'not a date'], Date.parse('2026-09-14T03:00:00Z')),
    0,
  ));

// Reading the skill from a test is deliberate: without it, a sixth trigger added
// to that table still silently stops being counted here.
test('the trigger tags match the skill that defines them', () => {
  const skill = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'skills',
      'handoff',
      'SKILL.md',
    ),
    'utf8',
  );
  const table = [...skill.matchAll(/^\| `([A-Z]+)`\s*\|/gm)].map((m) => m[1]);
  assert.deepEqual(table, Tags);
});
