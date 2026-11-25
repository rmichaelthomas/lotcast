# Lotcast MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native, one Opus whole-branch review at the end). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `lotcast mcp`: a local stdio MCP server, in Guion, that lets an AI client cast a lot, fetch a draw, and verify a receipt on the user's machine, with the question and its salt never leaving it.

**Architecture:** The CLI's `draw`, `get` and `verify` are split into a pure-ish core that returns values (`src/run.gu`) and thin printing wrappers, so the MCP tools and the command line share one implementation. A local store under `~/.lotcast/` keeps receipts, salts and a pinned operator key. A JSON-RPC 2.0 loop (one message per line, stdin to stdout) dispatches six tools to functions that take their HTTP, clock and store as injected function values, so every tool is tested without a network.

**Tech Stack:** Guion 0.8.0 (`std:io` `stdin_read_line`, `std:json` safe accessors, `std:process` `process_run` for `chmod`), the existing `lotcast-cli`, `lotcast-core`, `lotcast-log` and `lotcast-service` packages. No Python.

**Spec:** `/Users/rmichaelthomas/hunchery/docs/explore/agent-divination-tools/03-draw-service-design.md` §8.2 (MCP server), §8.3 (CLI), §8.1 (API and error codes), §5.2 (receipt), §3.4. Built on `2026-11-24-lotcast-service-and-cli.md`. Guion's own `language/examples/mcp_server/main.gu` is the protocol skeleton.

## Global Constraints

- **Everything is Guion.** The only Python in the repository is `reference/python/`. A step Guion cannot do is reported as a Guion gap, not written in Python. Use `python3` if Python is ever run for the vectors; never `python`.
- **stdout belongs to JSON-RPC.** In `lotcast mcp` nothing but one JSON object per line is ever printed to stdout. Diagnostics go to stderr. No function reached from a tool may call `print`.
- **The question is never sent.** Only its SHA-512 commitment goes to the service (spec §8.2, §4.1). The question and salt are stored locally only.
- **Positions, never meanings.** Tool descriptions say: the draw comes from this tool, never from the model; quote positions exactly; meanings are the model's or the user's own; the receipt lets anyone check the draw (spec §8.2).
- **Spec names:** tools `list_traditions`, `describe_method`, `draw`, `get_draw`, `verify_receipt`, `open_sealed`. `draw` inputs: `tradition`, `method`, `options`, `question` (optional, never sent), `seal` (`hash`, `tlock` or `none`), `sources`, `wait_seconds` (default 180). Storage: `~/.lotcast/`. Subject key off by default (`sign_requests`).
- **Refused with named errors, as in the service:** `seal: "tlock"` and a `sign_requests` of true both answer `E_TLOCK_UNSUPPORTED` and `E_SUBJECT_KEY_UNSUPPORTED`. Nothing is silently downgraded.
- **Function values capture nothing** and **record names are global**: new records get names no other package declares (`McpHome`, `Check`, `Drawn`, `Sealed`, `Dispatch`).
- **Do not touch** any project-level `CLAUDE.md` or `AGENTS.md`. Commits end with the Co-Authored-By and Claude-Session trailers from the session reminder.
- **Existing suites stay green:** core 127, enumerate 8, statistical 5, log 35, service 80, routes 16, cli 38, tools 4.

## Review Focus

1. **Stdout pollution.** A draw, a failed verification or a library `print` writes a non-JSON line to stdout and breaks the client's framing. A test runs every tool and asserts the captured output is only JSON lines (Task 3, Task 5 live).
2. **Path escape.** `get_draw` ids, `open_sealed` ids and `verify_receipt` paths must not read or write outside `~/.lotcast/`: `../`, absolute paths, symlink names and ids that are not 32 lowercase hex are refused (Task 2, Task 4).
3. **Lost salt.** A crash or an early client exit between sending a request and storing its salt would make the sealed question unrecoverable. The record (question, salt, request) is written under the draw id *before* the request is posted (Task 4).
4. **A model-supplied operator key or server.** The model controls tool arguments; it must not be able to point `verify_receipt` at an operator key it chose, or redirect `draw` to another server, to make a forged receipt verify. Server and operator key come from the local config only; the first key seen is pinned and a later change is an error (Task 2, Task 4).
5. **Hostile or malformed protocol input.** A non-JSON line, a request with a wrong-typed `method`, `params`, `arguments` or `id`, a line over the stdin limit, an unknown method, an unknown tool and a notification must each give the right JSON-RPC answer (or none) and keep the server running (Task 3).
6. **A draw that outlives the client.** `wait_seconds` above what the client will wait must still return a usable `pending` result with the id and what it waits on, and `get_draw` must resume it later, including after a restart of the server (Task 4).

