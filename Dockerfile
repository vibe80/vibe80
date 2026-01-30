FROM golang:1.22-bookworm AS helper-builder

WORKDIR /src
COPY tools/go.mod ./tools/go.mod
COPY tools/vibecoder-root ./tools/vibecoder-root
COPY tools/vibecoder-run-as ./tools/vibecoder-run-as

WORKDIR /src/tools
RUN go build -o /out/vibecoder-root ./vibecoder-root \
    && go build -o /out/vibecoder-run-as ./vibecoder-run-as

FROM node:25-trixie-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    ripgrep \
    fd-find \
    fzf \
    bat \
    eza \
    git \
    openssh-client \
    jq \
    yq \
    httpie \
    pre-commit \
    direnv \
    tree \
    curl \
    sudo \
    && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
    && ln -sf /usr/bin/batcat /usr/local/bin/bat \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex

COPY package*.json ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/

RUN npm ci

COPY . .

RUN npm run build

COPY --from=helper-builder /out/vibecoder-root /usr/local/bin/vibecoder-root
COPY --from=helper-builder /out/vibecoder-run-as /usr/local/bin/vibecoder-run-as

RUN useradd -m -d /home/vibecoder -s /bin/bash vibecoder \
    && mkdir -p /home/vibecoder/.codex \
    && chown -R vibecoder:vibecoder /app /home/vibecoder/.codex \
    && chmod 0755 /usr/local/bin/vibecoder-root /usr/local/bin/vibecoder-run-as \
    && printf \"%s\\n\" \
      \"vibecoder ALL=(root) NOPASSWD: /usr/local/bin/vibecoder-root\" \
      \"vibecoder ALL=(root) NOPASSWD: /usr/local/bin/vibecoder-run-as\" \
      \"Defaults! /usr/local/bin/vibecoder-root !requiretty\" \
      \"Defaults! /usr/local/bin/vibecoder-run-as !requiretty\" \
      > /etc/sudoers.d/vibecoder \
    && chmod 0440 /etc/sudoers.d/vibecoder
RUN chmod +x /app/start.sh

# Install Claude code
RUN curl -fsSL https://claude.ai/install.sh | bash
# Make Claude command available to all users
RUN bash -c 'mv $(readlink /root/.local/bin/claude) /usr/bin/claude'

EXPOSE 5179

ENV VIBECODER_SERVER_USER=vibecoder

USER vibecoder

CMD ["/app/start.sh"]
