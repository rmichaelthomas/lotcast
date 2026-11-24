# lotcast-cli

The `lotcast` command: `guion run [grants] lotcast.gu COMMAND ...`. `draw`, `get`, `verify`, `compute`,
`audit` and `serve`; the header of `lotcast.gu` lists every flag and the exit codes. `verify` and `audit`
need the operator's public key: pass `--operator-key HEX` to pin it, or `--server URL` to take it from
`GET /v1/operator` (trust on first use).
