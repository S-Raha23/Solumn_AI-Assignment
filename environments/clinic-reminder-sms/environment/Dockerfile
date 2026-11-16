FROM golang:1.23.3-bookworm@sha256:59b8183301af6dc358c9258d7b2ab0ee1a9363618552334fb3b160d454cbda72

RUN apt-get update \
 && apt-get install -y --no-install-recommends tmux asciinema python3 less procps \
 && rm -rf /var/lib/apt/lists/*

ENV GOFLAGS=-mod=mod GOTOOLCHAIN=local CGO_ENABLED=0
WORKDIR /app
COPY app/ /app/
RUN go build ./... && go test ./... >/dev/null && go clean -testcache \
 && mkdir -p /var/tmp/outbox && git init -q && git add -A \
 && git -c user.name=ci -c user.email=ci@lindenfield.example commit -qm "clinicops 0.14.0"
