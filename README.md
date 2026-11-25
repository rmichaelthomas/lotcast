# Lotcast

A verifiable draw service for lot-cast divination, written in Guion. It returns positions, never meanings, with a receipt anyone can re-check.
Design spec: `docs/explore/agent-divination-tools/03-draw-service-design.md` in the Hunchery repository.
Code is Apache-2.0; the positions registry is CC0.

## Status

Guion 0.8.0 or later is needed (the `beacons` dependency installs from the Guion registry, `beacons` 0.3.0). Four parts:

- `packages/lotcast-core`: the stream and samplers (I Ching coins and yarrow, tarot RWS), the registry, the inclusion rule for all four beacons (drand quicknet, NIST beacon 2.0, CURBy-RNG, CURBy-Q), and a receipt verifier that runs spec §5.2 steps 1 to 7 offline.
- `service/`: the HTTP draw service (`lotcast serve`): a writer that appends requests to the log and promises each an epoch, a stamper that gets two RFC 3161 timestamps per epoch, a watcher that reads the beacons and completes receipts, and the API. See `service/README.md` and `docs/operations.md`.
- `cli/`: the `lotcast` command (`cli/lotcast.gu`): `draw`, `get`, `verify`, `compute` (an outcome from public log files and the beacons alone), `audit` (compare mirrors), `mcp` (a local stdio MCP server for AI clients; see `cli/README.md`) and `serve`.
- `packages/lotcast-log`: the append-only Merkle log (RFC 6962 hashing, C2SP signed notes and tlog-tiles) and RFC 3161 anchoring with pinned time-stamp authorities (DigiCert, Sectigo, FreeTSA).

### What an anchored receipt proves

A draw made with a log (`draw.gu --log-dir ... --key-file ...`) puts the request in the operator's signed log, has two time-stamp authorities stamp the log checkpoint, and reads every requested beacon's first pulse *after* the deadline the operator signed into that checkpoint (`lotcast/epoch <epoch> <deadline>`). Both timestamps must prove the checkpoint existed by the deadline, and the entry's promise must name that epoch, so the operator cannot re-stamp or swap checkpoints to move the anchor time. The receipt then proves:

1. the request was in the operator's log before any of the beacon pulses it uses existed (the timestamps), so the operator could not try requests until the outcome suited;
2. each beacon pulse is the first one after that time, or the beacon had none in its window (and what that means is in the receipt);
3. the outcome follows from the request, the checkpoint and those values, by a sampler anyone can re-run.

Verdicts: `verified` (every step passed offline), `verified-pending-live` (one or more sources had no pulse for this draw when the receipt was made, as CURBy-Q has been idle since 2025-08-22, or stalled mid-round; the receipt says which, and the verifier script exits 3 until the live check is done with `--live`), `verified-unanchored` (a receipt with no log, from the first slice: it shows the outcome follows from a real drand round, not that the request came first) and `invalid` (with the first failing step).

What an anchored receipt does **not** yet have: witness cosignatures from public tlog witnesses, timelocked questions and signed subject keys (both refused with named errors). Not built yet: the browser verifier, the tradition audits (Marseille and Thoth tarot are refused until theirs exist), the stream batteries and the Rust reference stream, deployment, and publishing `lotcast-core` and `lotcast-log` to the Guion registry. A single operator key signs the log; a hosted deployment adds mirrors and witnesses so that one party cannot rewrite history.

### Use

```
cd packages/lotcast-core

# unanchored: drand only, no log
guion run --allow-http-host api.drand.sh --allow-http-host drand.cloudflare.com --allow-clock \
    draw.gu iching yarrow > receipt.json
guion run --file-root . verify_receipt.gu receipt.json

# anchored: a log directory and the operator's key file (--new-key creates it)
guion run --allow-clock --file-root . \
    --allow-http-host api.drand.sh --allow-http-host drand.cloudflare.com \
    --allow-http-host beacon.nist.gov --allow-http-host random.colorado.edu \
    --allow-http-host timestamp.digicert.com --allow-http-host timestamp.sectigo.com \
    draw.gu iching coins --log-dir log --key-file operator.key --new-key \
    --sources nist-beacon-2,curby-rng,curby-q > receipt.json     # prints operator_key=HEX to stderr
guion run --file-root . verify_receipt.gu receipt.json --operator-key HEX
# a receipt that is verified-pending-live exits 3 until the live chains are asked again:
guion run --allow-clock --allow-http-host beacon.nist.gov --allow-http-host random.colorado.edu \
    --file-root . verify_receipt.gu receipt.json --operator-key HEX --live
```

