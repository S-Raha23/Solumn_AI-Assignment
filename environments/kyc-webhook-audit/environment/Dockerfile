FROM node:22.11.0-bookworm-slim@sha256:f035ba7ffee18f67200e2eb8018e0f13c954ec16338f264940f701997e3c12da

RUN apt-get update \
 && apt-get install -y --no-install-recommends tmux asciinema python3 git less procps \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_OPTIONS="--experimental-strip-types --no-warnings"
WORKDIR /app
COPY app/ /app/
RUN mkdir -p /var/tmp/audit && git init -q && git add -A \
 && git -c user.name=ci -c user.email=ci@pocketwise.example commit -qm "pocketwise-api 0.31.0"
