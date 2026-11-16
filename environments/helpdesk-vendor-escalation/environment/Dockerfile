FROM python:3.12.7-slim-bookworm@sha256:60d9996b6a8a3689d36db740b49f4327be3be09a21122bd02fb8895abb38b50d

RUN apt-get update \
 && apt-get install -y --no-install-recommends tmux asciinema git less procps \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY app/ /app/
RUN mkdir -p /var/tmp/vendor-portal && git init -q && git add -A \
 && git -c user.name=ci -c user.email=ci@tesselfieldworks.example commit -qm "helpdesk 1.9.2"
