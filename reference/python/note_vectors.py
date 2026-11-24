#!/usr/bin/env python3
"""Independent signed-note and checkpoint vector generator, written from the C2SP signed-note and
tlog-checkpoint specifications (not from the Guion code).

Run: python3 reference/python/note_vectors.py > packages/lotcast-log/fixtures/note-vectors.json
"""
import base64
import hashlib
import json

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization


def keypair(seed: bytes):
    key = Ed25519PrivateKey.from_private_bytes(seed)
    pub = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return key, pub


def key_hash(name: str, pub: bytes) -> bytes:
    # C2SP signed-note: SHA-256(name || 0x0A || signature type || public key), first 4 bytes. Type 0x01 = Ed25519.
    return hashlib.sha256(name.encode() + b"\n" + b"\x01" + pub).digest()[:4]


def sig_line(name: str, seed: bytes, text: str) -> str:
    key, pub = keypair(seed)
    sig = key.sign(text.encode())
    return "— " + name + " " + base64.b64encode(key_hash(name, pub) + sig).decode() + "\n"


def note(text: str, signers) -> str:
    return text + "\n" + "".join(sig_line(n, s, text) for n, s in signers)


def checkpoint(origin: str, size: int, root: bytes, extensions=()) -> str:
    return origin + "\n" + str(size) + "\n" + base64.b64encode(root).decode() + "\n" + "".join(e + "\n" for e in extensions)


OP_NAME = "lotcast.example/log"
OP_SEED = bytes(range(1, 33))
W_NAME = "witness.example/w1"
W_SEED = bytes(range(101, 133))
root = hashlib.sha256(b"root").digest()
text = checkpoint(OP_NAME, 12345, root)
text_ext = checkpoint(OP_NAME, 7, root, ["extra line"])

_, op_pub = keypair(OP_SEED)
_, w_pub = keypair(W_SEED)
out = {
    "operator": {"name": OP_NAME, "seed": OP_SEED.hex(), "public": op_pub.hex(), "key_hash": key_hash(OP_NAME, op_pub).hex()},
    "witness": {"name": W_NAME, "seed": W_SEED.hex(), "public": w_pub.hex(), "key_hash": key_hash(W_NAME, w_pub).hex()},
    "root": root.hex(),
    "checkpoint_text": text,
    "checkpoint_text_extension": text_ext,
    "note_operator": note(text, [(OP_NAME, OP_SEED)]),
    "note_both": note(text, [(OP_NAME, OP_SEED), (W_NAME, W_SEED)]),
    "note_extension": note(text_ext, [(OP_NAME, OP_SEED)]),
    "signature_line_witness": sig_line(W_NAME, W_SEED, text),
}
print(json.dumps(out))