---

### Task 1: Return values, not output (`src/run.gu`)

**Files:**
- Create: `cli/src/run.gu`
- Modify: `cli/src/commands.gu` (`check_receipt`, `cmd_verify`, `cmd_draw`, `cmd_get` call the new functions), `cli/src/lib.gu` (export)
- Test: `cli/tests.gu` (new tests, existing 38 unchanged)

**Interfaces:**
- Consumes: `verify_any`, `live_recheck`, `tsa_pins`, `binding_problem`, `http_reply`, `plan_draw`/`DrawPlan`, `Reply` (existing).
- Produces:
  - `pub record Check: verdict: Text, detail: Text, failed_step: Int` where `verdict` is `verified`, `verified-pending-live`, `verified-unanchored` or `invalid`. `pub fn check_value(receipt: Json, operator_key: Bytes, asked: Bool, question: Text, salt: Bytes, live: Bool) -> Check` (never prints; with `live` it runs `live_recheck` and turns a confirmed pending-live into `verified`, a failed one into `invalid` at step 4, a still-pending one stays `verified-pending-live`).
  - `pub record Drawn: status: Text, id: Text, index: Int, receipt: Json, waiting_on: Json, check: Check` with `status` `complete`, `pending` or `anchor-failed`.
  - `pub fn run_draw(plan: DrawPlan, key: Bytes, send: fn(Text, Text, Text) -> Result[Reply, StdError], pause: fn(Int) -> Unit, logged: fn(Text, Int) -> Unit) -> Result[Drawn, Text]`: posts, checks `binding_problem` on the reply and on the final view, calls `logged(id, index)` once after the promise is checked, polls with `pause(3)` until complete, `anchor-failed` or `plan.wait_seconds`, then checks the receipt (`check_value`, asked = `plan.has_question`). The `Err` text is the same message `cmd_draw` prints today.
  - `pub fn fetch_draw(server: Text, id: Text, key: Bytes, wait: Int, send: ..., pause: ...) -> Result[Drawn, Text]`: the `cmd_get` body, same binding check with no expected request.

- [ ] **Step 1: Write the failing tests** in `cli/tests.gu`, using fake `send` and `pause` functions and the existing `fixtures/receipt.json` and `operator-key.hex`: `test_check_value_verified`, `test_check_value_invalid_names_step` (receipt with a flipped outcome byte gives `invalid` and `failed_step > 0`), `test_check_value_pending_live_without_live_flag`, `test_run_draw_complete`, `test_run_draw_pending_returns_waiting_on`, `test_run_draw_rejects_wrong_promise` (a reply whose promise is signed by another key is `Err`), `test_run_draw_calls_logged_once_before_poll`, `test_fetch_draw_checks_id`.
- [ ] **Step 2: Run** `cd cli && guion test` → Expected: the new tests FAIL (names undefined); the other 38 do not run until the build passes.
- [ ] **Step 3: Implement** `check_value`, `run_draw`, `fetch_draw` in `cli/src/run.gu` by moving the logic out of `commands.gu`; `check_receipt`, `cmd_draw`, `cmd_get` become wrappers that print the same lines as before and return the same exit codes.
- [ ] **Step 4: Run** `cd cli && guion test` → Expected: 46 pass, 0 fail (the original 38 prove the wrappers did not change behaviour).
- [ ] **Step 5: Commit** `cli: return values from draw, get and verify so another front end can share them`.

---

### Task 2: The local home (`src/home.gu`)

**Files:**
- Create: `cli/src/home.gu`
- Modify: `cli/src/lib.gu`, `cli/guion.toml` (`[environment] variables = ["LOTCAST_OPERATOR_KEY", "HOME", "LOTCAST_HOME"]`; `[process] commands = ["chmod"]`)
- Test: `cli/tests.gu`

