# lotcast-cli

The `lotcast` command: `guion run [grants] lotcast.gu COMMAND ...`. `draw`, `get`, `verify`, `compute`,
`audit`, `mcp` and `serve`; the header of `lotcast.gu` lists every flag and the exit codes. `verify` and `audit`
need the operator's public key: pass `--operator-key HEX` to pin it, or `--server URL` to take it from
`GET /v1/operator` (trust on first use).

## `lotcast mcp`: the local MCP server

A stdio Model Context Protocol server (one JSON-RPC message per line; nothing but those lines is printed
to stdout). It runs on your machine, builds your question's commitment here, verifies every receipt here,
and talks only to the HTTP service. Six tools: `list_traditions`, `describe_method`, `draw`, `get_draw`,
`verify_receipt`, `open_sealed`.

Run it from the lotcast home, which must be the file root (Guion confines files to relative paths under it;
`chmod` is given the root's absolute path from `$PWD`, or `--home-path`):

```
mkdir -p ~/.lotcast && cd ~/.lotcast && guion run --file-root . --allow-clock \
    --allow-http-host SERVICE-HOST --allow-http-host api.drand.sh --allow-http-host drand.cloudflare.com \
    --allow-http-host beacon.nist.gov --allow-http-host random.colorado.edu \
    /path/to/lotcast/cli/lotcast.gu mcp
```

Claude Code: `claude mcp add lotcast -- sh -c 'cd ~/.lotcast && exec guion run --file-root . ... lotcast.gu mcp'`.
Claude Desktop: the same command as `command: "sh"`, `args: ["-c", "..."]` in `claude_desktop_config.json`.
The `[process] commands = ["chmod"]` grant is needed and is the only one. The tests that read file modes with `ls` live in their own project, `../cli-modes`.

The home holds `config.json` (`server`, `operator_key`, `sign_requests`; any other key is refused), `pinned.json`
(`pinned/`, one file per server: the operator key first seen for it; a later change is refused), `receipts/ID.json` and `salts/ID.json`
(the question, its salt and the request, written before the request is sent). Directories are mode 700 and files
600. The server and the operator key come from `config.json` or from the command line of the person who started
the server (`--server`, `--operator-key`); a tool argument can never set them. `seal: "tlock"` and
`sign_requests: true` answer `E_TLOCK_UNSUPPORTED` and `E_SUBJECT_KEY_UNSUPPORTED`. `wait_seconds` is 0 to 600 and defaults to 40, under the 60 seconds many clients allow a tool call; a draw still pending then returns its id, and `get_draw` finishes it. `verify_receipt` takes `live: true` to ask the live chains about sources that had no pulse. Tests: `guion test`, `guion test tests_home.gu`, `guion test tests_mcp.gu`;
`tests_live_mcp.gu` makes a real draw against a running service (its header has the command).
