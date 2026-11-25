# Lotcast

**A draw you can check.**

Lotcast draws I Ching hexagrams and tarot cards for you, or for an AI agent acting for you, and gives every draw a **receipt** that anyone can check. Nobody, not even the people running Lotcast, can quietly re-roll a draw until it says what they want.

It tells you **what was drawn**: the six lines, or the cards and where they fall. It never tells you what they mean. That part is yours.

- **Make a draw in your browser (nothing to install):** <https://lotcast.thomasbuild.workers.dev>. You can check a receipt someone gave you there too.
- **The service:** the same address. The web page is at `/`, and the draws are at `/v1/...`.
- **The operator's public key** (what receipts are checked against):
  `a1aa46bfdd9cec63fa4c3f1abd1c5919e058c21cdce25085bbec9f1104df779b`

---

## Why this exists

If an app, a website or an AI draws a card for you, you have no way to tell whether the result was really random or whether it was picked, or drawn again until it looked right. A draw is only worth trusting if it can't be rigged.

Lotcast makes rigging visible. If a draw doesn't check out, the receipt says so, and says which step failed.

## How it works, in plain words

1. **You ask.** Your question stays on your own computer. Only a sealed fingerprint of it is sent.
2. **Lotcast writes your request down first.** It goes into a public, signed log, and two independent time-stamping services stamp the log. That proves your request existed *before* the random numbers did.
3. **Then it waits for numbers nobody could have known.** These come from public random-number sources: drand, NIST's beacon and the CURBy beacons. Lotcast uses only the first number that comes out after your request was locked in.
4. **The result is worked out by fixed, published rules.** Your request and those numbers go in, and a hexagram or a set of cards comes out. There's no choice left for anyone to make.
5. **You get a receipt.** It holds everything needed to repeat the calculation. Anyone can run the check themselves, on their own computer, without trusting Lotcast.

### What you are trusting, and what you are not

- You are **not** trusting Lotcast's word that the draw was fair. The receipt proves the order of events and the calculation.
- You **are** trusting one thing: that the signed log belongs to the Lotcast operator, whose public key is published above and in several places, so you don't have to take the server's word for its own key.
- Lotcast has **one operator and no independent witnesses yet.** You are relying on the public log and the outside timestamps to show the order of events, not on a second party keeping watch.
- One of the random sources, CURBy-Q, has been idle since August 2025. A receipt that uses it says so and is marked "not fully checked" until you finish the check with `--live`.

---

## Make a draw (no install)

1. Open <https://lotcast.thomasbuild.workers.dev>.
2. Choose I Ching or tarot, and type a question if you like. It never leaves your device; only a sealed fingerprint of it is sent. Press **Draw**.
3. Wait one to three minutes. The page shows each step as it happens, and picks the draw back up if you reload it.
4. You get the six lines, or your cards, with a red seal once the draw checks out. **Save receipt** keeps the receipt, which is safe to share. **Save my question (private)** keeps your question and its secret, so you can prove later what you asked. The page remembers your last draw in your browser until you draw again, press **Forget this draw on this device**, or seven days pass.

### Check a receipt someone gave you

1. On the same page, scroll to **Someone sent you a draw? Check it here.**
2. Paste in the receipt (the whole file, from the first `{` to the last `}`) and press **Check this receipt**. The operator's key is already filled in.
3. Read the answer:

| You see | It means |
|---|---|
| **Verified** | Every check passed. The request came first, and the result follows from it. |
| **Not fully checked yet: one live check is still owed** | Everything passed that could be checked offline. One random source needs a live look; the page shows the command that finishes it. |
| **Partly verified** | The result follows from a real random number, but nothing shows the request came first. |
| **This receipt does not check out** | Something doesn't add up. It says which step failed. |
| **This could not be read** | What you pasted isn't a receipt, or the key is wrong. |

The check runs **in your browser**. Your receipt is not sent anywhere.

Want to see it work? Two receipts from the live service are in [`examples/`](examples/):
[`example-receipt.json`](examples/example-receipt.json) checks out, and
[`example-receipt-tampered.json`](examples/example-receipt-tampered.json) is the same receipt with one change, which the page catches at step 5.

---

## Make a draw from the command line

