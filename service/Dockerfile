# The Lotcast service image. Build from the repository root:
#   docker build -f service/Dockerfile -t lotcast .
# Run with a volume on /data and the operator key as an environment variable (never in the image):
#   docker run -p 8080:8080 -v lotcast-data:/data -e LOTCAST_OPERATOR_KEY=<64 hex> lotcast
FROM debian:stable-slim
ARG GUION_VERSION=0.9.0
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && curl -fsSL "https://github.com/rmichaelthomas/guion/releases/download/v${GUION_VERSION}/guion-debian-x86_64.tar.gz" -o /tmp/guion.tar.gz \
 && tar -xzf /tmp/guion.tar.gz -C /opt && ln -s /opt/guion-debian-x86_64/bin/guion /usr/local/bin/guion \
 && rm /tmp/guion.tar.gz && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY packages /app/packages
COPY service /app/service
COPY registry /app/registry
WORKDIR /app/service
RUN guion update
RUN mkdir -p /data
ENV PORT=8080
EXPOSE 8080
# --trust-proxy 1: exactly one proxy (the Cloudflare Worker) sits in front, and the rate limit needs its client address.
# File paths in `guion run` are relative to --file-root (/data), so the registry is copied there first.
# `exec` makes guion process 1: a shell as process 1 does not pass SIGTERM on. The service handles TERM itself
# (service/src/run.gu polls for signals): the HTTP server finishes the requests it is handling and returns, and
# the signal loop (service/src/loops.gu) stops the other jobs, so the process exits on its own.
CMD cp /app/registry/lotcast-registry-v1.json /data/registry.json && exec guion run --allow-bind 0.0.0.0:${PORT} --allow-clock --file-root /data \
    --allow-http-host api.drand.sh --allow-http-host drand.cloudflare.com \
    --allow-http-host beacon.nist.gov --allow-http-host random.colorado.edu \
    --allow-http-host timestamp.digicert.com --allow-http-host timestamp.sectigo.com \
    --allow-http-host freetsa.org ${LOTCAST_STORE_HOST:+--allow-http-host $LOTCAST_STORE_HOST} serve.gu \
    --host 0.0.0.0 --port ${PORT} --data-dir lotcast --registry registry.json \
    --trust-proxy 1
