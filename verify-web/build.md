# Building the checking page

The page (`public/`) runs Guion's own browser VM on a Guion program (`verify.gu`). Nothing here is compiled from anything but Guion.

```
guion test                                  # native tests for verify_page
guion build verify.gu && mv verify.gub public/verify.gub
node --test browser.test.mjs                # the same checks inside the browser VM
```

- `public/guion_vm.wasm`, `public/loader.mjs` and `public/wasm.build.json` are copied unchanged from the Guion repository (commit in `VENDOR.sha256`). The test pins the VM's SHA-256 to `wasm.build.json` and the loader to `VENDOR.sha256`.
- `public/verify.gub` is the built checker. A test fails if it is not what `guion build verify.gu` makes now.
- The page's step budget is 5,000,000 (the test receipts take 120,000 to 260,000); the VM's ceiling is 50,000,000.
- At go-live, `public/operator-key.txt` (64 hex characters) is added so the page can fill in the published key.
