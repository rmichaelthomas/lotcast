# Operating the Lotcast service

`lotcast serve` is one Guion process of four jobs that share nothing but files: the HTTP workers, the
**writer** (the only appender to the log), the **stamper** (two RFC 3161 timestamps per epoch) and the
**watcher** (completes receipts). Everything lives under `--data-dir`.

## The data directory

| Path | Written by | What it holds |
|---|---|---|
| `inbox/<id>.json` | HTTP handlers | a validated request waiting for the writer |
| `draws/<id>.json` | writer | the request, its index, promise, epoch and deadline (never changed after) |
| `state/open.json` | writer | the intent of the open epoch (`{epoch, deadline, ids}`), written before an append |
| `epochs/<e>.json` | writer | the epoch's final checkpoint and every entry's inclusion proof |
| `anchors/<e>.json` | stamper | the two timestamps, or `void: true` |
| `status/<id>.json`, `receipts/<id>.json`, `active/<id>.json` | watcher (marker: writer) | what a draw waits on; the finished receipt; a marker the watcher scans until the draw is finished |
| `state/sources.json`, `state/rate/`, `state/rate_salt` | watcher, handlers | the source and pin snapshot; per-client request windows (files named by a salted hash, deleted a minute after the client's last request); the secret that keys those names |
| `state/operator_key.hex` | startup | the operator's **public** key |
| `log/` | writer, stamper | the tlog-tiles log, served at `/v1/log/…`: `checkpoint`, `tile/…`, `epoch/<e>` and `epoch/index` (each closed epoch's checkpoint), `anchor/<e>.json` |

Back up the whole directory; `log/` and `draws/` are the part that cannot be recreated. Mirrors only
need `log/`, which is plain static files.

## Epochs and anchoring

`epoch = unix seconds // --epoch-seconds` (default 5) and an epoch's deadline is
`(epoch + 1) * epoch_seconds + --stamp-budget` (default 20 s). The writer promises each request an index
the moment it takes it from the inbox (the log size when the epoch opened plus its place in the epoch) and
appends the whole epoch in **one batch** when the epoch ends, so the log has exactly one signed checkpoint
per epoch: `lotcast/epoch <e> <deadline>`, signed before anything is stamped. The stamper then needs both
timestamps to prove that checkpoint existed by the deadline. An epoch that cannot, or that is found with its
deadline already past, is **void** without asking an authority: its draws answer `anchor-failed`, the void
checkpoint stays in the log, and clients resubmit with a new nonce (the same nonce returns the same void
draw). Every void epoch writes an `ALERT:` line.

If one authority fails for more than 10 minutes the stamper uses `{the working one} + FreeTSA`; when both
defaults look down it tries them anyway. While no epoch is waiting it asks each failing authority once a
minute whether it answers again, and clears it when it does, so a short outage never leaves the service on
FreeTSA for good.

If the process is killed, restart it on the same directory: `state/open.json` (written before any
promise), the inbox and the log finish the open epoch without losing or repeating an entry. Draw records
are rebuilt (indexes are deterministic and signatures are too), and an append that already happened is
recognised, not repeated. An epoch recovered after its deadline is closed and then voids. A clock that
steps back into a closed epoch does not reopen it; its requests wait for the next one.

## The operator key

Give it as `--key-file FILE` (64 hex characters, `--new-key` creates the file) or as the
`LOTCAST_OPERATOR_KEY` environment variable. It is never printed, logged or put in a receipt. The public
key is written to `state/operator_key.hex`, printed once on stderr and served at `GET /v1/operator`.
Publish it somewhere clients can pin it. Rotating the key means a new log and a new origin: freeze the
old log, cross-sign its last checkpoint, and keep serving old receipts.

## Pinning the operator key for MCP clients

`lotcast mcp` takes the service's operator key from `GET /v1/operator` the first time it talks to a server and
pins it in `pinned.json`; a different key later is refused with `E_KEY_CHANGED`. For anything that matters, put the
key you got from the operator out of band in the client's `config.json` (`"operator_key": "HEX"`) before the first
draw. After a deliberate key rotation, delete the server's entry from `pinned.json`.

## Pins

`GET /v1/sources` lists each beacon's latest pulse and every pinned certificate's days left. The watcher
logs an `ALERT:` line once a day for a pin that is expiring (under 30 days), expired or unreadable.
Replace a TSA pin with `packages/lotcast-log/scripts/fetch_tsa_fixtures.sh` and
`guion run --file-root . scripts/gen_tsa_pins.gu`; the NIST certificates follow the `beacons` README.

## Limits and privacy

60 `POST /v1/draws` per minute per client, a 64 KiB body, `not_before` at most 400 days ahead. Guion gives
a server no peer address, so the client is named only by the proxy in front: run behind one and pass
`--trust-proxy N` (the Nth entry from the right of `X-Forwarded-For`). With `--trust-proxy 0` every
request shares one bucket. A request carries no question text, IP address or account, and the service
writes no access log; delete anything your host keeps after 24 hours.

## Deploying on Cloudflare

Lotcast runs as one Worker with one container, at `https://lotcast.thomasbuild.workers.dev` (the address
Cloudflare assigns). `/` is the checking page, `/v1/...` is the service. Needs the Workers Paid plan and
Docker on the machine that deploys.

- **Where the log lives.** A container's own disk is erased whenever it stops, and R2 mounted as a disk
  only imitates the rename and lock behaviour the signed log needs. So the service writes every file
  through a small file layer (`packages/lotcast-log/src/vfs.gu`), and on Cloudflare that layer talks to
  the Worker's `/internal/store/` route, which keeps the files in the Durable Object's SQLite database.
  The route needs a token derived from the operator key; nobody else can read or write it.
- **Deploy** (from `deploy/cloudflare`): `npm install`, `npx wrangler deploy`. Changing the code does not
  replace a running container; it takes the new image the next time it starts.
- **The operator key** is the Worker secret `LOTCAST_OPERATOR_KEY` (64 hex characters, the Ed25519 seed).
  Set it with `printf '%s' "$SEED" | npx wrangler secret put LOTCAST_OPERATOR_KEY`. A secret cannot be read
  back, so keep the seed somewhere safe too: if it is lost, the log's identity is lost. The public half
  is at `GET /v1/operator`, in the README, and on the checking page (`verify-web/public/operator-key.txt`).
- **Backup.** `lotcast backup` copies the whole store (the log, the draws, the receipts) from the Durable
  Object to a folder on your machine, and is safe to run again any time:
  `cd cli && guion run --file-root ~/.lotcast --allow-http-host lotcast.thomasbuild.workers.dev lotcast.gu backup --server https://lotcast.thomasbuild.workers.dev --key-file operator-seed.hex --to backup`.
  The seed file is used only to derive the token the Worker checks and is never sent; the rate-limit files
  are not copied; the copy holds no secret, but keep it private anyway (it has every question hash and
  receipt). A receipt in the copy verifies with `lotcast verify`. Cloudflare's point-in-time recovery for
  SQLite Durable Objects is a second safety net. Keep the operator seed itself somewhere safe too (see above).
- **Stopping.** The container gets SIGTERM; the service catches it (`signal_loop` in `service/src/loops.gu`),
  writes `state/stop`, and the writer, stamper and watcher loops finish their current step and return, so none is cut
  off mid-step. The HTTP server has no way to stop (Guion's web package has none), so after ten seconds the Durable
  Object kills the process. The marker is cleared at the next start.
- **Idle.** The Durable Object checks on every alarm (every few minutes while the container runs) and stops
  the container after 30 minutes (`IDLE_MINUTES`) without an outside request, but not while `GET /v1/status`
  reports a pending draw. If the service cannot be asked, the container is kept (it is stopped only after five
  checks in a row fail). While it is being stopped, new requests wait and then meet a fresh container, so no
  draw is accepted by a container about to go. If the container exits with draws pending, the Durable Object
  starts it again. `GET /internal/diag` (bearer token, as for the store) shows `lastSeen`, `lastAlarm`,
  `lastCheck` and `outcome` (what the last check decided).
- **Log origin.** The log's origin line is `lotcast.local/log`. A C2SP origin is only a unique name, not an
  address, and it is inside every signed checkpoint, so changing it would break the existing log; leave it.
- **Store outages.** A server error from the store is retried for up to ten minutes, and an existence check
  waits until the store gives a real answer, so a redeploy cannot make the service believe a record is missing. A draw that was cut off anyway is finished on the next wake.
- **Logs.** `npx wrangler tail` shows the Worker. The container's own output is in the dashboard under
  the Worker's container.
- **Try it locally** (needs Docker): `deploy/cloudflare/README.md`.

## API codes

Errors are `{"error": {"code", "message"}}`. Beyond the codes in the spec (`E_REQUEST`, `E_COUNT`,
`E_SOURCES`, `E_METHOD_PENDING`, `E_TOO_LARGE`, `E_RATE`, `E_NOT_FOUND`), the service answers `E_BUSY` (503,
only if the request could not even be queued), `E_INTERNAL` (500), `E_TLOCK_UNSUPPORTED` (400, timelocked
questions are not supported yet) and, inside a draw, `E_ANCHOR_FAILED`. `POST /v1/draws` answers 202 with
the promise when the writer has taken the request (or 202 with `waiting_on: log` when it has only queued it),
and 200 for a request that is already complete or void.

## Known limits

- The 64 KiB request limit is checked after the web package has read the body (it reads up to 1 MiB);
  Guion's server does not let a handler refuse a body unread.
- `POST /v1/verify` takes up to 256 KiB (a receipt with its tokens is larger than a draw request) and shares
  the 60-a-minute per-client limit.
- The log append and the epoch index are linear in the log's size per epoch, and `lotcast compute` and
  `audit` fetch the epoch checkpoints they need (a binary search for `compute`, all of them for `audit`).
- The watcher makes its network calls one after another; a source host that hangs delays the pass until
  the host's timeout. Draw requests and the log are not affected (the writer and stamper are separate jobs).
- `lotcast compute` rejects a void epoch and an epoch whose timestamps do not hold, but the log does not
  itself commit to which epoch holds which entry: a mirror that drops an epoch from `epoch/index` is caught
  by `audit` against another mirror, not by `compute` alone. Binding each epoch's checkpoint to the previous
  epoch's size is a spec change.
