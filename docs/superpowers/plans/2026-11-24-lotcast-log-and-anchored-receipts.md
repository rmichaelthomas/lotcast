# lotcast-log and Anchored Receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native execution, one Opus whole-branch review at the end). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Receipts that prove the request came before the beacons: a Merkle log with signed checkpoints, two RFC 3161 timestamps over each checkpoint, all four beacons resolved by the inclusion rule, and a verifier that runs spec §5.2 steps 1 to 7 offline.

**Architecture:** A new package `packages/lotcast-log` holds RFC 6962 hashing, C2SP signed notes, tlog-tiles storage and TSA anchoring. `lotcast-core` gains the three remaining sources (`sources.gu`) and a v1 receipt that carries `promise`, `log`, `anchor` and every source's status. A single-writer local log (a directory of tiles) stands in for the service; the service (HTTP, scheduler, witness submission) is the next plan and builds on the same package.

**Tech Stack:** Guion 0.8.0 (`std:crypto` Ed25519 and `crypto_tsa_*`, `beacons` 0.3.0 from the registry, `write_text_atomic`, `sleep_ms`), Python 3 for the independent vector generator.

**Spec:** `/Users/rmichaelthomas/hunchery/docs/explore/agent-divination-tools/03-draw-service-design.md` §3.1 to §3.4, §4.2, §4.3, §5.2 (verification steps 1 to 7), §10. Previous plan: `2026-11-23-lotcast-core-first-slice.md`.

## Global Constraints