**Interfaces:**
- Produces:
  - `pub record McpHome: root: Text` (a path relative to the file root, normally `.`) and `pub record McpConfig: server: Text, operator_key_hex: Text, sign_requests: Bool`.
  - `pub fn home_open(root: Text) -> Result[McpHome, Text]`: creates `receipts/`, `salts/` and the root, and runs `chmod 700` on each with `process_run("chmod", ["700", path])`; a failing `chmod` is an `Err` (a private directory that cannot be made private is not used).
  - `pub fn is_draw_id(id: Text) -> Bool` (32 lowercase hex).
  - `pub fn home_save_receipt(h, id, receipt: Json) -> Result[Unit, Text]`, `home_load_receipt(h, id) -> Result[Json, Text]`.
  - `pub record Sealed: id: Text, question: Text, salt_hex: Text, request_json: Text, entry_hash_hex: Text`; `pub fn home_save_sealed(h, s: Sealed) -> Result[Unit, Text]` (atomic write, then `chmod 600`), `home_load_sealed(h, id) -> Result[Sealed, Text]`.
  - `pub fn home_config(h) -> Result[McpConfig, Text]`: reads `config.json` (`server` default `http://127.0.0.1:8080`, `operator_key` default `""`, `sign_requests` default false); any other key is an `Err` naming it.
  - `pub fn home_pin_key(h, server: Text, key_hex: Text) -> Result[Unit, Text]`: if `pinned.json` has no key for `server`, stores it; if it has one that differs, `Err("the operator key for <server> changed: ...")`.
  - `pub fn home_read_file(h, relative: Text) -> Result[Text, Text]`: only a path with no `..` segment, no leading `/`, no backslash and no NUL, and not naming a symlink, is read from inside the home.

- [ ] **Step 1: Write the failing tests** in a new `cli/tests_home.gu` (a temp home via `fs_temp_dir`, then `home_open` on it): `test_is_draw_id` (32 hex yes; 31, 33, uppercase, `../a…`, empty no), `test_sealed_round_trip`, `test_receipt_round_trip`, `test_private_modes` (after save, `stat`-style check through `process_run("ls", ["-ld", path])` shows `drwx------` and `-rw-------`), `test_config_defaults`, `test_config_unknown_key_is_named`, `test_pin_first_use_then_mismatch`, `test_read_file_refuses_escape` (`../x`, `/etc/passwd`, `a/../../b`, `a\\b`), `test_load_refuses_bad_id`.
- [ ] **Step 2: Run** `cd cli && guion test tests_home.gu` → Expected: FAIL, names undefined.
- [ ] **Step 3: Implement** `src/home.gu`. Write files with `write_text_atomic`, then call `chmod 600` through `process_run`. If `process_run` is not granted the functions return `Err` with the grant to add.
- [ ] **Step 4: Run** `cd cli && guion test tests_home.gu` → Expected: all pass. Then `guion test` → still 46 pass.
- [ ] **Step 5: Commit** `cli: a private local home for receipts, salts and a pinned operator key`.

---

### Task 3: The JSON-RPC loop and the tool list (`src/mcp_rpc.gu`, `src/mcp_tools.gu`)

**Files:**
- Create: `cli/src/mcp_rpc.gu`, `cli/src/mcp_tools.gu`
- Modify: `cli/src/lib.gu`
- Test: `cli/tests_mcp.gu`

