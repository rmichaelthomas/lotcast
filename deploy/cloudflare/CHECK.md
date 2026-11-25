# Does the storage keep the log? (Task 1)

## Local disk (done 2026-11-24)

- `check/fs_check.gu` on a local directory: atomic overwrite x200, lock directory, list directory, signed log (100 entries, reopened): all `ok`.
- The service image (`service/Dockerfile`, linux/amd64) builds (it needed a `.dockerignore` so the host's `.guion` cache is not copied in) and runs. A drand-only `lotcast draw` against it came back `verified`; after `docker restart` the same receipt came back from `lotcast get`, and the next draw got the next index.

## R2 mounted at /data

Not run yet: it needs a scratch R2 bucket (`lotcast-check`) in Rob's Cloudflare account.

## Worker and container, run locally with `wrangler dev` (2026-11-24)

- `/` serves the checking page; `/v1/...` reaches the container through the Durable Object; `GET /v1/status` answers `{"pending":N}`.
- A drand-only `lotcast draw` through the Worker came back `verified`; a two-source draw (drand and NIST) stayed pending, then completed.
- **Not verifiable locally:** `wrangler dev` never stopped the container, with or without the "stay awake while a draw is pending" code, even after the idle timer (20 s) had long passed. So that behaviour is unproven until it is tried on Cloudflare (Task 3).
