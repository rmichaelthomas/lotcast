# A front page where anyone can make a draw

## Why

Lotcast works, but only from a terminal or through an AI agent. The page at the service's address is a box that asks you to paste a receipt, which means nothing to a newcomer. Rob's goal is to bring the tech to the person: someone who has never heard of Guion, JSON or a terminal should be able to open the page, make a draw, and see it.

## What the page does

The front page at `https://lotcast.thomasbuild.workers.dev/` becomes the draw itself.

```
  Lotcast — a draw you can check

  [ I Ching ]  [ Tarot ]            ← pick one
  Tarot: how many cards [3]  [x] allow reversed cards
  Your question (optional, stays on this device) [__________]

            [ Draw ]

  ── while waiting (about 1–3 minutes) ──
  ✓ Your request is written in the public log
  ✓ Time-stamped by two outside services
  … Waiting for fresh public random numbers

  ── the draw ──
  I Ching: the six lines drawn bottom to top, changing lines marked,
           "58 · Dui", and "changes to 54 · Gui Mei"
  Tarot:   each card face with its name; a reversed card shown upside down

  ✓ Checked in your browser: this draw was not re-rolled.
  [ Save receipt ]   [ Save my question and its secret ]  (second only if a question was asked)

  How do I know it's fair?   (the README's five plain steps)
  Check a receipt someone gave you   (today's checker, moved down)
```

1. **Choose.** I Ching or tarot. For tarot, the number of cards and whether cards can be reversed. These options come from `GET /v1/traditions` and are not hard-coded. An optional question box says plainly that the question never leaves the device.
2. **Draw.** The page seals the question on the device (`question_commit` from `lotcast-core`, with a fresh random salt) and sends `POST /v1/draws` with the commitment and a random nonce. It never sends the question.
3. **Wait.** The page polls `GET /v1/draws/{id}` and shows, in plain words, which step the draw is on. The draw id is kept in the browser's storage, so closing or reloading the tab mid-wait picks the draw back up instead of losing it.
4. **See the draw.** The page shows the outcome as the draw itself: hexagram lines or cards, with names from `GET /v1/registry`. It gives no meanings, as Lotcast has always promised.
5. **Proof.** The page checks the receipt in the browser with the existing Guion checker, against the published key, and shows the verdict in the README's wording. "Verified" appears only for `verified`. `verified-pending-live` reads "not fully checked yet".
6. **Keep it.** "Save receipt" downloads the receipt, which is safe to share. If a question was asked, "Save my question and its secret" downloads the question and salt, marked as private.

Below the draw, the page explains in plain words why the draw is fair, then shows the existing "check a receipt" box for receipts people were given.

## The look (approved from the mockup)

The approved mockup is the bottom row ("Version 2") of the design canvas: https://claude.ai/artifact/XZJAnxkfjVk1UwfwKMSRsH. It shows the front page, the wait, an I Ching draw and a tarot draw.

- **Lotcast's own look, not Guion's.** It is dark and clean, and it reads as a clear, usable tool. It must not lean into the spooky or occult: no stars, no constellations, no ornate borders, no old-style serif.
- **Colors.** Indigo ground `#12102a`, raised panels `#17153a` and `#1c1940`, rules `#3a3566`, muted text `#b9b4d9`, bone `#f2ead9` (cards and the draw slip), ink on bone `#16142e`, brass accent `#d9b36c`, and seal red `#c8361f`, used only for the seal and the Draw button.
- **Type.** Geist, with Geist Mono for log numbers and labels. The font files are served from the page itself (both are under the SIL Open Font License). The page makes no request to any other site.
- **The seal.** A finished, checked draw gets a red seal with a check mark. It sits in its own row beside the words "Verified. This draw wasn't re-rolled." **No badge, seal or decoration may ever cover text or any part of the draw.**
- **Back to Guion.** One footer line, "Made with Guion and AllHereHTML", with Guion's small blue mark. Nothing else borrows Guion's colors.
- **Motion.** The headline arrives word by word. A brass dial turns slowly behind the draw slip and while waiting. The I Ching lines draw in from the bottom up. Tarot cards flip over in the order drawn. The seal pops in last. All motion stops under `prefers-reduced-motion`.

