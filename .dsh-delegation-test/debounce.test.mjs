import test from 'node:test';
import assert from 'node:assert/strict';
import { debounce } from './debounce.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('does not fire before the delay elapses', async () => {
  const calls = [];
  const fn = debounce((x) => calls.push(x), 40);
  fn(1);
  await sleep(20);
  assert.deepEqual(calls, [], 'callback must not have fired at 20ms of a 40ms delay');
  await sleep(40);
  assert.deepEqual(calls, [1], 'callback fires after the delay elapses');
});

test('rapid calls collapse into one invocation carrying the last args', async () => {
  const calls = [];
  const fn = debounce((a, b) => calls.push([a, b]), 30);
  fn('a', 1);
  await sleep(5);
  fn('b', 2);
  await sleep(5);
  fn('c', 3);
  await sleep(10);
  fn('d', 4);
  await sleep(60);
  assert.equal(calls.length, 1, 'exactly one invocation expected');
  assert.deepEqual(calls[0], ['d', 4], 'invocation must carry the last call\'s arguments');
});

test('.cancel() prevents a pending invocation', async () => {
  const calls = [];
  const fn = debounce((x) => calls.push(x), 40);
  fn(7);
  await sleep(10);
  fn.cancel();
  await sleep(60);
  assert.deepEqual(calls, [], 'cancelled invocation must not fire');
});
