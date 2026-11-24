# lotcast-core, first slice: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `lotcast-core` Guion package far enough that an I Ching (coins and yarrow) or tarot (RWS) draw seeded from a real drand round produces a receipt, and a script re-checks any such receipt offline.

**Architecture:** Pure Guion, no network inside the core. Layers, each its own file: byte encoders, the SHA-512 counter-mode stream with the three primitives, entry and seed construction, samplers, the positions registry, receipt build and verify. `scripts/` holds two thin programs: `draw.gu` (fetches a drand round, builds a receipt) and `verify_receipt.gu` (checks one). Test vectors come from an independent `python3` script written from the spec, never from the Guion code.

**Tech Stack:** Guion (current `main`, artifact format 89), `std:crypto` (`crypto_sha512`), the `beacons` package 0.3.0 (`drand_verify`, `drand_round_at`, `drand_fetch`, `drand_quicknet`), `python3` with `hashlib` for vectors.

**Spec:** `/Users/rmichaelthomas/hunchery/docs/explore/agent-divination-tools/03-draw-service-design.md` (§4, §5.1–5.3, §7.1, §7.2, §11 step 2). Read §4 and §5.2 before Task 3.

## Global Constraints

- Repository `~/lotcast`, package `packages/lotcast-core`, code Apache-2.0, registry data CC0.
- Every hash is SHA-512. `lp(x)` is a 4-byte big-endian length then the bytes. Integers are big-endian at fixed width. Domain tags are ASCII, exactly: `lotcast/entry/v1`, `lotcast/seed/v1`, `lotcast/stream/v1`, `lotcast/question/v1`, `lotcast/test/v1`.
- Receipt id `lotcast/receipt/v1`, sampler id `lotcast/sampler/v1`, registry id `lotcast/registry/v1`.
- `block(i) = SHA-512("lotcast/stream/v1" ‖ seed ‖ u64(i))`; words are each block split into 8 big-endian u64, in order.
- `uniform(n)`, `1 ≤ n ≤ 2³²`: next word `x`; `limit = 2^w − (2^w mod n)`; reject while `x ≥ limit`; return `x mod n`. `w` is the word width in bits: 64 in production, a parameter so tests can use 8.
- `weighted(ws)`: `r = uniform(Σws)`, first index whose running total exceeds `r`. `shuffle(n)`: Fisher–Yates, `i = n−1` down to `1`, swap `i` with `uniform(i+1)`. `bit() = uniform(2)`.
- Use `python3`, never `python`. Guion's `Int` is arbitrary precision, so `2^64` is plain arithmetic; `int_and` and the shifts are signed 64-bit and must not be used on words.
- Output is positions only: registry ids, never meanings.
- Do not touch any project-level CLAUDE.md or AGENTS.md.

## Rulings made in this plan (cost if wrong)

| Ruling | Cost if wrong |
|---|---|
| The slice has no log or timestamps yet. A receipt carries `"log": null`, the seed uses `lp(empty)` where `lp(SHA-512(C_e note))` goes, and the verifier returns `verified-unanchored`, naming steps 2–3 as not checked. It never claims property 4 | When `lotcast-log` lands, anchored receipts use the real checkpoint hash. Unanchored ones keep verifying under their own rule, so nothing breaks |
| Sources in the slice: drand only. The other three ids are in the seed with status `2` (not requested), exactly as §4.3 fixes | None: it is the spec's own encoding |
| Tarot ships `rws` only. `marseille` and `thoth` differ in ids and names, which §6 fixes at audit, so they return `audit-pending` like astragali until their audits land | Two methods unavailable until step 3 of §11, as the spec already requires |
| The spec's I Ching example "23, lines 2 and 5 changing → 20" is wrong. 23 (Bo) with only line 5 changing gives 20 (Guan). Task 8 corrects the spec | A docs fix |
| Relating hexagram is `null` when no line changes | One field |
| Yarrow weights `[1,5,7,3]` for 6,7,8,9 ship with the catalogue entry `audit: "odds-unconfirmed"`; the audit confirms | Weights change in a new sampler version |

## Review Focus

