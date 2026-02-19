FROM ghcr.io/vibe80/vibe80-base:latest AS app-build

WORKDIR /app

COPY package*.json ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/

RUN npm ci

COPY . .

RUN npm run build

FROM ghcr.io/vibe80/vibe80-base:latest

WORKDIR /app

COPY --from=app-build /app /app

RUN chown -R vibe80:vibe80 /app /var/lib/vibe80

EXPOSE 5179

ENV VIBE80_SERVER_USER=vibe80 \
    MONO_USER_WORKSPACE_DIR=/home/vibe80

USER vibe80

ENTRYPOINT ["tini", "--"]
CMD ["node", "server/src/index.js"]
