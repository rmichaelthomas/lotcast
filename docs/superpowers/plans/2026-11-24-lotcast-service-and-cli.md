# Lotcast Service and CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native execution, one Opus whole-branch review at the end). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running draw service: `lotcast serve` takes requests over HTTP, logs them, anchors every epoch with two timestamp authorities, watches the beacons, completes receipts, and serves the log as static tiles; the `lotcast` CLI draws, fetches, verifies, computes and audits against it.

**Architecture:** A new `service/` package depends on `lotcast-core`, `lotcast-log` and Guion's `web` package. One process holds the log (single writer, the existing lock). Three loops share it: HTTP workers, an epoch loop (checkpoint, deadline, two stamps) and a watcher (resolves sources after each draw's `t0`, builds the receipt). If Task 1 shows Guion cannot run the loops beside `serve` in one process, the loops run as a second `lotcast run` process on the same volume, coordinated through the log's writer lock and the per-draw files; the HTTP surface and receipts do not change. A `cli/` package is the one `lotcast` entry script.

**Tech Stack:** Guion 0.8.0 (`web` 0.2.0 from the registry, `std:http_static`, `std:crypto`, `parallel_map`, `sleep_ms`, `write_text_atomic`), `lotcast-core`, `lotcast-log`.

**Spec:** `/Users/rmichaelthomas/hunchery/docs/explore/agent-divination-tools/03-draw-service-design.md` §3.1 to §3.4, §5.2, §8.1, §8.3, §9, §12. Previous plans: `2026-11-23-lotcast-core-first-slice.md`, `2026-11-24-lotcast-log-and-anchored-receipts.md` (read its "Amendments" section: the anchor is the signed deadline).

## Global Constraints

- Errors are `{"error": {"code": "E_…", "message": "…"}}` with stable codes: `E_REQUEST`, `E_COUNT`, `E_TLOCK_ROUND`, `E_SOURCES`, `E_METHOD_PENDING`, `E_RATE`, `E_TOO_LARGE`, `E_NOT_FOUND`, `E_ANCHOR_FAILED`.
- Limits: 60 draws per minute per IP; request body at most 64 KiB (65536 bytes; exactly 65536 accepted, 65537 refused unread); `not_before` at most 400 days ahead. Epoch length `E` defaults to 5 s (`--epoch-seconds`).
- A draw request is `{tradition, method, options, commitment?, sources?, not_before?, nonce}` and nothing else: no question text, no IP address, no account is stored in the log, the store or any file. Access logs are kept at most 24 hours.
- Promise: `{index, entry_hash, epoch}` signed by the operator; the receipt's entry must match it. A duplicate entry returns the original draw, never a second one.
- Anchor: `g = deadline` signed into the checkpoint; an epoch anchors only if both tokens prove existence by the deadline, else it is void (`anchor-failed`, entries may be resubmitted with a new nonce, the void checkpoint stays in the log). If one TSA is down more than 10 minutes, later epochs use `{working TSA} + FreeTSA`.
- A draw is `pending` or `complete`; there is no failed state except the void epoch above. Sources: `drand-quicknet` always, others optional; a source with no pulse in its window is recorded as absent, not an error.
- The operator's key is read from a file or the `LOTCAST_OPERATOR_KEY` environment value (granted), never printed, never logged, never in a receipt or an error.
- Everything is Guion. The only Python is `reference/python/` (the independent verifier the spec requires, excluded from language statistics in `.gitattributes`); the maintenance tools were ported to Guion before this plan (`tools/*.gu`, `packages/lotcast-log/scripts/gen_tsa_pins.gu`). Any new script is Guion; a script that Guion cannot do is reported as a Guion gap, not written in Python. Guion limits from earlier slices still bind (immutable records, no multi-line list literals, no `..` in imports, `set` for assignment, a statement must be a call).
- Every change to `lotcast-core` or `lotcast-log` is followed by `guion update` in the dependent package.

## Review Focus

