import assert from 'node:assert/strict';
import { parseVoiceBoardCommand } from '../src/whiteboard/voice.ts';

let pass = 0;
const t = (name: string, fn: () => void) => {
  try { fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.log(`  FAIL ${name}: ${(e as Error).message}`); process.exitCode = 1; }
};

t('ordinary lesson talk is ignored', () => {
  assert.equal(parseVoiceBoardCommand('Add the numerators after you find the LCD.'), null);
});

t('show the whiteboard', () => {
  assert.equal(parseVoiceBoardCommand('Athena, show the whiteboard').action, 'show');
});

t('write on the board', () => {
  const r = parseVoiceBoardCommand('Write LCD of 2 and 3 is 6 on the board');
  assert.equal(r?.action, 'write');
  assert.equal(r?.text, 'LCD of 2 and 3 is 6');
});

t('clear the board', () => {
  assert.equal(parseVoiceBoardCommand('Clear the whiteboard please').action, 'clear');
});

t('hide the board', () => {
  assert.equal(parseVoiceBoardCommand('Hide the board').action, 'hide');
});

console.log(`\n${pass} passing`);
if (process.exitCode) process.exit(process.exitCode);