- Every hash is SHA-512 except the RFC 6962 tree, which is SHA-256 (the tlog-tiles and signed-note formats require it). Domain tags are ASCII. Integers are big-endian at a fixed width. `lp(x)` is a 4-byte big-endian length then the bytes.
- Seed: `SHA-512("lotcast/seed/v1" ‖ lp(entry_hash) ‖ lp(SHA-512(C_e note)) ‖ for id in [drand-quicknet, nist-beacon-2, curby-rng, curby-q]: lp(id) ‖ u8(status) ‖ lp(value or empty))`. Status 1 present, 0 absent, 2 not requested. `absent-proven` and `absent-live` are both status 0.
- Anchor time: `g = max(genTime₁ + accuracy₁, genTime₂ + accuracy₂) + δ`, `δ = 1 s`, in whole seconds, rounding up. `t₀ = g`, or `max(g, not_before)` for a scheduled draw.
- Source windows: NIST 3 periods (180 s); CURBy-RNG 3 periods (period read from the chain's history, to confirm in Task 6); CURBy-Q 3 × the median round time over the chain's history.
- `drand-quicknet` cannot be left out and waits indefinitely. Every other source may be `not-requested`.
- Epoch length defaults to 5 s. Two TSAs by different companies: DigiCert `timestamp.digicert.com` and Sectigo `timestamp.sectigo.com`; fallback after 10 minutes is `{working TSA} + FreeTSA`. Each TSA certificate chain is pinned by fixture.
- Verdicts: `verified` (every step offline), `verified-pending-live` (one or more `absent-live`, named), `verified-unanchored` (only when `log` is null, as in the first slice), `invalid` (with the first failing step number).
- No question text, IP address or account is ever in a log entry.
- Python is `python3`. The independent generator in `reference/python/` is written from the spec and the C2SP specs, never from the Guion code.
- Guion limits learned in the first slice still bind: arbitrary-precision `Int` with signed 64-bit bit operations (no bit operations on words), immutable records (thread state through calls), no multi-line list literals, no `..` in imports, a `test_`-prefixed function is a test, `import "pkg:beacons/src/lib.gu"` for dependencies.

## Review Focus

- A receipt whose checkpoint was re-signed by a different key, or whose operator key is not the pinned one, is `invalid` at step 2 (test with a swapped key).
- A TSA token for a different digest, an expired or unpinned TSA certificate, or a token whose `genTime` is later than the receipt's `g` is `invalid` at step 3.
- A source marked `absent-*` that had a pulse inside its window is `invalid` at step 4; a `present` pulse that is not the first after `t₀` (the receipt's `previous` is later than `t₀`) is `invalid`.
- Two entries with the same `entry_hash` (a resubmitted request) appear once in the receipt chain: a duplicate must not shift another draw's index.
- A checkpoint with an inclusion proof for a different leaf, or a tree of size 1 and size 2 (the boundary cases), verifies or fails correctly.
- A `not_before` in the future makes `t₀ = not_before` and the draw stays pending until then; a `not_before` in the past changes nothing.
- A log directory truncated or with a corrupted tile fails closed, never silently re-hashing.

---

### Task 1: RFC 6962 Merkle tree (`lotcast-log/src/merkle.gu`)

**Files:**
- Create: `packages/lotcast-log/guion.toml` (name `lotcast-log`, version 0.1.0, no network grants), `src/lib.gu`, `src/merkle.gu`, `tests.gu`
- Create: `reference/python/merkle_vectors.py` (independent RFC 6962 implementation that prints JSON vectors), `packages/lotcast-log/fixtures/merkle-vectors.json`

**Interfaces:**
- Produces: `leaf_hash(entry: Bytes) -> Bytes` (SHA-256 of `0x00 ‖ entry`), `node_hash(left: Bytes, right: Bytes) -> Bytes` (`0x01 ‖ l ‖ r`), `tree_root(leaves: List[Bytes]) -> Bytes` (empty tree is SHA-256 of the empty string), `inclusion_proof(leaves: List[Bytes], index: Int) -> Result[List[Bytes], StdError]`, `verify_inclusion(leaf: Bytes, index: Int, size: Int, proof: List[Bytes], root: Bytes) -> Bool`, `consistency_proof(leaves: List[Bytes], old_size: Int) -> Result[List[Bytes], StdError]`, `verify_consistency(old_size: Int, old_root: Bytes, new_size: Int, new_root: Bytes, proof: List[Bytes]) -> Bool`.

- [ ] **Step 1:** Write `reference/python/merkle_vectors.py` from RFC 6962 §2.1 (MTH, PATH, PROOF) and emit vectors for sizes 0 to 33 (every leaf's inclusion proof, every old-to-new consistency proof for sizes up to 9) into `fixtures/merkle-vectors.json`. Include the RFC 6962 / Certificate Transparency reference tree for eight leaves `d0..d7` as a hand-checked case.
- [ ] **Step 2:** Write failing tests in `tests.gu`: `test_root_matches_vectors` (every size), `test_inclusion_proofs_match_vectors`, `test_inclusion_rejects_wrong_leaf_index_size_and_root`, `test_consistency_proofs_match_vectors`, `test_consistency_rejects_tampered_proof`, `test_size_zero_and_one_edges`. Run `guion test` and see them fail.
- [ ] **Step 3:** Implement the signatures above in `merkle.gu`, using the RFC 6962 split at the largest power of two below `n`. `verify_*` follow RFC 9162 §2.1.3 and §2.1.4 (the iterative algorithms) so they never rebuild the tree.
- [ ] **Step 4:** `guion test` passes; commit `lotcast-log: RFC 6962 tree with inclusion and consistency proofs`.

### Task 2: Signed notes and checkpoints (`lotcast-log/src/note.gu`)

**Files:**
- Create: `packages/lotcast-log/src/note.gu`, `reference/python/note_vectors.py`, `packages/lotcast-log/fixtures/note-vectors.json`
- Modify: `packages/lotcast-log/tests.gu`

**Interfaces:**
- Consumes: Task 1 hashing; `crypto_ed25519_sign`, `crypto_ed25519_verify`, `crypto_ed25519_public_key`.
- Produces: `record Checkpoint: origin: Text, size: Int, root: Bytes, extensions: List[Text]`; `key_hash(name: Text, public_key: Bytes) -> Bytes` (first 4 bytes of SHA-256 of `name ‖ "\n" ‖ 0x01 ‖ public_key`); `sign_note(text: Text, name: Text, seed: Bytes) -> Result[Text, StdError]`; `add_signature(note: Text, name: Text, seed: Bytes) -> Result[Text, StdError]` (cosignature); `verify_note(note: Text, name: Text, public_key: Bytes) -> Result[Option[Text], StdError]` (returns the signed text when that key's signature is present and valid); `checkpoint_text(c: Checkpoint) -> Text` (`origin\nsize\nbase64(root)\n`); `parse_checkpoint(text: Text) -> Result[Checkpoint, StdError]`.

- [ ] **Step 1:** `note_vectors.py` implements the C2SP signed-note and tlog-checkpoint formats from their specs and emits a signed note, a two-signature note, a wrong-name case and a malformed-line case, all from a fixed seed.
- [ ] **Step 2:** Failing tests: `test_note_matches_python_vector`, `test_verify_accepts_only_the_named_key`, `test_second_signature_does_not_invalidate_first`, `test_tampered_text_fails`, `test_unknown_key_hash_is_ignored_not_error`, `test_checkpoint_round_trip`, `test_checkpoint_rejects_bad_size_and_bad_root_length`.
- [ ] **Step 3:** Implement. A signature line is `— <name> <base64(key_hash ‖ signature)>`; a note is text, one blank line, then signature lines. Verification ignores lines for other keys and fails only when the named key's line is wrong.
- [ ] **Step 4:** Tests pass; commit `lotcast-log: signed notes and checkpoints`.

### Task 3: tlog-tiles store and the append path (`lotcast-log/src/tiles.gu`, `log.gu`)

**Files:**
- Create: `packages/lotcast-log/src/tiles.gu`, `src/log.gu`, `reference/python/tiles_vectors.py`, `fixtures/tiles-vectors.json`
- Modify: `tests.gu`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `tile_path(level: Int, index: Int, partial: Int) -> Text` (the C2SP `tile/<L>/<x-encoded N>[.p/<W>]` path, `x`-prefixed 3-digit groups); `entry_bundle_path(index: Int, partial: Int) -> Text`; `record LogState: dir: Text, origin: Text, size: Int`; `log_open(dir: Text, origin: Text) -> Result[LogState, StdError]` (reads the latest checkpoint and checks every stored tile against it, or creates an empty log); `log_append(state: LogState, entry: Bytes, key_name: Text, seed: Bytes) -> Result[Tuple[LogState, Int], StdError]` (returns the new state and the entry's index; appends the entry bundle and tiles with `write_text_atomic`, signs the new checkpoint, rejects a duplicate `entry_hash`'s leaf by returning the existing index and state unchanged); `log_checkpoint(state: LogState) -> Result[Text, StdError]`; `log_inclusion(state: LogState, index: Int) -> Result[List[Bytes], StdError]`.

- [ ] **Step 1:** `tiles_vectors.py` builds a 1000-entry log, writes the tile files, and records the paths, the tile bytes' hashes and the checkpoint roots at sizes 1, 255, 256, 257, 1000.
- [ ] **Step 2:** Failing tests: `test_tile_paths_match_c2sp_examples` (including `x001/x234/067` and `.p/<W>` partial tiles), `test_log_root_matches_python_at_each_size`, `test_inclusion_from_tiles_verifies`, `test_reopen_after_append_gives_same_checkpoint`, `test_duplicate_entry_returns_existing_index`, `test_corrupt_tile_fails_open`, `test_truncated_log_fails_open`.
- [ ] **Step 3:** Implement with tile height 8. Tiles hold 32-byte hashes in order; entry bundles hold `lp`-prefixed entries as the tlog-tiles spec says. `log_open` recomputes the root from the stored tiles and compares it with the signed checkpoint, failing closed.
- [ ] **Step 4:** Tests pass; commit `lotcast-log: tlog-tiles store and append`.

### Task 4: RFC 3161 anchoring (`lotcast-log/src/anchor.gu`)

**Files:**
- Create: `packages/lotcast-log/src/anchor.gu`, `fixtures/tsa/{digicert,sectigo,freetsa}-{cert,issuer}.pem`, `fixtures/tsa/tokens.json` (real tokens fetched once for a fixed digest), `scripts/fetch_tsa_fixtures.sh`
- Modify: `guion.toml` (network grants for the three TSA hosts), `tests.gu`

**Interfaces:**
- Consumes: `crypto_tsa_request`, `crypto_tsa_response_token`, `crypto_tsa_verify`, `http_request_bytes`.
- Produces: `record TsaPin: id: Text, host: Text, cert_pem: Text, issuer_pem: Text`; `tsa_pins() -> List[TsaPin]` (digicert, sectigo, freetsa); `tsa_stamp(pin: TsaPin, digest: Bytes) -> Result[Bytes, StdError]` (network; returns the token, retries the same digest up to 3 times with `sleep_ms`); `tsa_check(pin: TsaPin, token: Bytes, digest: Bytes) -> Result[TsaToken, StdError]` (`Err` on `None`); `anchor_g(tokens: List[TsaToken]) -> Int` (spec formula, `δ = 1`); `choose_tsas(failed_for_seconds: Dict) -> List[Text]` (default two, fallback rule); `anchor_checkpoint(note: Text, pins: List[TsaPin]) -> Result[Json, StdError]` (digest is `SHA-512(note)`).

- [ ] **Step 1:** `fetch_tsa_fixtures.sh` fetches each pin's certificate chain once (`openssl s_client` or the TSA's published chain) and stamps a fixed 64-byte digest, saving the tokens. Record the fetch date and the certificates' validity end dates in `fixtures/tsa/README.md`.
- [ ] **Step 2:** Failing tests, all offline against the fixtures: `test_each_pinned_token_verifies`, `test_token_for_other_digest_fails`, `test_token_with_other_pin_fails`, `test_anchor_g_is_max_of_gen_time_plus_accuracy_plus_one_second_rounded_up`, `test_choose_tsas_defaults_and_fallback_after_600_seconds`. One network test, `test_live_stamp_round_trip`, is skipped unless `LOTCAST_LIVE=1`.
- [ ] **Step 3:** Implement. `anchor_checkpoint` returns `{"timestamps": [{"tsa", "token_b64"}], "g": <int>}`.
- [ ] **Step 4:** Run offline tests, then once with `LOTCAST_LIVE=1`; commit `lotcast-log: TSA anchoring with pinned authorities`.

### Task 5: The remaining three sources (`lotcast-core/src/sources.gu`)

**Files:**
- Create: `packages/lotcast-core/src/sources.gu`, `fixtures/sources/` (a real NIST pulse pair and certificate, real CURBy-RNG pulses with previous and chain, the latest CURBy-Q pulse and its chain, and a synthetic absent-proven pair)
- Modify: `packages/lotcast-core/src/lib.gu` and the `exports` list in `guion.toml`, `tests.gu`

**Interfaces:**
- Consumes: `beacons` `nist_verify`, `nist_pulse_from_json`, `nist_fetch*`, `curby_rng_randomness`, `curby_randomness`, `twine_*`, `drand_*`.
- Produces: `record SourceResult: id: Text, status: Text, value: Bytes, evidence: Json`; `resolve_nist(t0: Int) -> Result[SourceResult, StdError]`, `resolve_curby_rng(t0: Int) -> Result[SourceResult, StdError]`, `resolve_curby_q(t0: Int) -> Result[SourceResult, StdError]` (each fetches, verifies and applies §4.2); `check_nist(t0: Int, evidence: Json) -> Result[SourceResult, StdError]`, `check_curby_rng`, `check_curby_q` (offline verification of receipt evidence, spec §5.2 step 4); `status_code(status: Text) -> Int` (`present` 1, `absent-proven` 0, `absent-live` 0, `not-requested` 2); `window_seconds(id: Text, history: Json) -> Int`.

- [ ] **Step 1:** Settle the two "to confirm" values from real history: CURBy-RNG period and CURBy-Q median round time. Save the measured numbers and the pulses they came from in `fixtures/sources/windows.json`; the code reads that file's numbers as constants and a test pins them.
- [ ] **Step 2:** Failing tests per source: `test_*_present_first_pulse_after_t0`, `test_*_present_rejected_when_previous_is_after_t0`, `test_*_absent_proven_needs_two_linked_pulses_around_the_window`, `test_*_absent_claimed_while_pulse_in_window_is_rejected`, `test_curby_q_idle_is_absent_live_with_latest_pulse`, `test_absent_live_requires_checked_at_at_least_t0_plus_window`.
- [ ] **Step 3:** Implement the resolvers (network, `{status, evidence}`) and the offline checkers; both share the interval logic so they cannot disagree.
- [ ] **Step 4:** Tests pass; commit `lotcast-core: nist, curby-rng and curby-q sources with the inclusion rule`.

### Task 6: Anchored receipt v1 and the full verifier (`lotcast-core/src/receipt.gu`)

**Files:**
- Modify: `packages/lotcast-core/src/{receipt,seed,lib}.gu`, `tests.gu`, `reference/python/vectors.py`
- Create: `packages/lotcast-core/src/promise.gu`

**Interfaces:**
- Consumes: Tasks 1 to 5 and the first slice's `build_receipt`, `verify_receipt`, `seed`, `request_fields_ok`.
- Produces: `promise_text(index: Int, entry_hash: Bytes, epoch: Int) -> Text`; `build_anchored_receipt(request: Request, log_receipt: Json, sources: List[SourceResult], t0: Int) -> Result[Json, StdError]` (assembles spec §5.2 with `promise`, `log`, `anchor`, `sources`, `seed`, `outcome`, `attachments: []`); `verify_receipt(receipt: Json, operator_key: Bytes, pins: List[TsaPin]) -> Verdict` now runs steps 1 to 7, names the failing step number, and returns `verified`, `verified-pending-live` (listing the `absent-live` ids), `verified-unanchored` (only when `log` is null, as before) or `invalid`; `verify_receipt_with_question(receipt, operator_key, pins, question, salt)` for step 6 (hash mode; tlock mode opens the ciphertext after its round).

- [ ] **Step 1:** Extend `vectors.py` (independent) to produce full anchored receipts for a fixed seed, fixed tokens and fixed source evidence, plus a mutation list (each a one-field change with the step number that must fail).
- [ ] **Step 2:** Failing tests: `test_anchored_receipt_matches_python_seed_and_outcome`, `test_verdict_verified`, `test_verdict_pending_live_names_curby_q`, one `test_mutation_step_<n>_fails` per Review Focus bullet (swapped operator key → step 2; wrong-digest TSA token → step 3; late `genTime` → step 3; source dropped inside its window → step 4; previous pulse after `t0` → step 4; altered outcome → step 5; wrong salt → step 6), `test_unanchored_receipts_from_the_first_slice_still_verify_unanchored`.
- [ ] **Step 3:** Implement. The seed now takes real statuses and `SHA-512(C_e note)`. `request_fields_ok` is unchanged and still shared by builder and verifier. Remove the first slice's refusals that said `log`, `promise` and `anchor.g` must be empty, replacing them with the step 1 to 3 checks.
- [ ] **Step 4:** Whole suite passes (the old 68 plus the new); commit `lotcast-core: anchored receipt v1 and the offline verifier`.

### Task 7: The draw script on a local log, and docs

**Files:**
- Modify: `packages/lotcast-core/draw.gu`, `verify_receipt.gu`, `README.md`, `packages/lotcast-log/README.md` (create)
- Create: `packages/lotcast-core/tests_live.gu` (opt-in, `LOTCAST_LIVE=1`)

**Interfaces:**
- Consumes: Tasks 3 to 6.
- Produces: `guion run draw.gu <tradition> <method> [--option k=v]... [--question Q] [--log-dir DIR] [--key-file F] [--sources a,b,c]` creating or opening the log in `DIR`, appending the entry, waiting one epoch (`sleep_ms`), anchoring the checkpoint with the two pinned TSAs, resolving the requested sources after `t₀` (sleeping until each pulse or window ends), and printing the receipt; `guion run verify_receipt.gu receipt.json --operator-key HEX` prints the verdict and, on `invalid`, the failing step.

- [ ] **Step 1:** Failing test (`tests_live.gu`): a live end-to-end draw with `--sources drand-quicknet,nist-beacon-2,curby-rng,curby-q`, then verification, expecting `verified-pending-live` while CURBy-Q is idle.
- [ ] **Step 2:** Implement the script flow; the operator key is read from a file path argument (mode 600 check is advisory in the README, not enforced).
- [ ] **Step 3:** Run the live test once, save the resulting receipt as `fixtures/anchored-receipt-live.json`, and add an offline test that verifies it.
- [ ] **Step 4:** README: replace the unanchored warning with what an anchored receipt proves and what `verified-pending-live` means; keep the first slice's `verified-unanchored` note. State that witness submission, the HTTP service, scheduling and the CLI/MCP surfaces are the next plan.
- [ ] **Step 5:** Final run of all suites (`tests.gu`, `tests_enumerate.gu`, `tests_statistical.gu`, the log package); commit `lotcast: anchored draws on a local log, docs`.

## Out of scope for this plan (next plan, by dependency)

Witness cosignature submission and mirror audit; the HTTP service, source watcher, epoch loop and draw scheduler; the MCP server and CLI binary; the browser verifier; tlock question mode beyond verifying an opened ciphertext; tradition audits; the Rust reference stream and batteries. The verifier already accepts witness cosignatures that are present, so they need no receipt change later.

## Amendments after the whole-branch review

The review found that deriving `g` from the timestamp tokens lets an operator pick the outcome (re-stamping one checkpoint, or presenting a later one, and choosing the token pair). The build changed, and Hunchery PR #57 changed spec 3.2 to match:

- A checkpoint carries a signed `lotcast/epoch <epoch> <deadline>` line; `anchor.g` is the deadline; each token must prove the checkpoint existed by it (`proven_by_seconds(tokens) <= deadline`); the promise's epoch must equal the checkpoint's.
- `anchor_g` became `proven_by_seconds`; `anchor_checkpoint` returns `proven_by` instead of `g`; `log_append*` take the checkpoint's extension lines; the verifier requires `cosignatures` to be an empty list until it has witness keys.
- Also fixed: `not_before` is bounded (0 to 4102444800) and an out-of-range value is `invalid`, not a crash; a log with tiles but no checkpoint fails closed; the log has a writer lock and refuses a stale writer; a CURBy-Q chain that stalls mid-round ends as absent-live; NIST pulses are found by binary search; transient fetch errors are retried and permanent ones are not; `verify_receipt.gu` exits 3 for pending-live and checks the live chains with `--live`; the builder's self-check runs on the receipt after a JSON round trip; draw.gu falls back to FreeTSA when an authority fails.