1. `uniform(n)` at `n = 1`, at `n` a power of two, and at `n = 2³²`: never loops forever, never returns `n`. Tested in Task 2.
2. A stream asked for more than one block of words (more than 8 `uniform` calls): the block counter advances. Tested in Task 2.
3. A receipt whose `outcome` was edited, whose drand `randomness` was edited, or whose round is not `drand_round_at(t0)+1`: `invalid` with the failing step named. Tested in Task 7.
4. Tarot `count` of 0, 1, 78, 79 and `majors_only` with `count` over 22: a clear error for out-of-range, never a short or repeated draw. Tested in Task 5.
5. Options in a different order in the request give the same `entry_hash` (canonical sorted `key=value` lines). Names and values are exact: a different case (`Count`, `True`) is an unknown option or a bad value, an error, never folded or ignored. Tested in Task 3.

## File structure

```
~/lotcast/
  LICENSE (Apache-2.0)  README.md  .gitignore
  packages/lotcast-core/
    guion.toml                 package, dependency on beacons, capabilities (network for scripts only)
    src/lib.gu                 re-exports
    src/encode.gu              u8/u32/u64 big-endian, lp, concat, bytes<->Int, hex
    src/stream.gu              Stream record, block/word generation, tape mode for enumeration
    src/primitives.gu          uniform, weighted, shuffle, bit
    src/entry.gu               canonical options, entry bytes, entry_hash, question commit
    src/seed.gu                seed from entry_hash, checkpoint hash, source statuses
    src/registry.gu            hexagram table, trigrams, tarot rws ids (CC0 data)
    src/iching.gu              coins, yarrow, hexagram + relating
    src/tarot.gu               rws draw
    src/catalogue.gu           method list with odds specs and audit status
    src/receipt.gu             build and verify (steps 1, 4, 5, 6; 2 and 3 reported as not run)
    tests.gu                   unit tests
    tests_enumerate.gu         exact distributions (§7.1)
    tests_statistical.gu       chi-square on the real stream (§7.2)
    scripts/draw.gu            fetch a drand round, draw, print receipt JSON
    scripts/verify_receipt.gu  read receipt JSON, print result
  reference/python/vectors.py  independent vector generator (from the spec)
  registry/lotcast-registry-v1.json   the CC0 data file
  odds/*.json                  exact rational odds per method
```

---

### Task 1: Repository and encoders

**Files:**
- Create: repo skeleton above, `packages/lotcast-core/guion.toml`, `src/lib.gu`, `src/encode.gu`, `tests.gu`
- Test: `packages/lotcast-core/tests.gu`

**Interfaces:**
- Produces (all in `encode.gu`):
  - `pub fn u8_bytes(x: Int) -> Bytes`, `pub fn u32_bytes(x: Int) -> Bytes`, `pub fn u64_bytes(x: Int) -> Bytes` (big-endian; out-of-range is a program error via `assert`)
  - `pub fn lp(b: Bytes) -> Bytes`
  - `pub fn cat(parts: List[Bytes]) -> Bytes`
  - `pub fn bytes_to_int(b: Bytes) -> Int` (big-endian unsigned, arbitrary length)
  - `pub fn text_bytes(t: Text) -> Bytes`

- [ ] **Step 1:** `git init` in `~/lotcast`; add Apache-2.0 `LICENSE`, a `.gitignore` (`/target`, `.superpowers/`, `/scratch/`), and a `README.md` of five lines naming the project, the spec path and "positions, never meanings". Create `packages/lotcast-core/guion.toml` (name `lotcast-core`, version `0.1.0`, entry `src/lib.gu`, exports every `src/*.gu`) and add `beacons` with `guion add beacons` from the package directory (registry copy at 0.3.0 if published, else `--path ~/guion/packages/beacons`; record which in the commit message). Declare `[capabilities] network = ["api.drand.sh", "drand.cloudflare.com"]` and `clock = true`.
- [ ] **Step 2: Write failing tests** `test_u64_bytes_big_endian` (`u64_bytes(1) == bytes_from_ints([0,0,0,0,0,0,0,1])`, `u64_bytes(2^64-1)` is eight `255`s), `test_lp_prefixes_four_byte_length` (`lp(text_bytes("ab")) == bytes_from_ints([0,0,0,2,97,98])`, `lp` of empty is `[0,0,0,0]`), `test_bytes_to_int_round_trips_u64` for 0, 1, 255, 256, 2^63, 2^64-1.
- [ ] **Step 3:** Run `cd packages/lotcast-core && guion test`; expect failures naming the missing functions.
- [ ] **Step 4:** Implement the five functions in `src/encode.gu`. `u64_bytes` must not use `int_shift_right` or `int_and` on values at or above 2^63 (signed); use `//` and `%` by 256.
- [ ] **Step 5:** Run `guion test`; expect all pass. Commit `feat: scaffold lotcast-core and byte encoders`.

