// What makes the page findable and its sources reachable: outbound links, social and search metadata,
// robots/sitemap, and the words around the page in the README and llms.txt.
// node --test discoverability.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile('public/index.html', 'utf8');
const readme = await readFile('../README.md', 'utf8');
const llms = await readFile('public/llms.txt', 'utf8');
const SITE = 'https://lotcast.thomasbuild.workers.dev';
const REPO = 'https://github.com/rmichaelthomas/lotcast';
const GUION = 'https://rmichaelthomas.github.io/guion/';

const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
const linksTo = (url) => anchors.filter((a) => a.includes(`href="${url}"`));
const meta = (attr, name) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1];

test('the header and the footer both link to the GitHub repo', () => {
  assert.ok(linksTo(REPO).length >= 2, `found ${linksTo(REPO).length}`);
  assert.match(html, /<nav aria-label="Main">[\s\S]*?href="https:\/\/github\.com\/rmichaelthomas\/lotcast"[\s\S]*?<\/nav>/);
  assert.match(html, /<footer[\s\S]*?href="https:\/\/github\.com\/rmichaelthomas\/lotcast"[\s\S]*?<\/footer>/);
});

test("the footer links to Guion's page, the issue tracker, llms.txt and the operator's key", () => {
  const footer = html.match(/<footer[\s\S]*?<\/footer>/)[0];
  for (const href of [GUION, `${REPO}/issues`, '/llms.txt', '/operator-key.txt']) {
    assert.ok(footer.includes(`href="${href}"`), `the footer has no link to ${href}`);
  }
});

test('every outbound link opens safely', () => {
  for (const a of anchors.filter((a) => /href="https?:\/\//.test(a))) assert.match(a, /rel="noopener"/, a);
});

test('AllHereHTML is not linked while its repository is private', () => {
  assert.doesNotMatch(anchors.join('\n'), /allherehtml/i);
});

test('search and sharing metadata is complete and points at the live site', () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/lotcast\.thomasbuild\.workers\.dev\/">/);
  assert.equal(meta('property', 'og:type'), 'website');
  assert.equal(meta('property', 'og:site_name'), 'Lotcast');
  assert.equal(meta('property', 'og:url'), `${SITE}/`);
  assert.match(meta('property', 'og:title'), /Lotcast/);
  assert.ok(meta('property', 'og:description')?.length > 40);
  assert.equal(meta('property', 'og:image'), `${SITE}/social.png`);
  assert.ok(meta('property', 'og:image:alt')?.length > 40);
  assert.equal(meta('name', 'twitter:card'), 'summary_large_image');
  assert.equal(meta('name', 'theme-color'), '#12102a');
});

test('the structured data is valid JSON and describes a free web app with its source', () => {
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(raw, 'no JSON-LD');
  const data = JSON.parse(raw);
  assert.equal(data['@type'], 'WebApplication');
  assert.equal(data.url, `${SITE}/`);
  assert.equal(data.isAccessibleForFree, true);
  assert.ok(data.sameAs.includes(REPO));
});

test('the social preview image is a 1200 by 630 PNG', async () => {
  const png = await readFile('public/social.png');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(png.byteLength < 300 * 1024, `${png.byteLength} bytes`);
});

test('robots.txt allows crawling and names the sitemap, which lists the page', async () => {
  const robots = await readFile('public/robots.txt', 'utf8');
  assert.match(robots, /^User-agent: \*$/m);
  assert.doesNotMatch(robots, /^Disallow: *\/\s*$/m);
  assert.match(robots, new RegExp(`^Sitemap: ${SITE}/sitemap\\.xml$`, 'm'));
  const sitemap = await readFile('public/sitemap.xml', 'utf8');
  assert.match(sitemap, new RegExp(`<loc>${SITE}/</loc>`));
});

test('a visitor without JavaScript is told why and pointed to the command line', () => {
  const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1];
  assert.ok(noscript, 'no <noscript>');
  assert.match(noscript, /JavaScript/);
  assert.match(noscript, new RegExp(REPO.replace(/\//g, '\\/')));
});

test('the README leads with the page and no longer calls Guion 0.8.0', () => {
  assert.match(readme, /Make a draw in your browser \(nothing to install\)/);
  assert.match(readme, /^## Make a draw \(no install\)$/m);
  assert.match(readme, /^## Make a draw from the command line$/m);
  assert.doesNotMatch(readme, /0\.8\.0/);
});

test('llms.txt says a draw can be made in the browser', () => {
  assert.match(llms, /Browser: make a draw at https:\/\/lotcast\.thomasbuild\.workers\.dev/);
});
