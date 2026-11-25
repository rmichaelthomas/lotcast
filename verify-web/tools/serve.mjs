// A local preview of the draw page: serves public/ on http://127.0.0.1:8787 and forwards /v1/* to the
// service, so the page behaves as it will at its own origin.   node tools/serve.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const upstream = (process.env.LOTCAST_SERVER ?? 'https://lotcast.thomasbuild.workers.dev').replace(/\/$/, '');
const port = Number(process.env.PORT ?? 8787);
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.gub': 'application/octet-stream' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname.startsWith('/v1/')) {
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(await req.toArray());
    const headers = body ? { 'content-type': req.headers['content-type'] ?? 'application/json' } : {};
    try {
      const r = await fetch(upstream + url.pathname + url.search, { method: req.method, headers, body });
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'E_UPSTREAM', message: String(e.message ?? e) } }));
    }
    return;
  }
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, rel.endsWith('/') ? `${rel}index.html` : rel);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(bytes);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`serving on http://127.0.0.1:${port}`));
