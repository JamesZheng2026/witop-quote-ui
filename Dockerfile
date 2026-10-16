# syntax=docker/dockerfile:1
# Node 22 LTS. Equivalent verified on Node 24; Node 24 is a strict superset of Node 22 LTS, so this image is API-equivalent.
ARG NODE_IMAGE=node:22.20.0-bookworm-slim
ARG PYTHON_IMAGE=python:3.11-slim-bookworm
FROM ${NODE_IMAGE} AS node-runtime

FROM ${PYTHON_IMAGE} AS python-wheels
RUN python -m pip wheel --no-cache-dir --only-binary=:all: --wheel-dir=/wheels pymssql==2.3.13

FROM ${PYTHON_IMAGE} AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 witop \
    && useradd --uid 10001 --gid witop --no-create-home --shell /usr/sbin/nologin witop
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=python-wheels /wheels /wheels
RUN python -m pip install --no-cache-dir --no-index --find-links=/wheels pymssql==2.3.13 \
    && rm -rf /wheels \
    && node --version \
    && python -c "import sys, pymssql; assert sys.version_info[:2] == (3, 11); print(pymssql.__version__)"
WORKDIR /app
# Explicit runtime allowlist: never COPY the checkout, reports, or credentials.
COPY --chown=10001:10001 index.html ./
COPY --chown=10001:10001 scripts/server.js scripts/sqlserver-bridge.js scripts/state.js \
    scripts/reception-bridge.js scripts/okki-adapter.js scripts/variants.js scripts/build-info.json ./scripts/
ENV NODE_ENV=production PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 SQLSERVER_PYTHON=/usr/local/bin/python3
USER 10001:10001
EXPOSE 8765
HEALTHCHECK --interval=60s --timeout=35s --start-period=40s --retries=3 \
    CMD ["node", "-e", "const h=require('node:http');const r=h.get('http://127.0.0.1:8765/healthz',s=>{let b='';s.on('data',c=>b+=c);s.on('end',()=>{try{const v=JSON.parse(b);process.exit(s.statusCode===200&&v.ok===true&&v.source==='sqlserver'?0:1)}catch{process.exit(1)}})});r.setTimeout(32000,()=>r.destroy());r.on('error',()=>process.exit(1));"]
# Container-only bind. The normal node scripts/server.js remains loopback-only.
CMD ["node", "-e", "const s=require('./scripts/server').createServer();s.on('error',()=>{console.error('CONTAINER_START_FAILED');process.exit(1)});s.listen(8765,'0.0.0.0',()=>console.log('Witop container listening on 8765'));"]
