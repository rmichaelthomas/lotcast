#!/usr/bin/env python3
"""Saves real pulses for the offline source tests: NIST chain 2, CURBy-RNG and CURBy-Q.
Needs the network. Run from the repository root; review the diff before committing new fixtures."""
import json
import subprocess

OUT = "packages/lotcast-core/fixtures/sources/"
RNG = "bafyriqci6f3st2mg7gq733ho4zvvth32zpy2mtiylixwmhoz6d627eo3jfpmbxepe54u2zdvymonq5sp3armtm4rodxsynsirr5g3xsbd3q4s"
Q = "bafyriqhijw5soalbtppuwwjbskfiriqy6swa5qd5trgbzx4nypnu7mp7iyhx7m2iin2nxnglmngvjgirzb7bvlisxq3uygoik7ozbybxnftiw"


def get(url):
    return subprocess.run(["curl", "-s", "--compressed", url], capture_output=True, text=True).stdout


def getj(url):
    return json.loads(get(url))


def chain_record(cid):
    for r in getj("https://random.colorado.edu/api/chains"):
        if r["cid"]["/"] == cid:
            return r
    raise SystemExit("chain %s not listed" % cid)


# NIST chain 2: eight consecutive pulses ending a few minutes ago, and the certificate they name.
last = getj("https://beacon.nist.gov/beacon/2.0/pulse/last")["pulse"]
top = last["pulseIndex"] - 2
pulses = [getj("https://beacon.nist.gov/beacon/2.0/chain/2/pulse/%d" % i)["pulse"] for i in range(top - 7, top + 1)]
assert len({p["certificateId"] for p in pulses}) == 1
cert = get("https://beacon.nist.gov/beacon/2.0/certificate/" + pulses[0]["certificateId"].lower())
json.dump({"certificate_pem": cert, "pulses": pulses}, open(OUT + "nist.json", "w"))

# CURBy-RNG: eight consecutive pulses (newest first from the API, stored oldest first).
latest = getj("https://random.colorado.edu/api/chains/%s/pulses/latest" % RNG)["data"]["content"]["index"]
rng = getj("https://random.colorado.edu/api/chains/%s/pulses/%d-%d" % (RNG, latest - 2, latest - 9))
rng = sorted(rng, key=lambda r: r["data"]["content"]["index"])
json.dump({"chain": chain_record(RNG), "pulses": rng}, open(OUT + "curby-rng.json", "w"))

# CURBy-Q: the latest pulse (the chain has been idle since 2025-08-22) and the last complete round
# with the pulse before it.
latest_q = getj("https://random.colorado.edu/api/chains/%s/pulses/latest" % Q)
hist = sorted(getj("https://random.colorado.edu/api/chains/%s/pulses/%d-%d" % (Q, latest_q["data"]["content"]["index"], latest_q["data"]["content"]["index"] - 99)),
              key=lambda r: r["data"]["content"]["index"])
rounds = {}
for r in hist:
    p = r["data"]["content"]["payload"]
    rounds.setdefault(p["round"], {})[p["stage"]] = r
complete = [k for k, v in rounds.items() if {"request", "precommit", "randomness"} <= set(v)]
k = max(complete)
req, pre, rnd = rounds[k]["request"], rounds[k]["precommit"], rounds[k]["randomness"]
by_index = {r["data"]["content"]["index"]: r for r in hist}
before = by_index[req["data"]["content"]["index"] - 1]
json.dump({"chain": chain_record(Q), "latest": latest_q, "before": before, "request": req, "precommit": pre, "randomness": rnd}, open(OUT + "curby-q.json", "w"))
print("saved: nist pulses %d..%d, curby-rng %d pulses, curby-q round %d" % (pulses[0]["pulseIndex"], pulses[-1]["pulseIndex"], len(rng), k))