- Two clients post the same request (same entry) at once, or one request twice across an epoch boundary: one draw, one index, the original promise both times.
- The process is killed between the log append and the promise, or between the checkpoint and the stamps: on restart nothing is lost, no entry is dropped or duplicated, the epoch either anchors or is void.
- The epoch loop stalls (TSA hangs): pending draws stay pending, `GET /draws/{id}` names what it waits on, and the HTTP workers are not blocked.
- A void epoch: its entries answer `anchor-failed`, the same request resubmitted with a new nonce draws normally, and the void checkpoint is in `/log/checkpoint` history.
- Rate limit and body limit are per request and cannot be bypassed by a header the client controls (no `X-Forwarded-For` trust unless a configured proxy count says so).
- A `not_before` in the past or at the boundary (exactly 400 days) and a draw whose source window is still open when the service restarts.
- `/log/tile/…` paths cannot escape the log directory and serve tiles byte-identical to what `lotcast-log` wrote.

---

### Task 1: Process model spike and the service skeleton

**Files:**
- Create: `service/guion.toml`, `service/src/lib.gu`, `service/src/config.gu`, `service/tests.gu`, `service/SPIKE.md` (deleted at the end of the task once its answer is in `service/README.md`)

**Interfaces:**
- Produces: `Config{host, port, data_dir, key_source, epoch_seconds, origin, workers, trust_proxy}` and `config_from_args(args: List[Text]) -> Result[Config, StdError]`; the process-model answer: one process or two.

- [ ] **Step 1:** Spike: a script that runs `serve` on a loopback port with `parallel_map` and, as another job of the same call, a loop that sleeps and writes a counter file; hit the port while the loop runs. Record whether both progress (one process works) and what the loop cannot do while `serve` holds workers.
- [ ] **Step 2:** Failing tests for `config_from_args` (defaults, missing data dir, bad port, `--epoch-seconds 0` refused, `--trust-proxy` count bounded 0 to 5), then implement.
- [ ] **Step 3:** Decide and record the process model in the ledger as a ruling. If one process fails, `lotcast serve` starts the loops as `lotcast run-loops` under the same data dir and the plan's tasks below call that script.
- [ ] **Step 4:** Commit `service: skeleton and process model`.

### Task 2: Request validation, ids and the draw store

**Files:**
- Create: `service/src/request.gu` (parse and validate), `service/src/store.gu` (one JSON file per draw under `draws/`, written with `write_text_atomic`, plus an index by entry hash), tests in `service/tests.gu`

**Interfaces:**
- Consumes: `lotcast-core` `catalogue`, `entry`, `receipt` request helpers (`request_fields_ok`).
- Produces: `parse_request(body: Bytes, now: Int) -> Result[DrawRequest, ApiError]`, `ApiError{status, code, message}`, `store_open(dir)`, `store_put(store, draw)`, `store_get(store, id)`, `store_by_entry(store, entry_hash)`, `store_list(store, status)`, draw `{id, index, entry_hash, promise, epoch, status, waiting_on}`. `id` is the first 32 hex characters of the entry hash.

- [ ] **Step 1:** Failing tests, one per rule: unknown tradition/method/option `E_REQUEST`; `count` above deck `E_COUNT`; a `sources` list without drand `E_SOURCES`; a pending-audit method (Marseille, Thoth) `E_METHOD_PENDING`; a tlock ciphertext `E_TLOCK_ROUND` (tlock itself stays refused with its named error until its plan); `not_before` over 400 days or negative `E_REQUEST`; body 65536 accepted, 65537 `E_TOO_LARGE`; a body holding a `question` key refused `E_REQUEST` (the service must never receive question text).
- [ ] **Step 2:** Implement `parse_request`.
- [ ] **Step 3:** Store tests: put/get round trip; a second `store_put` with the same entry hash returns the first draw; a truncated or invalid JSON file is reported by `store_open` and not served; an interrupted write (temp file left behind) is ignored on open.
- [ ] **Step 4:** Implement the store. Run `guion test`. Commit `service: request validation and draw store`.

### Task 3: The epoch loop (checkpoint, deadline, two stamps, void)

**Files:**
- Create: `service/src/epoch.gu`; tests in `service/tests.gu` use a fake TSA adapter record (functions captured by name) so no network is needed, plus one opt-in live test in `service/tests_live.gu`.

