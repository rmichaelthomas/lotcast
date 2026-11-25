# Building the checking page

The page (`public/`) runs Guion's own browser VM on a Guion program (`verify.gu`). Nothing here is compiled from anything but Guion.

```
guion test                                  # native tests: verify_page, draw_plan, check_view, verify_draw
guion build verify.gu && mv verify.gub public/verify.gub
node --test                                 # the browser VM, the draw flow, the names, the page's markup
node tools/serve.mjs                        # preview at http://127.0.0.1:8787, /v1/* forwarded to the service
                                            # (LOTCAST_SERVER=https://... to point it elsewhere)
```

- `public/guion_vm.wasm`, `public/loader.mjs` and `public/wasm.build.json` are copied unchanged from the Guion repository (commit in `VENDOR.sha256`). The VM must be the same Guion release that builds `verify.gub` (0.9.0, artifact format 90). The test pins the VM's SHA-256 to `wasm.build.json` and the loader to `VENDOR.sha256`.
- `public/verify.gub` is the built checker. A test fails if it is not what `guion build verify.gu` makes now.
- The page's step budget is 5,000,000 (the test receipts take 120,000 to 260,000); the VM's ceiling is 50,000,000.
- At go-live, `public/operator-key.txt` (64 hex characters) is added so the page can fill in the published key.

## The draw page

- `public/index.html` (markup and CSS), `public/page.mjs` (wiring), `public/draw-flow.mjs` (seal, post, bind, poll, verify, resume; no DOM) and `public/names.mjs` (card and hexagram names).
- Guion does everything that needs trust: `draw_plan`, `check_view` and `verify_draw` in `verify.gu` (helpers in `draw.gu`), built on `lotcast-core`'s `draw_request_body`, `binding_problem` and `view_problem`.
- `public/fonts/`: Geist and Geist Mono (variable woff2) and `OFL.txt`, from the npm package `geist` 1.9.2. SHA-256 of each is in `VENDOR.sha256`. The page loads no other origin.
- `allhere.json`: for each AllHereHTML id the page uses, its `element`, `interaction` and `fallback`, copied from `instruments/registry/behaviors.json` at the commit it records. AllHereHTML is never edited from this repository.
- `public/verify.gub` is git-ignored: rebuild it with the command above before serving or deploying.
- `qa/RESULTS.md` records the live runs and their screenshots.
