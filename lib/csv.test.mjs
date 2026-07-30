import assert from 'node:assert/strict';
import test from 'node:test';
import { toCsv } from './csv.ts';

test('escapes quotes and spreadsheet formulas', () => {
  const csv = toCsv([{ name: 'Gabut "Race"', owner: '=1+1', hidden: '\t@SUM(A1:A2)' }]);
  assert.equal(csv, '"name","owner","hidden"\r\n"Gabut ""Race""","\'=1+1","\'\t@SUM(A1:A2)"');
});
