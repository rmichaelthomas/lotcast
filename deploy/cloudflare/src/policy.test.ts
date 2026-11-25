// Run with: npm test (node's own test runner; the policy is plain functions, no Cloudflare needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideIdle, forwardedHeaders, storeRoute, tooLarge, STATUS_FAILURES_BEFORE_STOP } from './policy.ts';

const IDLE = 30 * 60 * 1000;

test('a quiet container with nothing pending is stopped', () => {
  assert.equal(decideIdle({ quietMs: IDLE + 1, idleMs: IDLE, pending: 0, failedChecks: 0 }), 'stop');
});
test('a container with a pending draw is kept, however quiet', () => {
  assert.equal(decideIdle({ quietMs: IDLE * 10, idleMs: IDLE, pending: 2, failedChecks: 0 }), 'keep');
});
test('a recent request keeps the container', () => {
  assert.equal(decideIdle({ quietMs: 1000, idleMs: IDLE, pending: 0, failedChecks: 0 }), 'keep');
});
test('a status call that failed is not read as "nothing pending"', () => {
  assert.equal(decideIdle({ quietMs: IDLE * 2, idleMs: IDLE, pending: null, failedChecks: 1 }), 'keep');
});
test('a service that cannot be asked many checks in a row is stopped (it is broken)', () => {
  assert.equal(decideIdle({ quietMs: IDLE * 2, idleMs: IDLE, pending: null, failedChecks: STATUS_FAILURES_BEFORE_STOP }), 'stop');
});

test('the store route accepts only /f /e /l with a clean path', () => {
  assert.deepEqual(storeRoute('/f/log/checkpoint'), { route: 'f', path: 'log/checkpoint' });
  assert.deepEqual(storeRoute('/l/draws'), { route: 'l', path: 'draws' });
  assert.equal(storeRoute('/fx/a'), null);
  assert.equal(storeRoute('/f/'), null);
  assert.equal(storeRoute('/f/a/../b'), null);
  assert.equal(storeRoute('/f/a//b'), null);
  assert.equal(storeRoute('/f/a b'), null);
});
test('a malformed percent escape is a bad path, not a crash', () => {
  assert.equal(storeRoute('/f/%E0%A4%A'), null);
});

test('the caller address replaces whatever the client sent', () => {
  const h = forwardedHeaders(new Headers({ 'x-forwarded-for': '6.6.6.6', 'cf-connecting-ip': '1.2.3.4' }));
  assert.equal(h.get('x-forwarded-for'), '1.2.3.4');
});
test('without a Cloudflare address no forwarded-for from the client is trusted', () => {
  const h = forwardedHeaders(new Headers({ 'x-forwarded-for': '6.6.6.6' }));
  assert.equal(h.get('x-forwarded-for'), null);
});

test('a file too big for one database row is refused', () => {
  assert.equal(tooLarge(1024), false);
  assert.equal(tooLarge(1_900_000), true);
});
