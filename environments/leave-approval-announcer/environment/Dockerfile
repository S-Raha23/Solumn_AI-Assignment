FROM ruby:3.3.6-slim-bookworm@sha256:b210597cc7d05e19edf9c8e7935dcf1554886905dcdad0475cfe63a654147f7a

RUN apt-get update \
 && apt-get install -y --no-install-recommends tmux asciinema python3 git less procps \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY app/ /app/
RUN chmod +x bin/leavedesk && mkdir -p /var/tmp/chat-outbox && git init -q && git add -A \
 && git -c user.name=ci -c user.email=ci@quillmark.example commit -qm "leavedesk 3.2.0"
