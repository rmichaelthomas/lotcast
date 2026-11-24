#!/usr/bin/env python3
"""Independent check of an anchored receipt's arithmetic, written from the spec (not the Guion code).

Recomputes the entry hash, the log leaf's inclusion in the signed checkpoint's root, the checkpoint
hash, the seed from the sources' values and the I Ching coins outcome, and compares each with the
receipt. It does not check signatures, timestamps or beacon proofs (the Guion verifier does).

    python3 reference/python/verify_anchored.py packages/lotcast-core/fixtures/anchored-receipt.json
"""
import base64
import hashlib
import json
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from merkle_vectors import leaf_hash, node_hash  # noqa: E402
import vectors  # noqa: E402


def verify_inclusion(leaf: bytes, index: int, size: int, proof, root: bytes) -> bool:
    # RFC 9162 section 2.1.3.2
    if index >= size:
        return False
    fn, sn, r = index, size - 1, leaf_hash(leaf)
    for p in proof:
        if sn == 0:
            return False
        if fn & 1 or fn == sn:
            r = node_hash(p, r)
            if not fn & 1:
                while not fn & 1 and fn != 0:
                    fn >>= 1
                    sn >>= 1
        else:
            r = node_hash(r, p)
        fn >>= 1
        sn >>= 1
    return sn == 0 and r == root


def cid_digest(cid: str) -> bytes:
    body = cid[1:].upper()  # multibase 'b' = base32 lower, no padding
    raw = base64.b32decode(body + "=" * (-len(body) % 8))
    assert raw[0] == 1 and raw[2] == 0x14 and raw[3] == 0x40, "not a CIDv1 sha3-512"
    return raw[4:]


receipt = json.load(open(sys.argv[1]))
req = receipt["request"]
entry_bytes = (b"lotcast/entry/v1" + vectors.lp(req["tradition"].encode()) + vectors.lp(req["method"].encode())
               + vectors.lp(vectors.canonical_options(req["options"]))
               + vectors.u8({"none": 0, "hash": 1, "tlock": 2}[req["question"]["mode"]])
               + vectors.lp(bytes.fromhex(req["question"]["commit"]) if req["question"]["commit"] else b"")
               + vectors.lp(",".join(sorted(req["sources"])).encode()) + vectors.u64(req["not_before"])
               + vectors.lp(bytes.fromhex(req["client_nonce"])) + vectors.lp(bytes.fromhex(req["subject"]) if req["subject"] else b""))
entry_hash = hashlib.sha512(entry_bytes).digest()
log = receipt["log"]
assert entry_hash.hex() == log["entry_hash"], "entry hash"

note = log["checkpoint"]
text = note.split("\n\n")[0] + "\n"
origin, size, root_b64 = text.split("\n")[:3]
root = base64.b64decode(root_b64)
assert verify_inclusion(entry_bytes, log["index"], int(size), [bytes.fromhex(h) for h in log["inclusion"]], root), "inclusion"

values = {"drand-quicknet": (2, b""), "nist-beacon-2": (2, b""), "curby-rng": (2, b""), "curby-q": (2, b"")}
for s in receipt["sources"]:
    if s["id"] == "drand-quicknet":
        values[s["id"]] = (1, bytes.fromhex(s["randomness"]))
    elif s["id"] == "nist-beacon-2" and s["status"] == "present":
        values[s["id"]] = (1, bytes.fromhex(s["pulse"]["outputValue"]))
    elif s["id"] == "curby-rng" and s["status"] == "present":
        values[s["id"]] = (1, cid_digest(s["pulse"]["cid"]["/"]))
    else:
        values[s["id"]] = (0, b"")
seed = vectors.seed(entry_hash, hashlib.sha512(text.encode()).digest(), values)
assert seed.hex() == receipt["seed"], "seed"
if (req["tradition"], req["method"]) == ("iching", "coins"):
    lines = vectors.iching_coins(vectors.Stream(seed))
    assert lines == receipt["outcome"]["lines"], "outcome"
checked = "entry hash, inclusion, seed" + (" and outcome" if (req["tradition"], req["method"]) == ("iching", "coins") else "")
print("ok: " + checked + " match")