**Interfaces:**
- Produces:
  - `pub record Dispatch` is not used; instead `pub fn mcp_handle(request: Json, call: fn(Text, Json) -> Json) -> Option[Json]`: one reply for one parsed line, `None` for a notification. `call(name, arguments)` returns the tool result as the MCP `{content: [{type: "text", text}], isError}` object (built by `pub fn tool_result(text: Text, is_error: Bool) -> Json` and `pub fn tool_json(value: Json, is_error: Bool) -> Json`, whose text is the stringified value).
  - `pub fn mcp_serve(read: fn() -> Result[Option[Text], StdError], write: fn(Text) -> Unit, call: fn(Text, Json) -> Json) -> Int`: the line loop (empty line skipped, parse error `-32700` with `id: null`, wrong-typed `method` `-32600`, wrong `params` or `arguments` `-32602`, unknown method `-32601`, `initialize` echoing the client's `protocolVersion` or `2024-11-05`, `capabilities: {tools: {}}`, `serverInfo` `lotcast` with the package version, `ping`, `tools/list`, `tools/call`, notifications silent). Returns 0 at end of input.
  - `pub fn tool_definitions() -> Json`: the six tools with JSON Schemas (`inputSchema` with `type`, `properties`, `required`; `additionalProperties: false`) and the four spec sentences in each tool's description that returns a draw.

- [ ] **Step 1: Write the failing tests** in `cli/tests_mcp.gu` (with a `main`): `test_initialize_echoes_version`, `test_initialize_default_version`, `test_ping`, `test_tools_list_has_six_named_tools` (names exactly the six; each schema has `required` where the spec says: `describe_method` tradition+method, `draw` tradition+method, `get_draw` id, `verify_receipt` receipt, `open_sealed` id), `test_descriptions_say_the_four_things` (the `draw` description contains `never from the model`, `quote positions exactly`, `meanings are`, `check the draw`), `test_notification_gets_no_reply`, `test_unknown_method_is_32601`, `test_wrong_typed_method_is_32600`, `test_wrong_typed_params_is_32602`, `test_parse_error_keeps_serving` (feed `not json` then a ping: two replies, the second ok), `test_blank_lines_skipped`, `test_long_line_error_keeps_serving` (a reader that returns `Err(E_STDIN_LINE_LIMIT)` once then a ping), `test_tool_error_is_a_result_not_a_protocol_error` (a `call` returning `isError: true` still gives a `result`), `test_only_json_is_written` (every captured `write` is a parseable object with `"jsonrpc": "2.0"`).
- [ ] **Step 2: Run** `cd cli && guion test tests_mcp.gu` → Expected: FAIL, names undefined.
- [ ] **Step 3: Implement** both files, following `language/examples/mcp_server/main.gu` for the reply shapes and the `json_*_safe` accessors; a stdin read error ends with the line skipped unless the code is not `E_STDIN_LINE_LIMIT`, in which case the loop ends.
- [ ] **Step 4: Run** `cd cli && guion test tests_mcp.gu` → Expected: all pass.
- [ ] **Step 5: Commit** `cli: a JSON-RPC stdio loop and the lotcast tool definitions`.

---

### Task 4: The six tools (`src/mcp_calls.gu`)

**Files:**
- Create: `cli/src/mcp_calls.gu`
- Modify: `cli/src/lib.gu`
- Test: `cli/tests_mcp.gu` (more tests)

**Interfaces:**
- Consumes: Task 1 (`run_draw`, `fetch_draw`, `check_value`), Task 2 (the home), Task 3 (`tool_result`, `tool_json`), `plan_draw`.
- Produces: `pub fn call_tool(h: McpHome, cfg: McpConfig, name: Text, args: Json, send: fn(Text, Text, Text) -> Result[Reply, StdError], pause: fn(Int) -> Unit, random: fn(Int) -> Bytes) -> Json`. Every failure is a `tool_result(message, true)` whose first line is a stable code (`E_ARGUMENT`, `E_SERVER`, `E_KEY_CHANGED`, `E_TLOCK_UNSUPPORTED`, `E_SUBJECT_KEY_UNSUPPORTED`, `E_NOT_FOUND`, `E_BAD_RECEIPT`) or the service's own `E_…` code.
  - `list_traditions`: `GET /v1/traditions` and returns it.
  - `describe_method(tradition, method)`: that method's entry from the same document (options, exact odds, audit summary); `E_NOT_FOUND` otherwise.
  - `draw(tradition, method, options?, question?, seal?, sources?, wait_seconds?)`:
    1. refuse `seal: "tlock"` (`E_TLOCK_UNSUPPORTED`) and `cfg.sign_requests` true (`E_SUBJECT_KEY_UNSUPPORTED`) before any network call; `seal: "hash"` is the default when a `question` is given, `"none"` with a question is `E_ARGUMENT`; a `seal` of `hash` with no question is `E_ARGUMENT`; options values must be text, numbers or booleans (converted to the `KEY=VALUE` text the planner takes); `wait_seconds` 0 to 600;
    2. make the plan with `random(32)` nonce and salt, get the operator key (`cfg.operator_key_hex`, else `GET /v1/operator`, then `home_pin_key`), and write the `Sealed` record (question, salt, request, entry hash) under the id *before* `send` is called;
    3. `run_draw` with `logged` saving nothing further; save the receipt when `complete`;
    4. return `{status, id, index, positions? (the receipt's outcome), odds? , verdict, detail, waiting_on?, sealed: bool}` as JSON text. Never include the question or salt in the result. When `pending`, the result says `use get_draw with this id`.
  - `get_draw(id)`: `is_draw_id`, then `fetch_draw`; on `complete` save the receipt and check it with the stored question and salt if a `Sealed` record exists; same result shape.
  - `verify_receipt(receipt, question?, salt?)`: `receipt` is a JSON object, a JSON text, or a path relative to the home (`home_read_file`); the operator key is `cfg.operator_key_hex` or the pinned one for `cfg.server` (never an argument); returns the verdict with `failed_step` and `detail`, and the question and salt are used only if both are given.
  - `open_sealed(id)`: `is_draw_id`, loads the `Sealed` record; returns `{question, salt}` only when the draw's receipt is complete and its commitment matches (`question_commit(question, salt)` equals the receipt's commitment), else the reason. A `ciphertext` argument is `E_TLOCK_UNSUPPORTED`.

