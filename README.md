# Lotcast

A verifiable draw service for lot-cast divination, written in Guion. It returns positions, never meanings, with a receipt anyone can re-check.
Design spec: `docs/explore/agent-divination-tools/03-draw-service-design.md` in the Hunchery repository.
Code is Apache-2.0; the positions registry is CC0.

## Status: first slice

`packages/lotcast-core` draws I Ching (coins and yarrow) and tarot (Rider-Waite-Smith) from a real drand quicknet round and checks the receipt offline.

```
cd packages/lotcast-core
guion run --allow-http-host api.drand.sh --allow-http-host drand.cloudflare.com --allow-clock \
    draw.gu iching yarrow > receipt.json
guion run --file-root . verify_receipt.gu receipt.json
guion test                      # unit tests, with vectors from reference/python/vectors.py
guion test tests_enumerate.gu   # exact odds by enumeration (spec §7.1)
guion test tests_statistical.gu # chi-square on the real stream (spec §7.2, 20,000 draws)
```

Needs a Guion build at artifact format 89 or later.

Receipts from this slice are **unanchored**: there is no log or timestamp yet, so they prove the outcome follows from a real drand round and the request, not that the request was fixed before that round existed. They verify as `verified-unanchored` and name steps 2 and 3 as not checked. The log, the timestamps, the other three beacons, the other methods and their audits, the Python verifier and the stream batteries are the next steps of the build order in the design spec (§11).

`tools/gen_registry.py` generates the CC0 registry (`registry/lotcast-registry-v1.json`) and `src/registry_data.gu` from one source. Run it after any change to the registry data.
