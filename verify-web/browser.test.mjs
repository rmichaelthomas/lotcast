// Runs the built checker in Guion's own browser VM (the one the page uses) and compares it with the
// native tests: node --test browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadModules, run } from './public/loader.mjs';

const STEPS = 5000000; // the page's budget (public/index.html)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const vm = await readFile('public/guion_vm.wasm');
const artifact = new Uint8Array(await readFile('public/verify.gub'));
const modules = await loadModules(null, vm);
const key = (await readFile('fixtures/anchored-operator-key.hex', 'utf8')).trim();

function check(receipt, operatorKey = key) {
  const out = run(modules, artifact, { steps: STEPS, allowRaisedSteps: true }, { entry: 'verify_page', arguments: [receipt, operatorKey] });
  assert.equal(out.ok, true, JSON.stringify(out));
  return { ...JSON.parse(out.value), steps: out.steps };
}

test('the vendored VM is the one Guion published (size and SHA-256 from wasm.build.json)', async () => {
  const manifest = JSON.parse(await readFile('public/wasm.build.json', 'utf8')).files['guion_vm.wasm'];
  assert.equal(vm.byteLength, manifest.bytes);
  assert.equal(sha(vm), manifest.sha256);
});

test('the vendored loader is the pinned one', async () => {
  assert.equal(sha(await readFile('public/loader.mjs')), (await readFile('VENDOR.sha256', 'utf8')).match(/^(\w+)\s+loader\.mjs/m)[1]);
});

test('the built checker in public/ is what guion build makes from verify.gu', async () => {
  execFileSync('guion', ['build', 'verify.gu'], { stdio: 'ignore' });
  const fresh = await readFile('verify.gub');
  await rm('verify.gub');
  assert.equal(sha(fresh), sha(artifact), 'run: guion build verify.gu && cp verify.gub public/verify.gub');
  assert.ok(artifact.byteLength < 1024 * 1024);
});

test('a verified receipt is verified in the browser VM, well inside the step budget', async () => {
  const a = check(await readFile('fixtures/anchored-receipt.json', 'utf8'));
  assert.equal(a.verdict, 'verified');
  assert.ok(a.steps < STEPS / 10, `${a.steps} steps`);
});

test('a receipt with an idle source is verified-pending-live and names it', async () => {
  const a = check(await readFile('fixtures/anchored-receipt-all-sources.json', 'utf8'));
  assert.equal(a.verdict, 'verified-pending-live');
  assert.match(a.detail, /curby-q/);
  assert.ok(a.steps < STEPS / 10, `${a.steps} steps`);
});

test('a changed outcome is invalid at step 5', async () => {
  const original = await readFile('fixtures/anchored-receipt.json', 'utf8');
  const changed = original.replace('"hexagram":', '"hexagram":9');
  assert.notEqual(changed, original);
  const a = check(changed);
  assert.equal(a.verdict, 'invalid');
  assert.equal(a.failed_step, 5);
  assert.match(a.detail, /^It failed at step 5, the outcome: /);
});

test('the page never headlines a receipt with a live check owed as verified', async () => {
  const page = await readFile('public/index.html', 'utf8');
  const headline = /'verified-pending-live': \['pending', '([^']*)'\]/.exec(page);
  assert.ok(headline, 'the pending-live headline is in the page');
  assert.doesNotMatch(headline[1], /^verified/i);
  assert.match(headline[1], /not fully checked/i);
});

test('the wrong operator key is invalid at step 1', async () => {
  const a = check(await readFile('fixtures/anchored-receipt.json', 'utf8'), `ff${key.slice(2)}`);
  assert.equal(a.verdict, 'invalid');
  assert.equal(a.failed_step, 1);
});

test('text that is not JSON gives a clear answer, not a crash', () => {
  const a = check('this is not a receipt');
  assert.equal(a.verdict, 'unreadable');
  assert.match(a.detail, /JSON/);
});
