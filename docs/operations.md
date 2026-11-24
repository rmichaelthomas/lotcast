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
| `status/<id>.json`, `receipts/<id>.json` | watcher | what a draw waits on; the finished receipt |
| `state/sources.json`, `state/rate/` | watcher, handlers | the source and pin snapshot; per-client request windows |
| `state/operator_key.hex` | startup | the operator's **public** key |
| `log/` | writer, stamper | the tlog-tiles log, served at `/v1/log/…`: `checkpoint`, `tile/…`, `epoch/<e>` and `epoch/index` (each closed epoch's checkpoint), `anchor/<e>.json` |

Back up the whole directory; `log/` and `draws/` are the part that cannot be recreated. Mirrors only
need `log/`, which is plain static files.

## Epochs and anchoring

`epoch = unix seconds // --epoch-seconds` (default 5) and an epoch's deadline is
`(epoch + 1) * epoch_seconds + --stamp-budget` (default 20 s). Both are signed into every checkpoint of the
epoch (`lotcast/epoch <e> <deadline>`) before anything is stamped. The writer closes an epoch when its
time is up; the stamper then needs both timestamps to prove the checkpoint existed by the deadline. An
epoch that cannot is **void**: its draws answer `anchor-failed`, the void checkpoint stays in the log,
and clients resubmit with a new nonce. If one authority fails for more than 10 minutes the stamper uses
`{the working one} + FreeTSA`.

If the process is killed, restart it on the same directory: the intent file, the inbox and the log are
enough to finish the open epoch (or drop it and move its requests to a later one if its deadline is too
close to stamp), without losing or repeating an entry.

## The operator key

Give it as `--key-file FILE` (64 hex characters, `--new-key` creates the file) or as the
`LOTCAST_OPERATOR_KEY` environment variable. It is never printed, logged or put in a receipt. The public
key is written to `state/operator_key.hex`, printed once on stderr and served at `GET /v1/operator`.
Publish it somewhere clients can pin it. Rotating the key means a new log and a new origin: freeze the
old log, cross-sign its last checkpoint, and keep serving old receipts.

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

## Deploying on Railway

`service/railway.toml` and `service/Dockerfile` build the image from the repository root. Attach a volume
at `/data`, set `LOTCAST_OPERATOR_KEY` as a secret, and generate a domain. Sync `log/` to a public bucket
for mirrors if you want one.
