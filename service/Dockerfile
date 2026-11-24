# The Lotcast service image. Build from the repository root:
#   docker build -f service/Dockerfile -t lotcast .
# Run with a volume on /data and the operator key as an environment variable (never in the image):
#   docker run -p 8080:8080 -v lotcast-data:/data -e LOTCAST_OPERATOR_KEY=<64 hex> lotcast
FROM debian:stable-slim
ARG GUION_VERSION=0.8.0
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
ENV PORT=8080
EXPOSE 8080
# --trust-proxy 1: Railway puts exactly one proxy in front, and the rate limit needs its client address.
CMD guion run --allow-bind 0.0.0.0:${PORT} --allow-clock --file-root /data \
    --allow-http-host api.drand.sh --allow-http-host drand.cloudflare.com \
    --allow-http-host beacon.nist.gov --allow-http-host random.colorado.edu \
    --allow-http-host timestamp.digicert.com --allow-http-host timestamp.sectigo.com \
    --allow-http-host freetsa.org serve.gu \
    --host 0.0.0.0 --port ${PORT} --data-dir /data/lotcast --registry /app/registry/lotcast-registry-v1.json \
    --trust-proxy 1
