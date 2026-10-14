#!/usr/bin/env node
// Filter a Claude Code session JSONL down to resumable signal: human turns,
// main-thread assistant prose, tool inputs and Edit/Write diffs. Drops
// tool_result bodies, sidechain prose and injected reminders.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const [file, mode] = process.argv.slice(2);
const Modes = new Set([
  undefined,
  '--count-only',
  '--compactions',
  '--turn-times',
]);
if (!file || !Modes.has(mode)) {
  console.error(
    'usage: extract-transcript.mjs <session.jsonl> [--count-only|--compactions|--turn-times]',
  );
  process.exit(1);
}

const NoiseMarkers = [
  '<system-reminder>',
  '<command-name>',
  '<local-command',
  '<task-notification>',
  '<command-message>',
];

const textOf = (content) =>
  typeof content === 'string'
    ? content
    : (content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

const human = [];
const assistant = [];
const toolInputs = [];
const diffs = [];
const turnTimes = [];
let turns = 0;
let compactions = 0;

const lines = createInterface({
  input: createReadStream(file),
  crlfDelay: Infinity,
});

for await (const line of lines) {
  let entry;
  // A malformed line must never abort extraction - this is a recovery tool.
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
    compactions += 1;
    continue;
  }

  const content = entry?.message?.content;

  if (entry.type === 'user') {
    const text = textOf(content);
    if (text && !NoiseMarkers.some((marker) => text.includes(marker))) {
      human.push(text);
    }
    continue;
  }

  if (entry.type !== 'assistant' || entry.isSidechain) continue;
  turns += 1;
  turnTimes.push(entry.timestamp ?? '');

  for (const block of content ?? []) {
    if (block.type === 'text') {
      assistant.push(block.text);
    } else if (block.type === 'tool_use') {
      const input = JSON.stringify(block.input);
      if (block.name === 'Edit' || block.name === 'Write')
        diffs.push(input.slice(0, 1000));
      else toolInputs.push(`${block.name} ${input}`.slice(0, 300));
    }
  }
}

if (mode === '--count-only') {
  console.log(turns);
} else if (mode === '--compactions') {
  console.log(compactions);
} else {
  console.log('== TURNS ==');
  console.log(turns);
  console.log('== COMPACTIONS ==');
  console.log(compactions);
  console.log('== HUMAN ==');
  console.log(human.join('\n'));
  console.log('== ASSISTANT ==');
  console.log(assistant.join('\n'));
  console.log('== TOOL INPUTS ==');
  console.log(toolInputs.join('\n'));
  console.log('== DIFFS ==');
  console.log(diffs.join('\n'));
  // Opt-in: the default output is a stable contract for the /handoff guard.
  if (mode === '--turn-times') {
    console.log('== TURN TIMES ==');
    console.log(turnTimes.join('\n'));
  }
}