**AllHereHTML pieces used.** Each is vendored or authored to its registry contract, the way the Guion site does it:

| Where | Piece |
|---|---|
| Headline | `ahi.motion-time.typographic-entrance` |
| I Ching / Tarot choice | `ahi.reveals-discoveries.tabbed-scene` (native radio tabs) |
| Dial behind the slip and while waiting | `ahi.visual-art-media.procedural-ornament`, `ahi.computational-experiences.generative-artwork` |
| "Why it's fair" | `ahi.relationships-diagrams.provenance-trail` |
| Waiting steps | `ahi.motion-time.time-ribbon`, handing off through `ahi.motion-time.state-transition` |
| Hexagram lines | `ahi.motion-time.drawing-reveal` |
| Dui → Gui Mei | `ahi.relationships-diagrams.comparison-bridge` |
| Tarot cards and their names | `ahi.reveals-discoveries.flip-card`, `ahi.publications-objects.exhibition-label` |
| The seal | `ahi.annotation-evidence.hand-drawn-circle` (in its own row) |
| "Someone sent you a draw?" and the receipt details | `ahi.reveals-discoveries.foldout` |
| Developer link | `ahi.navigation-journeys.jump-point` |

**Tarot card names.** The registry names the hexagrams but gives tarot cards only ids (`tarot:rws:major:15`). The page carries its own table of the 78 standard Rider–Waite–Smith names (The Devil, Four of Swords, …). These are names only, never meanings. A test checks that the table covers every id in the registry.

## Goals, non-goals and anti-goals

- **Goals.** A first-time visitor can draw and see the result with no instructions. Everything works from the browser alone, on a phone too.
- **Non-goals.** No meanings or interpretations. No accounts. No server changes. The command line, the MCP server and the HTTP interface stay as they are.
- **Anti-goals.** The question must never leave the device. The page must never show "verified" for anything less. The wait must never look broken or frozen.

## How it's built

- **Same address, same static files.** The page replaces `verify-web/public/index.html`, which the Cloudflare Worker already serves before any code runs. No new deployment is needed.
- **Guion does the sealing and the checking.** The page's Guion program (`verify.gu`, extended or joined by a sibling) does the question commitment and the receipt check in Guion's browser VM, as the checker does today. A thin layer of browser JavaScript does what that VM cannot: random bytes, the network calls, polling and downloads.
- **Designed with AllHereHTML,** the same way the Guion site does it: instruments are rendered into a vendored folder with provenance, or authored to the registry's contract where a piece's fixed labels don't fit. See `~/guion/site/agents/allhere-toolkit.md`. AllHereHTML itself is never edited from this repository.
- **Tests.** The existing native and browser tests for the checker keep passing, and new tests cover the question commitment matching `lotcast-core`. A browser run makes a real draw against the live service, both I Ching and tarot, and records screenshots, including a phone-width one.

## Approaches considered

1. **One page at the same address, replacing the checker. Chosen.** The first thing a visitor sees is the draw. There's no new hosting.
2. A separate site, hosted like Guion's, that talks to the service. Rejected: it means a second address and a second deployment, and visitors get sent between two places.
3. Keep the checker at the front and add a draw page beside it. Rejected: the front page would still ask a newcomer to paste a receipt.

## Calls I made (Rob can override)

- **Cards are shown as clean card faces** (numeral, a simple mark, the name; upside down when reversed), not scanned 1909 artwork.
- **The salt goes in a separate private file,** so the receipt someone shares never carries their question's secret.
- **One source or all sources.** The page uses the service's default sources, like the command line. The wait time it shows comes from the draw's real progress, not a guess.

## Left to the builder

The exact draw status values the page maps to plain steps (read them from `h_get_draw`). Which AllHere pieces are vendored and which are authored. The simple mark on each card face. The README is not part of this change. Once the page ships, the README's "Check a receipt" and "Make a draw" sections can point to it first, as a follow-up.
