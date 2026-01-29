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

RUN useradd -m -d /home/app -s /bin/bash app \
    && mkdir -p /home/app/.codex \
    && chown -R app:app /app /home/app/.codex
RUN chmod +x /app/start.sh

RUN curl -fsSL https://claude.ai/install.sh | bash

EXPOSE 5179

CMD ["/app/start.sh"]