- [ ] **Step 1: Write the failing tests** (fake `send` returning fixtures/receipt.json-derived views, fixed `random`, a temp home): `test_draw_complete_is_verified`, `test_draw_never_sends_the_question` (the posted body contains no `question`, and the stored `Sealed` holds it), `test_draw_saves_salt_before_post` (a `send` that fails on POST still leaves the `Sealed` record), `test_draw_pending_returns_id_and_waiting_on`, `test_draw_tlock_refused_before_network` (`send` counts zero calls), `test_draw_sign_requests_refused`, `test_draw_bad_options_are_named`, `test_draw_server_comes_from_config_only` (an `args` carrying `server` or `operator_key` is ignored, and `additionalProperties` rejected as `E_ARGUMENT`), `test_operator_key_pinned_and_change_refused`, `test_get_draw_resumes_after_restart` (new `McpHome` on the same dir), `test_get_draw_rejects_bad_id`, `test_verify_receipt_json_path_and_text`, `test_verify_receipt_path_escape_refused`, `test_verify_receipt_invalid_names_step`, `test_verify_receipt_ignores_a_model_supplied_key`, `test_open_sealed_returns_question_for_matching_commitment`, `test_open_sealed_pending_and_mismatch`, `test_list_traditions_and_describe_method`, `test_describe_method_unknown_is_not_found`, `test_no_tool_prints` (capture stdout around every tool above and assert it is empty).
- [ ] **Step 2: Run** `cd cli && guion test tests_mcp.gu` → Expected: new tests FAIL.
- [ ] **Step 3: Implement** `src/mcp_calls.gu`.
- [ ] **Step 4: Run** `cd cli && guion test tests_mcp.gu && guion test tests_home.gu && guion test` → Expected: all pass.
- [ ] **Step 5: Commit** `cli: the six MCP tools, with the question kept local`.

---

### Task 5: `lotcast mcp`, a live run, docs

**Files:**
- Modify: `cli/lotcast.gu` (`mcp` subcommand and header), `cli/src/commands.gu` (`cmd_mcp`), `cli/README.md`, root `README.md`, `docs/operations.md` (a short client-config section), `~/.claude/projects/-Users-rmichaelthomas-hunchery/memory/project_lotcast_build_state.md`
- Create: `cli/tests_live_mcp.gu`
- Test: `cli/tests_mcp.gu`

**Interfaces:**
- Produces: `pub fn cmd_mcp(all: List[Text]) -> Int`: flags `--home DIR` (default `$LOTCAST_HOME`, else `$HOME/.lotcast`), `--server URL` overriding config only on the command line the *user* typed (it is not a tool argument), `--operator-key HEX`; builds `McpHome`, `McpConfig`, the real `send` (`http_reply`), `pause` (`sleep_ms`), `random` (`crypto_random_bytes`), reads with `stdin_read_line`, writes with `print`, and runs `mcp_serve`. Exit 2 with a stderr message when the home cannot be made private.

