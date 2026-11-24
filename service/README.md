# lotcast-service

The HTTP draw service (spec §8.1) and its loops. `lotcast serve` runs it; see `../docs/operations.md`.

```
guion run --allow-bind 127.0.0.1:8080 --allow-clock --file-root DATA \
    --allow-http-host api.drand.sh --allow-http-host drand.cloudflare.com \
    --allow-http-host beacon.nist.gov --allow-http-host random.colorado.edu \
    --allow-http-host timestamp.digicert.com --allow-http-host timestamp.sectigo.com \
    --allow-http-host freetsa.org serve.gu --data-dir data --key-file operator.key --new-key \
    --registry registry.json
```

Endpoints (JSON, errors `{"error":{"code","message"}}`): `GET /v1/traditions`, `/v1/registry`, `/v1/sources`,
`/v1/operator`; `POST /v1/draws`; `GET /v1/draws/{id}`, `/v1/draws/{id}/receipt`; `POST /v1/verify`;
`GET /v1/log/checkpoint`, `/v1/log/tile/…`, `/v1/log/epoch/…`, `/v1/log/anchor/…`.

Tests: `guion test` (units), `guion test tests_routes.gu` (HTTP routes; a separate file because the
`web` package and the draw core must not share a module), and `tests_live.gu` (a real stamp).

`--registry` and `--data-dir` are paths under `--file-root`; copy `registry/lotcast-registry-v1.json` there as `registry.json` (the Dockerfile does).
