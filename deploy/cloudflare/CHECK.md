# Does the storage keep the log? (Task 1)

## Local disk (done 2026-11-24)

- `check/fs_check.gu` on a local directory: atomic overwrite x200, lock directory, list directory, signed log (100 entries, reopened): all `ok`.
- The service image (`service/Dockerfile`, linux/amd64) builds (it needed a `.dockerignore` so the host's `.guion` cache is not copied in) and runs. A drand-only `lotcast draw` against it came back `verified`; after `docker restart` the same receipt came back from `lotcast get`, and the next draw got the next index.

## R2 mounted at /data

Not run, and no longer needed. R2 over FUSE needs S3-style access tokens, which `wrangler`'s own login
cannot create, and the plan's fallback applies anyway: the log's files live in the Durable Object's SQLite
database behind the Worker's `/internal/store/` route (`packages/lotcast-log/src/vfs.gu`). The scratch
bucket `lotcast-check` exists in the account and is unused.

## Decision (2026-11-24): Durable Object storage

Checked on Cloudflare itself, not just locally:

- A draw made, the container restarted by Cloudflare: the earlier receipt still verified and the next draw got the next index.
- The idle logic stops the container (alarm check, `GET /v1/status` pending 0, quiet longer than `IDLE_MINUTES`). The service is process 1 in the container and handles SIGTERM itself (its HTTP server finishes the requests it is handling and returns, and its loops stop), so the container exits on its own; the Durable Object waits up to ten seconds and kills it only as a fallback. That check was made with Guion 0.8, whose HTTP server could not stop, so the Durable Object had to kill it; with 0.9.0 the service exits by itself (confirm `outcome` says `stopped` in `/internal/diag` after the next deploy). After the kill, the next request woke it and the next draw was index 5 and verified: nothing was lost.
- `lastSeen`, `lastAlarm`, `lastCheck` and `outcome` at `GET /internal/diag` (bearer token) show what the idle logic last did.

## Worker and container, run locally with `wrangler dev` (2026-11-24)

- `/` serves the checking page; `/v1/...` reaches the container through the Durable Object; `GET /v1/status` answers `{"pending":N}`.
- A drand-only `lotcast draw` through the Worker came back `verified`; a two-source draw (drand and NIST) stayed pending, then completed.
- **Not verifiable locally:** `wrangler dev` never stopped the container, with or without the "stay awake while a draw is pending" code, even after the idle timer (20 s) had long passed. So that behaviour is unproven until it is tried on Cloudflare (Task 3).