- [ ] **Step 1: Write the failing test** `test_mcp_command_requires_a_private_home` in `cli/tests_mcp.gu`: `cmd_mcp(["--home", <path whose parent is a file>])` returns 2 and prints nothing to stdout.
- [ ] **Step 2: Run** `cd cli && guion test tests_mcp.gu` → Expected: FAIL.
- [ ] **Step 3: Implement** `cmd_mcp` and the `mcp` route in `lotcast.gu`.
- [ ] **Step 4: Run** `cd cli && guion test tests_mcp.gu` → Expected: PASS. Then every suite from Global Constraints: core 127, enumerate 8, statistical 5, log 35, service 80, routes 16, cli 38 + new, tools 4.
- [ ] **Step 5: Live check.** Start `lotcast serve` on `127.0.0.1:8080` with a fresh data dir (as in `service/README.md`), then pipe `initialize`, `notifications/initialized`, `tools/list`, `tools/call list_traditions`, `tools/call draw` (`iching coins`, `sources: ["drand-quicknet"]`, `question: "a test question"`, `wait_seconds: 120`), `tools/call get_draw` and `tools/call open_sealed` into `guion run … lotcast.gu mcp --home <tmp>` and check: every stdout line parses as JSON-RPC, the draw's verdict is `verified`, the service's inbox and log hold no trace of `a test question`, `~/.lotcast`-style files are `600`/`700`, a second run of `get_draw` on the same home succeeds, and `open_sealed` returns the question. Run the same pipe once with a pinned wrong `--operator-key` and see `E_KEY_CHANGED` or an invalid verdict, not a trusted draw. Save the transcript to `cli/fixtures/mcp-session.txt` (no secrets) and make `tests_live_mcp.gu` replay it against the real server when run with the grants in its header.
- [ ] **Step 6: Docs.** `cli/README.md` gets an MCP section with the Claude Desktop and Claude Code client config (`guion run` with the grants, `--home`), the six tools, the local files and what each protects; root `README.md` Status and Use mention `lotcast mcp`; `docs/operations.md` gets "pinning the operator key for MCP clients". The memory file is updated: slice 4 merged, the not-built list without the MCP server.
- [ ] **Step 7: Commit** `cli: lotcast mcp, documented and checked against a live service`.

---

## Final review

One whole-branch review by a fresh Opus reviewer with the Review Focus section above, the ledger's `Ruling:` lines and this plan. Every finding, minors included, is fixed with a test that failed first; the suite is run in full; then PR, merge (authorised for the lotcast repo) and cleanup.

## Rulings made while writing this plan

- **MCP lives in the `lotcast-cli` package, not a separate `mcp/` package.** The spec says one binary `lotcast` and Guion's `guion run` takes one entry file; a second package would only re-export the same functions. Cost if wrong: moving files later.
- **File mode 0600/0700 comes from `chmod` through the `[process] commands` grant.** Guion has no `fs_set_mode`; the grant is the Guion-native way and the directories are made private before any file is written in them. Cost if wrong: one more grant for the user to approve; a real `fs_set_mode` would remove it (listed as a Guion gap, not worked around in Python).
- **Server and operator key come from local config, never from tool arguments.** The model controls arguments; a model-chosen key would let a forged receipt verify. Cost if wrong: a user who wants several servers edits config.
- **`seal: "tlock"`, `open_sealed` on a ciphertext and `sign_requests: true` answer named errors.** They need BLS12-381 timelock and signed subject keys, neither built; the service refuses them already. Cost if wrong: none, they are in the not-built list.
- **The salt is stored before the request is posted, keyed by the draw id.** The id is the first 32 hex of the entry hash, known before sending, so no draw can exist without its salt on disk. Cost if wrong: an orphan record for a request that never reached the service.
- **`wait_seconds` is capped at 600.** A tool call that blocks for an hour looks like a hang to every client; longer waits use `get_draw`.