### Task 2: Stream and primitives, exact by enumeration (§4.3, §7.1 primitives)

**Files:**
- Create: `src/stream.gu`, `src/primitives.gu`; extend `tests.gu`; create `tests_enumerate.gu`

**Interfaces:**
- Consumes: Task 1 encoders.
- Produces:
  - `pub record Stream` (seed `Bytes`, word width `Int`, next block index `Int`, current words `List[Int]`, position `Int`; plus a `tape` mode described below)
  - `pub fn stream_new(seed: Bytes, word_bits: Int) -> Stream`
  - `pub record DrawInt: value: Int, stream: Stream`
  - `pub fn uniform(s: Stream, n: Int) -> DrawInt`, `pub fn weighted(s: Stream, ws: List[Int]) -> DrawInt`, `pub fn bit(s: Stream) -> DrawInt`
  - `pub record DrawList: values: List[Int], stream: Stream`; `pub fn shuffle(s: Stream, n: Int) -> DrawList`
  - Tape mode: `pub fn stream_tape(choices: List[Int]) -> Stream` serves primitive results from `choices` in order, returning 0 once exhausted, and records every call's modulus (`n`, or `Σws`, or `i+1` for shuffle) in `pub fn stream_trace(s: Stream) -> List[Int]`. Enumeration needs this and nothing in production uses it.
