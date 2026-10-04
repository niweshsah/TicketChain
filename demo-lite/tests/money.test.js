import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rupeesToPaise as toPaise } from '../src/lib/money.js';

test('rupee strings convert exactly to paise', () => {
  assert.equal(toPaise('123.45'), 12345);
  assert.equal(toPaise('1.29'), 129);
  assert.equal(toPaise('1.2'), 120);
  for (const invalid of ['1.001', '-2', '1e3', 'NaN', '', '1000001'])
    assert.throws(() => toPaise(invalid));
});