`--epoch-seconds N` (default 20) is how long the two timestamps have to arrive after the entry is logged; a draw whose authorities are slower fails and says so. The log is locked while a draw writes to it (a crashed draw can leave `lock/` in the log directory: remove it once no draw is running). A request that is already in the log is refused rather than drawn again. If a draw fails after its entry was logged, the index is printed to stderr; the entry stays in the log.

A draw with CURBy-Q waits until its window has closed (about 32 minutes while the chain is idle). The other sources take one to three minutes. `--question TEXT` keeps the question on your machine: the receipt holds only its SHA-512 commitment and the salt is printed to stderr.

### The service and the `lotcast` command

```
cd cli
guion run --allow-bind 127.0.0.1:8080 --allow-clock --file-root DATA --allow-http-host ... \
    lotcast.gu serve --data-dir data --key-file operator.key --new-key --registry registry.json
guion run --allow-clock --allow-http-host 127.0.0.1 --allow-http-host ... lotcast.gu draw iching coins --server http://127.0.0.1:8080
```

`lotcast draw` builds the request on your machine (the question, if any, stays here; only its commitment is
sent and the salt is printed on stderr), checks that the service logged the entry you sent, waits, and
verifies the receipt itself. Exit codes: 0 verified, 1 invalid or failed, 2 bad arguments, 3 verified apart
from a live check still owed, 4 still pending. `lotcast compute INDEX --mirror URL` recomputes the outcome of
a logged request from the mirror's tiles, the epoch checkpoint and the beacons, without asking the service for
it. `lotcast audit --mirror A --mirror B` checks that every mirror holds a prefix of the longest one and names
the first index where one differs.

### Tests

```
cd service && guion test && guion test tests_routes.gu    # the service (tests_live.gu makes a real stamp)
cd cli && guion test && guion test tests_home.gu && guion test tests_mcp.gu
```


```
cd packages/lotcast-core
guion test                       # unit tests, with vectors from reference/python
guion test tests_enumerate.gu    # exact odds by enumeration (spec §7.1)
guion test tests_statistical.gu  # chi-square on the real stream (spec §7.2, 20,000 draws)
guion run --allow-clock --allow-http-host beacon.nist.gov --allow-http-host random.colorado.edu tests_live.gu   # live resolvers
cd ../lotcast-log
guion test                       # Merkle, notes, tiles, TSA tokens against independent vectors
guion run --allow-http-host timestamp.digicert.com --allow-http-host timestamp.sectigo.com tests_live.gu   # live stamp
python3 reference/python/verify_anchored.py packages/lotcast-core/fixtures/anchored-receipt.json   # independent re-check
```

The vectors come from Python written from the specifications, not from the Guion code: `reference/python/{vectors,merkle_vectors,note_vectors,tiles_vectors,verify_anchored}.py`. The fixtures include real pulses from NIST and CURBy, real time-stamp tokens from three authorities, and real anchored receipts. After changing `packages/lotcast-log` or `packages/lotcast-core`, run `guion update` in the packages that depend on them (`packages/lotcast-core`, `service`, `cli`) to refresh their locks.

`tools/gen_registry.gu` generates the CC0 registry (`registry/lotcast-registry-v1.json`) and `src/registry_data.gu` from one source (`guion run --file-root . tools/gen_registry.gu`). Run it after any change to the registry data. `tools/measure_windows.gu` re-measures the CURBy source windows and `tools/fetch_source_fixtures.gu` refreshes the pulse fixtures (each file's header gives its command); `guion test tools/tests.gu` covers their date helpers. The only Python in the repository is `reference/python/`, the independent verifier the spec asks for; it is deliberately not Guion, so that it can check the Guion code.
