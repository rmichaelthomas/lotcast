#!/usr/bin/env python3
"""Independent tlog-tiles vector generator, written from the C2SP tlog-tiles specification.

Tile hash i of tile n at level l is MTH(D[(n*256+i)*256**l : (n*256+i+1)*256**l]) (spec formula), computed
directly, not by folding levels. Run:
    python3 reference/python/tiles_vectors.py > packages/lotcast-log/fixtures/tiles-vectors.json
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from merkle_vectors import mth, leaf_hash  # noqa: E402  (the independent RFC 6962 implementation)


def xpath(n: int) -> str:
    parts = []
    while True:
        parts.append(n % 1000)
        n //= 1000
        if n == 0:
            break
    parts.reverse()
    out = ["x%03d" % p for p in parts[:-1]] + ["%03d" % parts[-1]]
    return "/".join(out)


def tile_path(level: int, n: int, width: int) -> str:
    return "tile/%d/%s%s" % (level, xpath(n), (".p/%d" % width) if width else "")


def entry_path(n: int, width: int) -> str:
    return "tile/entries/%s%s" % (xpath(n), (".p/%d" % width) if width else "")


def files_for(entries):
    size = len(entries)
    files = {}
    level = 0
    while size // (256 ** level) > 0:
        count = size // (256 ** level)  # hashes at this level
        n = 0
        while n * 256 < count:
            width = min(256, count - n * 256)
            blob = b"".join(
                mth(entries[(n * 256 + i) * 256 ** level:(n * 256 + i + 1) * 256 ** level]) for i in range(width)
            )
            files[tile_path(level, n, 0 if width == 256 else width)] = hashlib.sha256(blob).hexdigest()
            n += 1
        level += 1
    n = 0
    while n * 256 < size:
        chunk = entries[n * 256:(n + 1) * 256]
        blob = b"".join(len(e).to_bytes(2, "big") + e for e in chunk)
        files[entry_path(n, 0 if len(chunk) == 256 else len(chunk))] = hashlib.sha256(blob).hexdigest()
        n += 1
    return files


entries = [b"entry-%d" % i for i in range(1000)]
sizes = [1, 2, 255, 256, 257, 511, 512, 513, 1000]
out = {
    "paths": [
        {"level": 0, "index": 1234067, "width": 0, "path": tile_path(0, 1234067, 0)},
        {"level": 1, "index": 5, "width": 7, "path": tile_path(1, 5, 7)},
        {"level": 2, "index": 1000, "width": 0, "path": tile_path(2, 1000, 0)},
        {"level": 0, "index": 0, "width": 255, "path": tile_path(0, 0, 255)},
        {"level": 0, "index": 999, "width": 0, "path": tile_path(0, 999, 0)},
        {"level": -1, "index": 0, "width": 0, "path": entry_path(0, 0)},
        {"level": -1, "index": 1000, "width": 12, "path": entry_path(1000, 12)},
    ],
    "entries_count": len(entries),
    "logs": [
        {"size": s, "root": mth(entries[:s]).hex(), "files": [{"path": k, "sha256": v} for k, v in files_for(entries[:s]).items()]} for s in sizes
    ],
}
print(json.dumps(out))
