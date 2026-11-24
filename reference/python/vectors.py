#!/usr/bin/env python3
"""Independent vector generator for lotcast, written from the design spec (§4), not from the Guion code.

Run: python3 reference/python/vectors.py
"""
import hashlib
import struct

def sha512(b: bytes) -> bytes:
    return hashlib.sha512(b).digest()

def u8(x): return struct.pack(">B", x)
def u32(x): return struct.pack(">I", x)
def u64(x): return struct.pack(">Q", x)
def lp(b: bytes) -> bytes: return u32(len(b)) + b

def block(seed: bytes, i: int) -> bytes:
    return sha512(b"lotcast/stream/v1" + seed + u64(i))

def words(seed: bytes, count: int, word_bits: int = 64):
    """The first `count` words. Width 64: eight big-endian u64 per block. Width 8: sixty-four bytes per block."""
    size = word_bits // 8
    out = []
    i = 0
    while len(out) < count:
        b = block(seed, i)
        for k in range(0, 64, size):
            out.append(int.from_bytes(b[k:k + size], "big"))
        i += 1
    return out[:count]

if __name__ == "__main__":
    seed = bytes(64)
    print("seed zero, width 64, words 0..16:")
    for w in words(seed, 17):
        print(w)
