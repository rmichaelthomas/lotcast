# Lotcast Online Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native, one Opus whole-branch review at the end). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Lotcast on the internet on Cloudflare, publish the operator's public key, and add a web page where anyone can paste a receipt and see whether it checks out.

**In plain words:** the drawing, the receipts and the checking already work on a laptop. This plan does four things: (1) prove Cloudflare can keep Lotcast's records safe, (2) put the service online, (3) publish the key people check receipts against, (4) add a checking page. Nothing else.

**Architecture:** The existing Guion service (`lotcast serve`) runs unchanged inside a Cloudflare Container. A Cloudflare Worker in front starts it and passes requests to it. The log lives in an R2 bucket so it survives restarts. The checking page is static files on Cloudflare Pages: Guion's browser VM (`guion_vm.wasm`) running a compiled Guion verifier.

**Tech stack:** Guion 0.8.0; Cloudflare Containers (`durable_object` scheduling policy), Workers, R2, Pages; `wrangler`.

**Spec:** `~/hunchery/docs/explore/agent-divination-tools/03-draw-service-design.md` §8.1, §8.4, §9, as amended by Task 0 (Railway replaced by Cloudflare; the "paranoid layer" taken out of scope).

## Decisions Rob makes (asked, not assumed)

- **Cloudflare plan.** Containers need the Workers Paid plan (USD 5 a month, with included usage). Confirm before Task 3.
- **Address.** A subdomain of a domain Rob already has on Cloudflare, or the free `*.workers.dev` / `*.pages.dev` address. Asked at Task 3.
- **Two small pieces of JavaScript.** Cloudflare only starts a Container from a Worker, and a web page can only load WebAssembly from JavaScript. So there are two short glue files that are not Guion: the Worker (about 60 lines) and the page loader (about 80 lines). All logic stays in Guion; the glue only starts things and passes bytes. This is an exception to "everything is Guion" and needs Rob's OK.
- **Go-live.** Nothing is deployed to Rob's Cloudflare account until he says go (Task 3, step 1).

## Out of scope (decided 2026-11-24)

Witness cosignatures, mirrors, timelocked questions, signed subject keys, new tradition audits, statistical batteries, the Rust reference stream, publishing to the Guion registry. The code that refuses timelock and subject keys with named errors stays as it is.

## Global constraints

- All logic in Guion; the two glue files only start the container, forward requests, and pass bytes into the VM.
- The operator's secret key is a Cloudflare secret (`wrangler secret put`), never in the repository, an image, a log line or a chat message.
- Existing suites stay green: core 127, enumerate 8, statistical 5, log 35, service 80, routes 16, cli 48, home 10, mcp 53, cli-modes 1, tools 4.
- `python3`, never `python`. Commit trailers as in the session reminder. Do not touch `CLAUDE.md` or `AGENTS.md`.

## Review focus

1. **Lost records.** A container restart, sleep or redeploy must never lose or rewrite a logged draw. Task 1 proves it before anything is built on it.
2. **A draw cut off by sleep.** If the container sleeps while a draw is waiting on a beacon, the draw must finish when it wakes (the service's recovery already does this; Task 2 checks it on Cloudflare).
3. **The secret key.** It must not appear in the image, the bucket, logs or responses.
4. **The checking page tells the truth.** A tampered receipt must show "invalid" with the failed step; a receipt that needs a live check must say so, never "verified".
5. **Two copies of the service.** Only one container may write the log at a time.

---

### Task 0: Tidy the plan's ground

**Files:** delete `service/railway.toml`; modify `service/Dockerfile` (header comment), `README.md` (status: "out of scope" list), `docs/operations.md` ("Deploying on Railway" → "Deploying on Cloudflare", filled in by Task 3); in the Hunchery repo, `docs/explore/agent-divination-tools/03-draw-service-design.md` §9 (Railway → Cloudflare Containers + R2) and a short "Scope, 2026-11-24" note listing what was taken out.

- [ ] Make the edits; commit in lotcast (`chore: Cloudflare, not Railway; record what is out of scope`) and open a small Hunchery PR for the spec note.

### Task 1: Prove Cloudflare keeps the log (the test that decides the storage)

The service writes its log as files: it writes a temporary file and renames it over the old one, and it uses a directory as a lock. R2 mounted with FUSE is "not full POSIX", so those two operations are what must be checked.

**Files:** create `deploy/cloudflare/` with `wrangler.jsonc`, `Dockerfile` (the service image plus `tigrisfs` to mount R2 at `/data`), `src/worker.ts` (glue), and `deploy/cloudflare/CHECK.md` (the results).

- [ ] **Step 1:** A Guion check program `deploy/cloudflare/fs_check.gu` that, on a given directory, does what the service does: `write_text_atomic` over an existing file 200 times and reads back each version; `fs_make_dir` of a lock directory twice (the second must fail) and `fs_remove`; `fs_list_dir` after writes; append 100 entries with `log_append_many` and reopen the log. It prints one line per check, `ok` or what went wrong. Run it on a local directory first: all `ok`.
- [ ] **Step 2:** Run the same program inside the container locally (`wrangler dev`, R2 bucket `lotcast-check` mounted at `/data`). Record every line in `CHECK.md`.
- [ ] **Step 3:** Run the real service in the local container on `/data`, make a drand-only draw with `lotcast draw`, stop the container, start it again, and `lotcast get` the same id: the receipt must come back and verify, and the next draw must get the next index.
- [ ] **Step 4: Decide.** If steps 2 and 3 pass, R2-via-FUSE is the storage: continue. If either fails, the storage moves to a Durable Object's SQLite database behind a tiny key-value HTTP endpoint in the Worker, and `service/src/store.gu` gets a second backend that talks to it (the service already reads and writes through `store.gu` only; the log package's file calls are routed the same way). That change gets its own failing tests first. Either way, `CHECK.md` says what was found, and Rob is told in one line.

