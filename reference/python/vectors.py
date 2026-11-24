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

def canonical_options(options: dict) -> bytes:
    return "\n".join(f"{k}={options[k]}" for k in sorted(options)).encode()

def entry_hash(tradition, method, options, mode, commit, sources, not_before, nonce, subject) -> bytes:
    entry = (b"lotcast/entry/v1" + lp(tradition.encode()) + lp(method.encode()) + lp(canonical_options(options))
             + u8(mode) + lp(commit) + lp(",".join(sorted(sources)).encode()) + u64(not_before)
             + lp(nonce) + lp(subject))
    return sha512(entry)

def question_commit(question: str, salt: bytes) -> bytes:
    return sha512(b"lotcast/question/v1" + lp(question.encode()) + lp(salt))

SOURCE_ORDER = ["drand-quicknet", "nist-beacon-2", "curby-rng", "curby-q"]

def seed(entry_hash_: bytes, checkpoint_hash: bytes, sources: dict) -> bytes:
    """sources: id -> (status, value); status 1 present, 0 absent, 2 not requested."""
    body = b"lotcast/seed/v1" + lp(entry_hash_) + lp(checkpoint_hash)
    for sid in SOURCE_ORDER:
        status, value = sources[sid]
        body += lp(sid.encode()) + u8(status) + lp(value)
    return sha512(body)

class Stream:
    def __init__(self, seed, bits=64):
        self.seed, self.bits, self.i, self.buf = seed, bits, 0, []
    def word(self):
        if not self.buf:
            self.buf = self._block()
        return self.buf.pop(0)
    def _block(self):
        size = self.bits // 8
        b = block(self.seed, self.i)
        self.i += 1
        return [int.from_bytes(b[k:k + size], "big") for k in range(0, 64, size)]
    def uniform(self, n):
        space = 2 ** self.bits
        limit = space - space % n
        while True:
            x = self.word()
            if x < limit:
                return x % n
    def weighted(self, ws):
        r = self.uniform(sum(ws))
        run = 0
        for i, w in enumerate(ws):
            run += w
            if run > r:
                return i
    def shuffle(self, n):
        deck = list(range(n))
        for i in range(n - 1, 0, -1):
            j = self.uniform(i + 1)
            deck[i], deck[j] = deck[j], deck[i]
        return deck

def iching_coins(stream):
    """Six lines bottom to top; each is three coins, bit 1 = heads = 3, bit 0 = tails = 2."""
    return [sum(3 if stream.uniform(2) == 1 else 2 for _ in range(3)) for _ in range(6)]

def iching_yarrow(stream):
    return [6 + stream.weighted([1, 5, 7, 3]) for _ in range(6)]

if __name__ == "__main__":
    zero = bytes(64)
    print("seed zero, width 64, words 0..16:")
    for w in words(zero, 17):
        print(w)

    salt = bytes(range(1, 33))
    qc = question_commit("Should I go?", salt)
    print("question_commit('Should I go?', salt 01..20):", qc.hex())
    ha = entry_hash("iching", "yarrow", {}, 1, qc, ["drand-quicknet"], 0, bytes([7]) * 32, b"")
    hb = entry_hash("tarot", "rws", {"reversals": "true", "count": "3"}, 0, b"", ["drand-quicknet"], 1795000000, bytes([9]) * 32, b"")
    print("entry A:", ha.hex())
    print("entry B:", hb.hex())
    drand_only = {"drand-quicknet": (1, bytes([0xAA]) * 32), "nist-beacon-2": (2, b""), "curby-rng": (2, b""), "curby-q": (2, b"")}
    print("seed A unanchored:", seed(ha, b"", drand_only).hex())
    cp = sha512(b"checkpoint")
    print("seed A anchored:", seed(ha, cp, drand_only).hex())

    print("iching coins, zero seed:", iching_coins(Stream(zero)))
    print("iching yarrow, zero seed:", iching_yarrow(Stream(zero)))
    print("iching coins, seed A unanchored:", iching_coins(Stream(seed(ha, b"", drand_only))))
    print("iching yarrow, seed A unanchored:", iching_yarrow(Stream(seed(ha, b"", drand_only))))