- `word_bits` below 64: at width 8 each block yields 64 words of one byte each (the block's bytes in order); at 64, eight u64 words. State this rule in a comment; the spec's "8-bit words" test mode needs it.

- [ ] **Step 1: Write failing tests** `test_stream_matches_python_vector` (the first 16 words of seed `00…00` (64 zero bytes) at width 64 equal the values in `reference/python/vectors.py` output, pasted as literals), `test_stream_second_block_advances` (word 8 differs from word 0 and equals the first word of `SHA-512("lotcast/stream/v1" ‖ seed ‖ u64(1))`), `test_uniform_one_is_always_zero`, `test_uniform_never_returns_n` (n = 2^32, 1000 draws), `test_uniform_power_of_two_never_rejects` (n = 8 consumes exactly one word per call).
- [ ] **Step 2:** Write `reference/python/vectors.py` with `stream_words(seed, i)` and print the vectors; run `python3 reference/python/vectors.py`. It is written from the spec text only.
- [ ] **Step 3:** In `tests_enumerate.gu` write `test_uniform_exact_every_n_1_to_256` (at width 8, for each `n`, for each of the 256 word values: result is rejected iff `x ≥ 256 − 256 % n`, otherwise `x % n`, and every residue is hit exactly `256 // n` times), `test_weighted_exact` (weights `[1,5,7,3]`, `[2,2]`, `[1]`, `[3,1,2]` at width 8: each index hit `w_i * (256 // Σw)` times), `test_shuffle_every_permutation_equally_n_up_to_8` (enumerate the tape: for n = 1..8, every permutation appears the same number of times and all n! appear).
- [ ] **Step 4:** Run `guion test`; expect failures. Implement `stream.gu` and `primitives.gu`. Rejection loops must terminate for any seed (the loop re-reads words; it cannot spin without consuming).
- [ ] **Step 5:** Run `guion test`; all pass. Commit `feat: SHA-512 stream, uniform/weighted/shuffle, exact enumeration tests`.

### Task 3: Entry and seed (§4.1, §4.3)

**Files:**
- Create: `src/entry.gu`, `src/seed.gu`; extend `tests.gu`, `reference/python/vectors.py`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `pub record Request: tradition: Text, method: Text, options: Map[Text, Text], question_mode: Int, question_commit: Bytes, sources: List[Text], not_before: Int, client_nonce: Bytes, subject_key: Bytes`
  - `pub fn canonical_options(options: Map[Text, Text]) -> Result[Text, StdError]` (sorted `key=value` lines joined by `"\n"`, UTF-8; a key or value containing `=` or a newline is `Err`)
  - `pub fn entry_bytes(r: Request) -> Result[Bytes, StdError]`; `pub fn entry_hash(r: Request) -> Result[Bytes, StdError]`
  - `pub fn question_commit(question: Text, salt: Bytes) -> Bytes` (`SHA-512("lotcast/question/v1" ‖ lp(question) ‖ lp(salt))`; salt must be 32 bytes, else a program error)
  - `pub record SourceValue: id: Text, status: Int, value: Bytes` (status 1 present, 0 absent, 2 not requested)
  - `pub fn seed(entry_hash: Bytes, checkpoint_hash: Bytes, sources: List[SourceValue]) -> Bytes`: `checkpoint_hash` is the 64-byte `SHA-512(C_e note)` or **empty** for an unanchored draw. `sources` must be exactly the four ids in the fixed order `drand-quicknet, nist-beacon-2, curby-rng, curby-q`, else a program error. Uses `lp(checkpoint_hash)`.

- [ ] **Step 1: Write failing tests** `test_entry_hash_matches_python_vector` (two requests, hash mode and no-question mode, hashes pasted from `vectors.py`), `test_options_order_does_not_change_the_entry_hash` (`{"count":"3","reversals":"half"}` built in both orders), `test_option_with_equals_sign_is_an_error`, `test_question_commit_matches_python_vector`, `test_seed_matches_python_vector` (anchored with a 64-byte checkpoint hash, and unanchored with empty), `test_unanchored_and_anchored_seeds_differ`, `test_seed_sources_out_of_order_is_rejected`.
- [ ] **Step 2:** Extend `vectors.py` with `entry_hash`, `question_commit`, `seed`, written from §4.1 and §4.3. Run and paste the literals.
- [ ] **Step 3:** Run `guion test`; expect failures. Implement both files. `sources` in the entry is `lp` of the sorted ids comma-joined; `not_before` is `u64`; `question_mode` is `u8`.
- [ ] **Step 4:** Run `guion test`; all pass. Commit `feat: entry hash, question commitment and seed`.

### Task 4: Registry and I Ching samplers (§5.1, §5.3, §7.1)

**Files:**
- Create: `src/registry.gu` (hexagrams and trigrams), `src/iching.gu`, `registry/lotcast-registry-v1.json` (the same data, CC0), `odds/iching-coins.json`, `odds/iching-yarrow.json`; extend `tests.gu`, `tests_enumerate.gu`

**Interfaces:**
- Consumes: Task 2 primitives.
- Produces:
  - `pub fn hexagram_number(lines: List[Int]) -> Int` where `lines` are six values from 6,7,8,9 bottom to top; yang is 7 or 9
  - `pub fn hexagram_id(n: Int) -> Text` returning `iching:hexagram:<n>`
  - `pub record IChing: lines: List[Int], hexagram: Int, changing: List[Int], relating: Option[Int]` (`changing` is line positions 1–6 bottom to top, ascending)
  - `pub fn iching_coins(s: Stream) -> IChingDraw`, `pub fn iching_yarrow(s: Stream) -> IChingDraw` (`IChingDraw: result: IChing, stream: Stream`)
- Data: lower trigram bits bottom to top: Qian 111, Zhen 100, Kan 010, Gen 001, Kun 000, Xun 011, Li 101, Dui 110. King Wen number is `KW[lower][upper]` with both indexed in the order Qian, Zhen, Kan, Gen, Kun, Xun, Li, Dui:

```
lower\upper  Qian Zhen Kan Gen Kun Xun Li  Dui
Qian          1   34   5   26  11  9   14  43
Zhen          25  51   3   27  24  42  21  17
Kan           6   40   29  4   7   59  64  47
Gen           33  62   39  52  15  53  56  31
Kun           12  16   8   23  2   20  35  45
Xun           44  32   48  18  46  57  50  28
Li            13  55   63  22  36  37  30  49
Dui           10  54   60  41  19  61  38  58
```

Registry ids carry the bit pattern and the Chinese and English names (identifiers only; no meanings): the implementer fills names from the audit-free standard list of the 64 hexagram names (Qian/The Creative, Kun/The Receptive, and so on); a name that cannot be confirmed from a public source is left as the pinyin alone.

- [ ] **Step 1: Write failing tests** `test_king_wen_table_is_a_permutation_of_1_to_64`, `test_king_wen_pairs_are_reverse_or_inverse` (for k in 1..32, hexagram `2k−1` and `2k` have line patterns that are each other's reverse or each other's complement; this catches transcription typos), `test_anchor_hexagrams` (all-yang 1, all-yin 2, lines `[8,8,8,8,8,7]` → 23, `[7,7,7,7,7,7]` → 1, `[8,8,8,8,8,8]` → 2, `[8,8,8,8,8,7]` → 23, `[8,8,8,8,7,7]` → 20, `[8,7,8,8,7,8]` → 29, `[7,8,7,7,8,7]` → 30, `[7,7,7,8,8,8]` → 11, `[8,8,8,7,7,7]` → 12), `test_changing_lines_and_relating` (23 with only line 5 changing gives relating 20; no changing lines gives `None`; all six changing gives the complement), `test_coins_line_values_and_changing` and `test_yarrow_line_values` (with a fixed stream, outputs match `vectors.py` values).
- [ ] **Step 2: Exact enumeration** in `tests_enumerate.gu`: `test_coins_one_line_exact_odds` (enumerate three `bit()` calls: values 6:7:8:9 = 1:3:3:1 over 8 outcomes, heads = 3, tails = 2, sum), `test_yarrow_one_line_exact_odds` (enumerate `weighted([1,5,7,3])`: 1/16, 5/16, 7/16, 3/16), `test_coins_changing_probability_is_one_quarter`, `test_yarrow_old_yang_is_three_times_old_yin`. The distributions must equal the files in `odds/` (loaded and compared as rationals).
- [ ] **Step 3:** Run `guion test`; expect failures. Implement. Coins: per line, three `bit()` calls, heads=1 counts as 3 and tails as 2, summed. Yarrow: `weighted([1,5,7,3])` mapped to 6,7,8,9 in that order. Lines are drawn bottom (line 1) first.
- [ ] **Step 4:** Run `guion test`; all pass. Commit `feat: I Ching hexagram registry, coins and yarrow samplers`.

### Task 5: Tarot RWS sampler (§5.1, §5.3)

**Files:**
- Create: `src/tarot.gu`; extend `src/registry.gu`, `tests.gu`, `tests_enumerate.gu`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `pub fn rws_deck() -> List[Text]`: 78 ids in registry order: `tarot:rws:major:0`…`major:21`, then `tarot:rws:wands:1`…`14`, `cups`, `swords`, `pentacles` (1 is Ace, 11 Page, 12 Knight, 13 Queen, 14 King)
  - `pub record TarotCard: id: Text, reversed: Bool`
  - `pub record TarotDraw: cards: List[TarotCard], stream: Stream`
  - `pub fn tarot_rws(s: Stream, count: Int, majors_only: Bool, reversals: Bool) -> Result[TarotDraw, StdError]`: `shuffle(78)` (or 22), take the first `count`, then `bit()` per card in order when `reversals`. `count` outside `1..deck size` is `Err` (code `E_LOTCAST_COUNT`).

- [ ] **Step 1: Write failing tests** `test_rws_deck_has_78_unique_ids_in_order`, `test_count_zero_one_78_79`, `test_majors_only_count_23_is_an_error`, `test_no_card_repeats`, `test_reversals_drawn_after_shuffle` (stream consumption is exactly shuffle's words then one `uniform(2)` per card; compare against a hand-run with `vectors.py`), `test_tarot_exact_position_odds_n8` in `tests_enumerate.gu` (deck shrunk to 8 through a helper taking the deck as a parameter, `count` 3: each card in each position 1/8, reversed 1/2).
- [ ] **Step 2:** Run; expect failures. Implement, with the sampler taking the deck list as a parameter internally so the enumeration test can shrink it while production passes `rws_deck()`.
- [ ] **Step 3:** Run `guion test`; pass. Commit `feat: tarot rws sampler and deck registry`.

### Task 6: Catalogue and options (§5.1)

**Files:**
- Create: `src/catalogue.gu`; extend `tests.gu`

**Interfaces:**
- Produces:
  - `pub record Method: tradition: Text, method: Text, status: Text, audit: Text, odds: Text`
  - `pub fn catalogue() -> List[Method]`: `iching/coins` (`status "ready"`, `audit "pending"`), `iching/yarrow` (`audit "odds-unconfirmed"`), `tarot/rws` (`audit "pending"`), `tarot/marseille` and `tarot/thoth` (`status "audit-pending"`)
  - `pub fn run_method(s: Stream, tradition: Text, method: Text, options: Map[Text, Text]) -> Result[Json, StdError]`: dispatches; options are validated (`count` integer, `majors_only` and `reversals` as `"true"/"false"`, defaults `count=1`, `majors_only=false`, `reversals=false`); an unknown option or method is `E_LOTCAST_OPTION` / `E_LOTCAST_METHOD`; an `audit-pending` method is `E_LOTCAST_AUDIT_PENDING` and consumes no stream

- [ ] **Step 1: Write failing tests** `test_unknown_option_is_an_error`, `test_unknown_method_is_an_error`, `test_marseille_and_thoth_refuse`, `test_defaults_applied_and_drawn`, `test_outcome_json_shape_iching` (`lines`, `hexagram` as a number, `changing`, `relating` as number or `null`), `test_outcome_json_shape_tarot` (`cards`: list of `{id, reversed}`).
- [ ] **Step 2:** Run; expect failures. Implement. Commit `feat: method catalogue and option validation`.

### Task 7: Receipt build and verify (§5.2 steps 1, 4, 5, 6)

**Files:**
- Create: `src/receipt.gu`; extend `tests.gu`; create `tests/fixtures/drand-round-*.json` (one real recorded quicknet round)

**Interfaces:**
- Consumes: Tasks 3, 6; `beacons`: `drand_verify`, `drand_round_at`, `drand_quicknet`.
- Produces:
  - `pub fn build_receipt(request: Request, t0: Int, drand: DrandRound) -> Result[Json, StdError]`: checks `drand.round == drand_round_at(chain, t0) + 1`, runs the method on `stream_new(seed, 64)`, returns the §5.2 JSON with `"log": null`, `"promise": null`, `"anchor": {"g": null, "not_before": N, "t0": t0}`, `sources` listing only drand as `present` with `round`, `signature`, `randomness` hex, and `outcome` from `run_method`
  - `pub record Verdict: result: Text, failed_step: Int, detail: Text, not_checked: List[Int]` where `result` is `verified-unanchored`, `verified-pending-live` or `invalid`
  - `pub fn verify_receipt(receipt: Json) -> Verdict`
- Verification order (spec §5.2): 1 rebuild entry and its hash from `request` (the receipt carries no `log` here, so only the hash is recomputed); 4 for drand, `round == drand_round_at(t0) + 1` by arithmetic and `drand_verify` on `(round, signature, randomness)`; 5 recompute the seed, run the sampler named by `sampler`, compare with `outcome` (structural equality of the JSON); 6 if the request supplies `question` and `salt` (both hex or text per the receipt's `question.mode`), check the commitment. Steps 2 and 3 are listed in `not_checked` and the result is `verified-unanchored` when the rest pass. An unknown `receipt`, `sampler` or `registry` id is `invalid` at step 1.

- [ ] **Step 1:** Fetch one real quicknet round with `curl -s https://api.drand.sh/<chain-hash>/public/<round>` (chain hash from `drand_quicknet().hash`, a round from this month) and save it as the fixture; record the round number in the test.
- [ ] **Step 2: Write failing tests** `test_build_then_verify_is_verified_unanchored` (I Ching coins, then tarot rws with `count=3 reversals=true`), `test_edited_outcome_is_invalid_at_step_5`, `test_edited_randomness_is_invalid_at_step_4`, `test_edited_signature_is_invalid_at_step_4`, `test_wrong_round_for_t0_is_invalid_at_step_4`, `test_edited_request_option_changes_the_seed_and_fails_step_5`, `test_unknown_receipt_id_is_invalid`, `test_question_commit_checked_when_supplied_and_wrong_salt_fails`, `test_not_checked_lists_steps_2_and_3`. Every `invalid` case asserts the exact `failed_step`.
- [ ] **Step 3:** Run; expect failures. Implement. `build_receipt` is the only function that draws; `verify_receipt` never touches the network or clock.
- [ ] **Step 4:** Run `guion test`; pass. Commit `feat: receipt build and offline verify`.

### Task 8: Scripts, statistical tests, docs

**Files:**
- Create: `scripts/draw.gu`, `scripts/verify_receipt.gu`, `tests_statistical.gu`; modify `README.md`; modify `/Users/rmichaelthomas/hunchery/docs/explore/agent-divination-tools/03-draw-service-design.md` (example only)

- [ ] **Step 1:** `scripts/draw.gu`: arguments `tradition method [key=value …]`, optional `--question TEXT`. It sets `t0` from the clock, waits (`sleep_ms`) until `drand_round_at(t0)+1` exists, fetches it with `drand_fetch`, verifies it, picks a random 32-byte `client_nonce` (and salt for `--question`), builds the receipt and prints it to stdout as JSON. Exit 1 with the error message on any `Err`.
- [ ] **Step 2:** `scripts/verify_receipt.gu FILE`: reads the receipt, prints `result`, and for `invalid` the `failed_step` and `detail`; lists `not_checked`. Exit 0 only for `verified-unanchored`, `verified-pending-live` or a future `verified`; exit 1 for `invalid`; exit 2 for unreadable input.
- [ ] **Step 3:** `tests_statistical.gu` (run by `guion test tests_statistical.gu`, not on every commit; 10⁷ draws is too slow for the VM, so the draw count is a constant `DRAWS` set to 200,000 in the file with a comment that the full 10⁷ run is the §7.3 reference implementation's job): `test_iching_coins_line_values_chi_square`, `test_iching_yarrow_line_values_chi_square`, `test_tarot_card_by_position_chi_square`, `test_tarot_reversal_rate`, each over seeds `SHA-512("lotcast/test/v1" ‖ u64(k))` for `k` in `0..DRAWS`, a chi-square against the exact odds with the critical value for α = 0.001 / 4 (Bonferroni across these four) computed from a table in the file. The test prints the statistic for each.
- [ ] **Step 4: Live end-to-end** (the proof): `guion run scripts/draw.gu iching yarrow > receipt-yarrow.json` (in the repo's git-ignored `scratch/` directory), then `guion run scripts/verify_receipt.gu <that file>` prints `verified-unanchored`. Edit one digit of the saved `outcome` and confirm the verifier prints `invalid` at step 5. Do the same for `tarot rws count=3 reversals=true`. Paste both results into the commit message.
- [ ] **Step 5:** Fix the spec example in `03-draw-service-design.md` §1 ("lines 2 and 5 changing → hexagram 20" becomes "line 5 changing → hexagram 20") and add one line to `README.md` stating that this slice produces unanchored receipts and what is not yet covered (log, timestamps, other sources, other methods) as the next steps of §11, not as limits.
- [ ] **Step 6:** Run `guion test` in `packages/lotcast-core` (all pass) and `guion test tests_statistical.gu` (all pass). Commit `feat: draw and verify scripts, statistical tests`.

## Self-review

- **Spec coverage:** §4.1–4.3 (Tasks 2–3), §5.1 I Ching and tarot rows (Tasks 4–5), §5.2 steps 1, 4, 5, 6 (Task 7; 2–3 reported not-run, by ruling), §5.3 registry for these two traditions (Tasks 4–5), §7.1 for primitives, I Ching lines and tarot (Tasks 2, 4, 5), §7.2 per-method statistical (Task 8). Not in this plan, by dependency and not by cut: the other methods and their audits, `lotcast-log`, the other three sources, the Python verifier's 10,000 vectors, the batteries. They follow in §11 order.
- **Types:** `Stream`, `DrawInt`, `DrawList`, `Request`, `SourceValue`, `IChing`, `TarotCard`, `Verdict` are defined once and used with the same names later.
- **Proportion:** the plan holds signatures, test names with their key assertions, and the one table (King Wen) the implementer cannot derive; bodies are left to them.