**Interfaces:**
- Consumes: `lotcast-log` `log_append_many`, `anchor_checkpoint`, `choose_tsas`, the store.
- Produces: `run_epoch(state: ServiceState, now: Int) -> Result[EpochOutcome, StdError]` where `EpochOutcome` is `Anchored{epoch, checkpoint, tokens, indexes}` or `Void{epoch, indexes}`; `epoch_loop(state, stop_after: Int)`; per-TSA health (`down_since`) feeding `choose_tsas` after 10 minutes.

- [ ] **Step 1:** Failing tests: entries queued in one epoch land in one checkpoint with `lotcast/epoch <e> <deadline>`; both tokens proving by the deadline gives `Anchored` and marks the draws `anchored`; one TSA failing past the deadline gives `Void`, marks the draws `anchor-failed`, and leaves the void checkpoint in the log; a TSA down 10 minutes switches the pair to `{working} + FreeTSA`; an empty epoch writes no checkpoint (spec 3.1: only when there are new entries).
- [ ] **Step 2:** Failing crash tests: killing between append and stamping (simulate by calling `recover_epochs` on a log whose last checkpoint has no tokens file) re-stamps the same digest until the old deadline or marks the epoch void if the deadline passed; never signs a second checkpoint for the same epoch number.
- [ ] **Step 3:** Implement `run_epoch`, `recover_epochs`, `epoch_loop`. The deadline is `now + epoch_seconds + stamp_budget` committed before stamping, as in `draw.gu`.
- [ ] **Step 4:** Run `guion test`; run the live test once against DigiCert and Sectigo. Commit `service: epoch loop`.

### Task 4: The source watcher and the draw scheduler

**Files:**
- Create: `service/src/watch.gu`; tests in `service/tests.gu`

**Interfaces:**
- Consumes: `lotcast-core` `resolve_sources`, `build_anchored_receipt`, `window` rules; the store.
- Produces: `watch_once(state, now) -> Result[WatchReport, StdError]` that, for each anchored pending draw whose `t0 = max(g, not_before)` has passed, resolves its sources (each call bounded, cached per source and `t0` window so many draws share one fetch), writes the receipt and marks the draw `complete`, or records `waiting_on` (source ids and the time each window closes); `source_status(state) -> Json` for `GET /sources` (latest verified pulse, live or idle, window).

- [ ] **Step 1:** Failing tests with a fake resolver: a draw with `not_before` in the future stays pending with `waiting_on` naming `not_before`; a drand-only draw completes after one resolver call; ten draws with the same `t0` cause one fetch per source; a source whose window is open reports its closing time; a source with no pulse in the window completes the draw as absent; a restart (new `ServiceState` over the same store) resumes pending draws without re-logging.
- [ ] **Step 2:** Implement `watch_once` and `watch_loop`. Every receipt is verified with `verify_any` before it is stored; a receipt that fails its own check is never served and the draw stays pending with `waiting_on: ["internal-check"]` and an alert line in the service log.
- [ ] **Step 3:** Run `guion test`. Commit `service: source watcher and scheduler`.

### Task 5: HTTP routes

**Files:**
- Create: `service/src/routes.gu`, `service/src/limits.gu` (per-IP sliding window), `service/serve.gu`; tests in `service/tests.gu` call handlers with `Request` literals.

**Interfaces:**
- Consumes: Tasks 1 to 4, `web` router, `std:http_static` for `/log/…`.
- Produces: `app_build(state) -> App`; endpoints exactly as spec §8.1: `GET /v1/traditions`, `GET /v1/registry`, `POST /v1/draws` (`202`, `{id, index, entry_hash, promise, status: "pending", poll_after_ms}`), `GET /v1/draws/{id}`, `GET /v1/draws/{id}/receipt`, `POST /v1/verify`, `GET /v1/sources`, `GET /v1/log/checkpoint`, `GET /v1/log/tile/…`, `GET /v1/log/entries/…`.

