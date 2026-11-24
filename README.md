# Lotcast

A verifiable draw service for lot-cast divination, written in Guion. It returns positions, never meanings, with a receipt anyone can re-check.
Design spec: `docs/explore/agent-divination-tools/03-draw-service-design.md` in the Hunchery repository.
Code is Apache-2.0; the positions registry is CC0.

## Status

Two packages, both needing Guion 0.8.0 or later (the `beacons` dependency installs from the Guion registry, `beacons` 0.3.0):

- `packages/lotcast-core`: the stream and samplers (I Ching coins and yarrow, tarot RWS), the registry, the inclusion rule for all four beacons (drand quicknet, NIST beacon 2.0, CURBy-RNG, CURBy-Q), and a receipt verifier that runs spec §5.2 steps 1 to 7 offline.
- `packages/lotcast-log`: the append-only Merkle log (RFC 6962 hashing, C2SP signed notes and tlog-tiles) and RFC 3161 anchoring with pinned time-stamp authorities (DigiCert, Sectigo, FreeTSA).

### What an anchored receipt proves

A draw made with a log (`draw.gu --log-dir ... --key-file ...`) puts the request in the operator's signed log, has two time-stamp authorities stamp the log checkpoint, and reads every requested beacon's first pulse *after* the deadline the operator signed into that checkpoint (`lotcast/epoch <epoch> <deadline>`). Both timestamps must prove the checkpoint existed by the deadline, and the entry's promise must name that epoch, so the operator cannot re-stamp or swap checkpoints to move the anchor time. The receipt then proves:

1. the request was in the operator's log before any of the beacon pulses it uses existed (the timestamps), so the operator could not try requests until the outcome suited;
2. each beacon pulse is the first one after that time, or the beacon had none in its window (and what that means is in the receipt);
3. the outcome follows from the request, the checkpoint and those values, by a sampler anyone can re-run.

Verdicts: `verified` (every step passed offline), `verified-pending-live` (one or more sources had no pulse for this draw when the receipt was made, as CURBy-Q has been idle since 2025-08-22, or stalled mid-round; the receipt says which, and the verifier script exits 3 until the live check is done with `--live`), `verified-unanchored` (a receipt with no log, from the first slice: it shows the outcome follows from a real drand round, not that the request came first) and `invalid` (with the first failing step).

What an anchored receipt does **not** yet have: witness cosignatures from public tlog witnesses, a hosted service, scheduled draws and timelocked questions in the HTTP API, and signed subject keys. Those, the MCP server and CLI, the browser verifier, the tradition audits and the stream batteries are the next plan (spec §11). Marseille and Thoth tarot are refused until their audits exist. A single operator key signs the log; a hosted deployment adds mirrors and witnesses so that one party cannot rewrite history.

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

### Tests

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

The vectors come from Python written from the specifications, not from the Guion code: `reference/python/{vectors,merkle_vectors,note_vectors,tiles_vectors,verify_anchored}.py`. The fixtures include real pulses from NIST and CURBy, real time-stamp tokens from three authorities, and real anchored receipts. After changing `packages/lotcast-log`, run `guion update` in `packages/lotcast-core` to refresh its lock.

`tools/gen_registry.gu` generates the CC0 registry (`registry/lotcast-registry-v1.json`) and `src/registry_data.gu` from one source (`guion run --file-root . tools/gen_registry.gu`). Run it after any change to the registry data. `tools/measure_windows.gu` re-measures the CURBy source windows and `tools/fetch_source_fixtures.gu` refreshes the pulse fixtures (each file's header gives its command); `guion test tools/tests.gu` covers their date helpers. The only Python in the repository is `reference/python/`, the independent verifier the spec asks for; it is deliberately not Guion, so that it can check the Guion code.
