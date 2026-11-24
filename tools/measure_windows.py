#!/usr/bin/env python3
"""Measures the CURBy source windows from the chains' own history (spec 4.2) and writes
packages/lotcast-core/fixtures/sources/windows.json.

- CURBy-RNG period: the median spacing of its last 600 pulses.
- CURBy-Q round time: the median time from a round's request pulse to its randomness pulse over the
  last 1000 pulses before the chain went idle. The window is three times that, rounded up to whole seconds.
Needs the network. Run from the repository root.
"""
import datetime
import json
import math
import statistics
import subprocess

RNG = "bafyriqci6f3st2mg7gq733ho4zvvth32zpy2mtiylixwmhoz6d627eo3jfpmbxepe54u2zdvymonq5sp3armtm4rodxsynsirr5g3xsbd3q4s"
Q = "bafyriqhijw5soalbtppuwwjbskfiriqy6swa5qd5trgbzx4nypnu7mp7iyhx7m2iin2nxnglmngvjgirzb7bvlisxq3uygoik7ozbybxnftiw"


def get(url):
    out = subprocess.run(["curl", "-s", "--compressed", url], capture_output=True, text=True).stdout
    return json.loads(out)


def ts(s):
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def pulses(chain, top, count):
    out = []
    at = top
    while len(out) < count:
        lo = max(at - 99, 0)
        out.extend(get("https://random.colorado.edu/api/chains/%s/pulses/%d-%d" % (chain, at, lo)))
        at = lo - 1
    return out


latest_rng = get("https://random.colorado.edu/api/chains/%s/pulses/latest" % RNG)["data"]["content"]["index"]
r = pulses(RNG, latest_rng, 600)
times = sorted(ts(p["data"]["content"]["payload"]["timestamp"]) for p in r)
period = statistics.median([b - a for a, b in zip(times, times[1:])])

latest_q = get("https://random.colorado.edu/api/chains/%s/pulses/latest" % Q)["data"]["content"]["index"]
q = pulses(Q, latest_q, 1000)
rounds = {}
for p in q:
    c = p["data"]["content"]["payload"]
    rounds.setdefault(c["round"], {})[c["stage"]] = ts(c["timestamp"])
durations = [v["randomness"] - v["request"] for v in rounds.values() if "randomness" in v and "request" in v]
median_round = statistics.median(durations)

out = {
    "curby_rng": {"period_seconds": round(period), "window_seconds": 3 * round(period), "pulses_sampled": len(r)},
    "curby_q": {
        "median_round_seconds": math.ceil(median_round),
        "window_seconds": 3 * math.ceil(median_round),
        "rounds_sampled": len(durations),
        "latest_index_when_measured": latest_q,
    },
    "nist": {"period_seconds": 60, "window_seconds": 180},
    "measured_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}
print(json.dumps(out))
