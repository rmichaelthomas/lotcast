#!/usr/bin/env python3
"""Independent RFC 6962 vector generator for lotcast-log, written from RFC 6962 section 2.1.

Run: python3 reference/python/merkle_vectors.py > packages/lotcast-log/fixtures/merkle-vectors.json
"""
import hashlib
import json


def sha256(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()


def leaf_hash(d: bytes) -> bytes:
    return sha256(b"\x00" + d)


def node_hash(l: bytes, r: bytes) -> bytes:
    return sha256(b"\x01" + l + r)


def split(n: int) -> int:
    k = 1
    while k * 2 < n:
        k *= 2
    return k


def mth(leaves):
    n = len(leaves)
    if n == 0:
        return sha256(b"")
    if n == 1:
        return leaf_hash(leaves[0])
    k = split(n)
    return node_hash(mth(leaves[:k]), mth(leaves[k:]))


def path(m, leaves):
    n = len(leaves)
    if n == 1:
        return []
    k = split(n)
    if m < k:
        return path(m, leaves[:k]) + [mth(leaves[k:])]
    return path(m - k, leaves[k:]) + [mth(leaves[:k])]


def subproof(m, leaves, b):
    n = len(leaves)
    if m == n:
        return [] if b else [mth(leaves)]
    k = split(n)
    if m <= k:
        return subproof(m, leaves[:k], b) + [mth(leaves[k:])]
    return subproof(m - k, leaves[k:], False) + [mth(leaves[:k])]


def proof(m, leaves):
    return subproof(m, leaves, True)


# RFC 6962 / Certificate Transparency reference tree (the eight leaves used in the CT test suites).
CT_LEAVES = [
    b"",
    bytes.fromhex("00"),
    bytes.fromhex("10"),
    bytes.fromhex("2021"),
    bytes.fromhex("3031"),
    bytes.fromhex("40414243"),
    bytes.fromhex("5051525354555657"),
    bytes.fromhex("606162636465666768696a6b6c6d6e6f"),
]
CT_ROOT_8 = "5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328"
EMPTY_ROOT = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

assert mth(CT_LEAVES).hex() == CT_ROOT_8, "the independent tree disagrees with the CT reference root"
assert mth([]).hex() == EMPTY_ROOT

if __name__ == "__main__":
    MAX = 20
    leaves = [b"leaf-%d" % i for i in range(MAX)]
    out = {
        "leaves": [l.hex() for l in leaves],
        "ct_leaves": [l.hex() for l in CT_LEAVES],
        "ct_root_8": CT_ROOT_8,
        "roots": [mth(leaves[:n]).hex() for n in range(MAX + 1)],
        "inclusion": [],
        "consistency": [],
    }
    for size in range(1, MAX + 1):
        for index in range(size):
            out["inclusion"].append({"size": size, "index": index, "proof": [h.hex() for h in path(index, leaves[:size])]})
    for new in range(1, MAX + 1):
        for old in range(1, new + 1):
            out["consistency"].append({"old": old, "new": new, "proof": [h.hex() for h in proof(old, leaves[:new])]})
    print(json.dumps(out))