- [ ] **Step 1:** Failing handler tests: each endpoint's success shape; each error code and HTTP status (400, 404, 413, 429); `POST /v1/draws` twice with the same body returns the same `id` and `promise`; `GET /v1/draws/{id}` for a pending draw names `waiting_on`; `/v1/verify` result says it was done by the service; `/v1/log/tile/../x` and encoded variants are 404; the 61st draw from one IP in a minute is 429 `E_RATE`; the client IP is the socket peer unless `trust_proxy > 0`, then the Nth-from-last `X-Forwarded-For` entry.
- [ ] **Step 2:** Implement the routes, the limiter (state is a `Map[Text, List[Int]]` threaded through the app config, pruned each call) and static tile serving from the log directory.
- [ ] **Step 3:** Run `guion test`. Run the service on a loopback port with the real beacons and TSAs, post a drand-only draw with `curl`, poll, fetch the receipt, check it with `verify_receipt.gu`. Save the receipt as a fixture. Commit `service: HTTP API`.

### Task 6: The `lotcast` CLI

**Files:**
- Create: `cli/lotcast.gu` (one entry script dispatching `draw`, `get`, `verify`, `compute`, `audit`, `serve`), `cli/src/client.gu` (HTTP client for the API), `cli/src/audit.gu`; tests in `cli/tests.gu`

**Interfaces:**
- Consumes: the HTTP API, `lotcast-core` verifier, `lotcast-log` proofs.
- Produces: `lotcast draw <tradition> <method> [KEY=VALUE…] [--question TEXT] [--seal hash|none] [--sources a,b] [--not-before UNIX] [--wait SECONDS] [--server URL]` (the question stays local; salt printed to stderr); `lotcast get <id>`; `lotcast verify <receipt> [--live] [--question … --salt …] [--operator-key HEX]` (exit 0 verified, 3 pending-live, 1 invalid); `lotcast compute <log-index> [--mirror URL]` recomputes the outcome from public data only; `lotcast audit [--mirror URL …]` fetches checkpoints from every mirror, checks each signature and the consistency proofs between each pair, and names any mirror that disagrees or is behind; `lotcast serve` starts the service.

- [ ] **Step 1:** Failing tests: argument parsing for each subcommand and its errors; `compute` on a fixture log gives the same outcome as the stored receipt; `audit` of two fixture mirrors where one is a prefix of the other passes, and where one has a rewritten entry fails naming the first differing index.
- [ ] **Step 2:** Implement the subcommands. `compute` must not call the service for the outcome, only for log files (`--mirror` may be the service or any static host).
- [ ] **Step 3:** Run `guion test`; run the CLI against a locally running service for one drand-only draw and one `--sources drand-quicknet,nist-beacon-2,curby-rng`. Commit `cli: lotcast draw, get, verify, compute, audit, serve`.

### Task 7: Operations and docs

**Files:**
- Create: `service/Dockerfile`, `service/railway.toml` if Task 1's model allows one command, `service/README.md`, `docs/operations.md`; modify `README.md`

**Interfaces:**
- Produces: the pin-expiry check (`GET /v1/sources` reports every pinned certificate's days left and a daily job writes an alert line when one is under 30 days or a fetch failed), the key from the environment value, the volume layout (`log/`, `draws/`, `receipts/`).

- [ ] **Step 1:** Failing test: `pin_report()` flags a certificate expiring in 29 days and passes one at 31.
- [ ] **Step 2:** Implement, then write the docs: what runs, the data directory layout, key handling, the process model from Task 1, the 24-hour access-log rule, the CLI examples, and what is still not built (witness cosignatures, MCP, browser verifier, tlock, signed subject keys, audits, batteries).
- [ ] **Step 3:** Run every suite (core 123, log 35, enumeration, statistical, service, cli). Commit `lotcast: operations notes and docs`.

## Out of scope for this plan (next plan, by dependency)

Witness cosignature submission to public tlog witnesses (needs the build to confirm which networks accept a new log, spec §12; the verifier already accepts cosignatures once keys exist); the MCP server; the browser verifier and its step budget; tlock questions and signed subject keys; tradition audits and the methods they unlock; the Rust reference stream, batteries and the 10,000 cross-implementation vectors; deployment to Railway and the R2 mirror; publishing `lotcast-core` and `lotcast-log` to the Guion registry.
