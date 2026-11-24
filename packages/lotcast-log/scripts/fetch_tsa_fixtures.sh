#!/bin/sh
# Fetches one real RFC 3161 token from each pinned TSA for a fixed digest and writes the pinned
# certificate chains (leaf and issuer, DER, base64) next to the tokens. Needs OpenSSL 3 and curl.
# Run from packages/lotcast-log. Re-run (and review the diff) when a TSA rotates its certificate.
set -eu
OUT=fixtures/tsa
mkdir -p "$OUT"
DIGEST=$(printf 'lotcast tsa fixture v1' | openssl dgst -sha512 -binary | xxd -p -c 200)
echo "$DIGEST" > "$OUT/digest.hex"
fetch() {
  name=$1; url=$2
  openssl ts -query -digest "$DIGEST" -sha512 -cert -no_nonce -out "$OUT/$name.tsq"
  curl -fsS -H 'Content-Type: application/timestamp-query' --data-binary @"$OUT/$name.tsq" "$url" -o "$OUT/$name.tsr"
  openssl ts -reply -in "$OUT/$name.tsr" -token_out -out "$OUT/$name.token.der"
  openssl pkcs7 -inform DER -in "$OUT/$name.token.der" -print_certs > "$OUT/$name.chain.pem"
  base64 < "$OUT/$name.token.der" | tr -d '\n' > "$OUT/$name.token.b64"
  rm -f "$OUT/$name.tsq" "$OUT/$name.tsr" "$OUT/$name.token.der"
  echo "$name: fetched $(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
fetch digicert http://timestamp.digicert.com
fetch sectigo http://timestamp.sectigo.com
fetch freetsa https://freetsa.org/tsr
