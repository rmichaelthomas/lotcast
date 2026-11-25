// public/verify.gub is git-ignored, so a deploy has to build it. This fails if the deploy path can skip that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('../deploy/cloudflare/package.json', 'utf8'));

test('npm run deploy builds verify.gub (and tests it) before wrangler deploy', () => {
  assert.match(pkg.scripts.predeploy ?? '', /guion build verify\.gu/);
  assert.match(pkg.scripts.predeploy, /public\/verify\.gub/);
  assert.match(pkg.scripts.predeploy, /node --test/);
  assert.match(pkg.scripts.deploy, /wrangler deploy/);
});

test('the deploy instructions name npm run deploy, not a bare wrangler deploy', async () => {
  for (const file of ['../docs/operations.md', '../deploy/cloudflare/README.md']) {
    const text = await readFile(file, 'utf8');
    assert.match(text, /npm run deploy/, file);
    assert.match(text, /guion build verify\.gu/, file);
    assert.doesNotMatch(text, /`npx wrangler deploy`/, file);
  }
});
