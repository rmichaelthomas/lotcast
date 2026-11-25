# Live runs of the draw page

Run on 2026-11-25 against the real service (https://lotcast.thomasbuild.workers.dev) through `node tools/serve.mjs`
(the page's own origin, `/v1/*` forwarded). Browser: Playwright (Chromium). Operator key: `public/operator-key.txt`,
equal to the key `GET /v1/operator` returns.

| # | What | Result |
|---|---|---|
| 1 | I Ching, with a question (includes an emoji), 1280 px wide | Draw no. 9. Waited 2:27 (clock on the page). Ribbon went Logged, Time-stamped, "1 of 3 random sources in", then the result. Hexagram 51 Zhen, lines 7 6 8 7 8 6 (bottom up), lines 2 and 6 changing, becoming 38 Kui. Seal row: "Verified. This draw wasn't re-rolled." Pending record cleared. |
| 2 | Save receipt, Save my question (private) | Both downloaded: `downloads/lotcast-draw-9.json`, `downloads/lotcast-question-9.json` (`{draw, question, salt}`). |
| 3 | The saved receipt pasted into the check foldout of a fresh tab | "Verified." (all six steps offline, stamped by two time-stamp authorities). `06-check-saved-receipt-1280.png` |
| 4 | Tarot, 3 cards, reversals allowed, with a question, 390 px wide. Page reloaded about a minute in | Draw no. 10. The reload showed the waiting state again with the same draw id (`15ba63fe...`), and it finished: 3:13 on the clock in all, 2:09 after the reload. Eight of Cups, King of Pentacles, Two of Swords, all upright. Seal row below the cards (last card ends at y=1851, seal row starts at y=1899), no horizontal scroll. "Verified. These cards weren't re-drawn." |
| 5 | A second Draw press from another browser context (same connection) while draw 10 was waiting | **Not rate-limited.** The service accepted it as draw no. 11 (left unwatched). The service's limit is 60 requests a minute per client (`rate_hit(..., 60)` in `service/src/routes.gu`), not one draw a minute as the plan assumed. The 429 path is covered by the draw-flow test (fake fetch); its wording was changed to not claim "one draw a minute". |

A first attempt at run 1 failed before any draw existed: the service answered "nonce must be 32 bytes written as hex"
(the plan said 16). Fixed and covered by a test.

## Screenshots

- `01-front-1280.png` front page, tarot tab
- `02-iching-form-1280.png` I Ching form with a question
- `03-iching-waiting-1280.png`, `04-iching-waiting-later-1280.png` the wait
- `05-iching-result-1280.png` the hexagram, the change, the seal row, Save buttons
- `06-check-saved-receipt-1280.png` the saved receipt, checked in a fresh tab
- `07-front-390.png` phone front page
- `08-tarot-waiting-390.png`, `10-tarot-resumed-390.png` the wait, and after a reload
- `09-second-draw-accepted-390.png` the second connection's draw (accepted, see row 5)
- `11-tarot-result-390.png` the cards and, below them, the seal row, then the rest of the page
