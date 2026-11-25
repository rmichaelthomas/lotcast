# Lotcast on Cloudflare

One Worker, one container, one address (`https://lotcast.<your-subdomain>.workers.dev`):

- `/` is the checking page (static files from `../../verify-web/public`, served before any code runs).
- `/v1/...` goes to `src/worker.ts`, which sends it to the one `Lotcast` Durable Object. That object owns the one container running `lotcast serve` (`../../service/Dockerfile`), so only one process ever writes the log.
- The container sleeps after 30 minutes without a request, but not while a draw is still waiting on a beacon (it asks `GET /v1/status` first).
- The operator key is the Worker secret `LOTCAST_OPERATOR_KEY`. It is never in the image or the repository.

## Run it on your machine (needs Docker)

```
cd deploy/cloudflare && npm install
echo "LOTCAST_OPERATOR_KEY=$(openssl rand -hex 32)" > .dev.vars     # a throwaway key; .dev.vars is git-ignored
npx wrangler dev --port 8787
lotcast draw iching coins --sources drand-quicknet --server http://127.0.0.1:8787
```

`SLEEP_AFTER=20s` in `.dev.vars` shortens the idle timer for testing. Deploying is in `docs/operations.md`.
