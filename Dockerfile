FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache \
    ripgrep \
    fd \
    fzf \
    bat \
    eza \
    git \
    openssh \
    jq \
    yq \
    httpie \
    pre-commit \
    direnv \
    tree

RUN npm install -g @openai/codex

COPY package*.json ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/

RUN npm install

COPY . .

RUN npm run build

RUN adduser -D -h /home/app app && chown -R app:app /app
RUN chmod +x /app/start.sh

USER app

EXPOSE 5179

CMD ["/app/start.sh"]