You need Guion, the language Lotcast is written in (see [About Guion](#about-guion) below).

**1. Install Guion** (macOS or Linux):

```sh
brew install rmichaelthomas/guion/guion
```

No Homebrew? Use the one-line installer, or [download it](https://github.com/rmichaelthomas/guion/releases) (Windows included):

```sh
curl -fsSL https://raw.githubusercontent.com/rmichaelthomas/guion/main/distribution/get-guion.sh | sh
```

**2. Get Lotcast:**

```sh
git clone https://github.com/rmichaelthomas/lotcast.git
cd lotcast
```

**3. Draw.** Copy these two lines first, so the later commands are short:

```sh
SERVER=https://lotcast.thomasbuild.workers.dev
KEY=a1aa46bfdd9cec63fa4c3f1abd1c5919e058c21cdce25085bbec9f1104df779b
```

An I Ching hexagram (three coins):

```sh
bin/lotcast draw iching coins --server $SERVER --operator-key $KEY > my-receipt.json
```

Three tarot cards, some reversed:

```sh
bin/lotcast draw tarot rws count=3 reversals=true --server $SERVER --operator-key $KEY > my-receipt.json
```

On screen you'll see the draw's number in the log and the word `verified`. The receipt, with your result inside it, is saved in `my-receipt.json`. The command checks the receipt itself before it says `verified`.

**Reading the result.** It's in the receipt, under `outcome`:

```sh
jq .outcome my-receipt.json
# no jq? this does the same:
python3 -c "import json; print(json.load(open('my-receipt.json'))['outcome'])"
```

An I Ching draw looks like this (a real one):

```json
{"changing": [5], "hexagram": 58, "lines": [7, 7, 8, 7, 9, 8], "relating": 54}
```

`lines` are the six lines **from the bottom up**: 6 is an old (changing) yin line, 7 a young yang line, 8 a young yin line and 9 an old (changing) yang line. `hexagram` is the hexagram's number (58 here, Dui), `changing` says which lines are changing, counting from the bottom (the fifth), and `relating` is the hexagram it turns into (54). The names for the numbers are in `GET /v1/registry`, which carries only names, never meanings.

A tarot draw lists the cards and whether each is reversed (another real one):

```json
{"cards": [{"id": "tarot:rws:major:15", "reversed": true}, {"id": "tarot:rws:swords:4", "reversed": true}, {"id": "tarot:rws:major:20", "reversed": false}]}
```

`major:15` is the 16th major arcana (they run 0, The Fool, to 21, The World); `swords:4` is the Four of Swords. Numbers above 10 in a suit are the court cards.

- **It takes a little while.** The draw has to wait for fresh random numbers. With all the default sources, expect one to three minutes. Add `--sources drand-quicknet` to use just one source, which took about 45 seconds when I tried it.
- **Keep a question to yourself:** add `--question "Your question"`. Only a fingerprint of it leaves your computer, and the command prints a secret "salt" you can keep to prove later that it was your question.
- **The first request after a quiet spell can be slow.** The service sleeps when nobody is using it and wakes on the next request.
- **What you can draw:** `curl https://lotcast.thomasbuild.workers.dev/v1/traditions` lists every tradition and method with its exact odds. Today that's I Ching (`coins`, `yarrow`) and tarot (`rws`, the Rider–Waite–Smith deck, with `count`, `majors_only` and `reversals` options).

**4. Check a receipt you were given:**

```sh
bin/lotcast verify my-receipt.json --operator-key $KEY
```

It prints `verified` or says what failed. The exit code tells scripts the same thing: `0` verified, `1` invalid or failed, `2` bad arguments, `3` verified except for a live check still owed, `4` still pending.

`bin/lotcast` is a small script that runs Guion with the few permissions Lotcast needs (the clock, the files in the current folder, and the network calls to the service and the random-number sources, and nothing else). The command itself lives in [`cli/lotcast.gu`](cli/lotcast.gu); its header lists every option.

---

## For AI agents and tool builders

Lotcast is built to be used by agents, with the question and the checking kept on the user's side.

**As an MCP server** (the Model Context Protocol, over standard input and output). It runs on your machine, seals your question there, verifies every receipt there, and talks only to the service. Six tools: `list_traditions`, `describe_method`, `draw`, `get_draw`, `verify_receipt`, `open_sealed`.

```sh
mkdir -p ~/.lotcast
claude mcp add lotcast -- sh -c 'cd ~/.lotcast && exec guion run --file-root . --allow-clock \
  --allow-http-host lotcast.thomasbuild.workers.dev --allow-http-host api.drand.sh --allow-http-host drand.cloudflare.com \
  --allow-http-host beacon.nist.gov --allow-http-host random.colorado.edu \
  /FULL/PATH/TO/lotcast/cli/lotcast.gu mcp \
  --server https://lotcast.thomasbuild.workers.dev \
  --operator-key a1aa46bfdd9cec63fa4c3f1abd1c5919e058c21cdce25085bbec9f1104df779b'
```

Replace `/FULL/PATH/TO/lotcast` with where you cloned it. That line is for Claude Code. For any other MCP client, give it the same command: `command: "sh"` and `args: ["-c", "<the part in quotes above>"]`. The server and key come from this command or from `~/.lotcast/config.json`, never from a tool call, so an agent can't point it somewhere else. More detail is in [`cli/README.md`](cli/README.md).

**Over plain HTTP** (JSON; errors look like `{"error": {"code": "...", "message": "..."}}`), at `https://lotcast.thomasbuild.workers.dev`:

| | |
|---|---|
| `GET /v1/traditions`, `/v1/registry`, `/v1/sources` | what can be drawn, the published positions, and how the random sources are doing |
| `GET /v1/operator` | the operator's public key |
| `POST /v1/draws` | ask for a draw (the command line and MCP server build the request for you, and keep the question local) |
| `GET /v1/draws/{id}` and `/v1/draws/{id}/receipt` | the state of a draw, and its receipt |
| `POST /v1/verify` | check a receipt |
| `GET /v1/log/checkpoint`, `/v1/log/tile/...` | the public log itself, for anyone to copy and audit |

There is a machine-readable summary at <https://lotcast.thomasbuild.workers.dev/llms.txt>.

**Ground rules for an agent using Lotcast:**

- Report the **positions**, never a meaning. Lotcast doesn't offer one and an agent shouldn't invent that it does.
- Show the user the **verdict**. Say "verified" only for `verified`. A receipt marked `verified-pending-live` is *not fully checked yet*; say that.
- Never send the user's question to Lotcast. Let the command or the MCP server keep it local.
- Check receipts against the published key, not a key the same server hands you.

---

## About Guion

Lotcast is written entirely in [**Guion**](https://rmichaelthomas.github.io/guion/) (say GUY-on), a general-purpose programming language for everyday software: scripts, command-line tools, web services and applications. It's built to be easy to read and hard to get wrong. Guion is young (version 0.9.0 at the time of writing) and its documentation says what's still missing.

Why that matters here: Guion programs run with **no permissions unless you grant them by name**. That's why the commands above spell out each network address: you can see exactly what the program is allowed to do. The page that checks your receipt in the browser is the *same* Guion program, run by Guion's own browser engine.

- Website and try-it-in-your-browser playground: <https://rmichaelthomas.github.io/guion/>
- [Getting started](https://github.com/rmichaelthomas/guion/blob/main/docs/getting-started.md) · [Language reference](https://github.com/rmichaelthomas/guion/blob/main/docs/reference.md) · [Releases](https://github.com/rmichaelthomas/guion/releases) · [Source](https://github.com/rmichaelthomas/guion)

---

## What's here, and what isn't yet

**Here:** the draws (I Ching coins and yarrow, Rider–Waite–Smith tarot), the signed public log, the two timestamps, four public random sources, the receipt, the command-line tool, the MCP server, the web checking page, a way to back up the live service's records (`lotcast backup`) and the service itself.

**Not yet:** independent witnesses who also sign the log; mirrors that keep their own copy; questions sealed until a chosen time; signed identities for askers; Marseille and Thoth tarot (the service refuses them until their odds have been reviewed); independent expert review of the odds for the methods that are live (the exact odds are published and checked by counting, but not audited by outsiders yet). These were left out on purpose, to keep the first version simple enough to trust. Asking for one of them gets a clear error, not a silent fallback.

**Young and small.** This is a new service with one operator and few users. It's meant to be checked, so check it.

## Run your own, or read the code

- Run your own Lotcast, with your own key and your own log: [`docs/operations.md`](docs/operations.md).
- Read, test or change the code: [`docs/developing.md`](docs/developing.md).
- Found something wrong with a receipt or a claim? Open an [issue](https://github.com/rmichaelthomas/lotcast/issues).

Code is [Apache-2.0](LICENSE). The positions registry (what each hexagram line and card is called) is CC0.