### Task 2: The Cloudflare wrapper

**Files:** `deploy/cloudflare/src/worker.ts`, `wrangler.jsonc`, `deploy/cloudflare/README.md`.

- [ ] One Durable Object owns the one container (so only one copy ever writes the log). It forwards every request to the container's port 8080 and sets an inactivity timeout of 30 minutes.
- [ ] The Worker sets `X-Forwarded-For` from Cloudflare's `CF-Connecting-IP`, and the service runs with `--trust-proxy 1`, so the 60-a-minute limit is per person.
- [ ] Before it lets the container sleep, the Durable Object asks `GET /v1/status` (a new, tiny route in `service/src/routes.gu`: how many draws are still pending) and stays awake while any are. Test first in `service/tests_routes.gu`: `test_status_counts_pending_draws`.
- [ ] Check locally: a draw made, the container told to sleep mid-draw, woken by the next request, and the first draw completes and verifies.

### Task 3: Go live (on Rob's go)

- [ ] **Step 1:** Ask Rob: Workers Paid plan on, which address, OK to deploy. Stop until he answers.
- [ ] **Step 2:** Create the R2 bucket, put the operator key with `wrangler secret put LOTCAST_OPERATOR_KEY` (generated on Rob's machine with `lotcast serve --new-key` and never printed in the chat), deploy with `wrangler deploy`.
- [ ] **Step 3:** From outside: `lotcast draw iching coins --server https://ADDRESS` with drand only, then with the default three sources; both `verified`. `lotcast mcp` with that server in `config.json`: a draw through it `verified`.
- [ ] **Step 4:** `docs/operations.md` "Deploying on Cloudflare": the commands, where the key lives, how to back up (one command that copies the bucket, for example `rclone sync r2:lotcast-log r2:lotcast-log-backup`, run on a schedule Rob chooses), and how to read the container's logs.

### Task 4: Publish the operator key

- [ ] The public key goes in the repository README, in `docs/operations.md`, on the checking page, and is served at `/v1/operator`. Two independent places, so nobody has to trust the server for its own key.

### Task 5: The checking page

**Files:** create `verify-web/verify.gu` (entry `verify_page(receipt: Text, operator_key_hex: Text) -> Json` calling the existing `verify_any`, returning `{verdict, detail, failed_step, steps}`), `verify-web/tests.gu`, `verify-web/index.html`, `verify-web/loader.js` (glue), `verify-web/build.md`.

- [ ] **Step 1: Tests first** (native Guion): the three fixture receipts give `verified`; a changed outcome gives `invalid` at step 5; the CURBy-Q receipt gives `verified-pending-live` with a sentence telling the reader it is not fully checked; non-JSON gives a clear error, not a crash.
- [ ] **Step 2:** Build the artifact with `guion build verify-web/verify.gu`; it must be under 1 MiB. Build `guion_vm.wasm` from the Guion 0.8.0 source (`crates/vm-wasm`).
- [ ] **Step 3:** Measure the steps a full receipt takes in the browser VM and set the page's budget to that plus headroom (`allowRaisedSteps`, below the 50,000,000 ceiling). A test runs the artifact through the wasm module in Node with the fixtures and checks it gives the same answers as the native run.
- [ ] **Step 4:** The page: paste or drop a receipt, see the verdict and each step in plain words. The operator key is filled in from the published one. A receipt that needs a live check says "verified except for a live check" and shows the one command that finishes it.
- [ ] **Step 5:** Deploy to Pages with Rob's go (same answer as Task 3 covers it), and link it from the service's root page and the README.

### Final

One Opus whole-branch review against the Review focus; every finding fixed with a test; PR, merge; a plain-language summary to Rob of what is live and where.
