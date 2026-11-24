# TSA fixtures

Real RFC 3161 tokens for the fixed digest in `digest.hex`, fetched 2026-11-24 by `scripts/fetch_tsa_fixtures.sh`. `scripts/gen_tsa_pins.py` turns the chains into `src/tsa_pins.gu` (the pinned issuer of each TSA's signing certificate) and `tokens.json`.

Pinned issuers (validity end):

- digicert: C=US, O=DigiCert, Inc., CN=DigiCert Trusted G4 TimeStamping RSA4096 SHA256 2025 CA1; notAfter=Jan 14 23:59:59 2038 GMT
- sectigo: C=GB, O=Sectigo Limited, CN=Sectigo Public Time Stamping CA R41; notAfter=Mar 24 23:59:59 2041 GMT
- freetsa: O=Free TSA, OU=Root CA, CN=www.freetsa.org, emailAddress=busilezas@gmail.com, L=Wuerzburg, ST=Bayern, C=DE; notAfter=Mar  7 01:52:13 2041 GMT
