FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=1234
ENV COLLABMD_VAULT_DIR=/data

RUN apk add --no-cache git openssh-client ca-certificates \
    && rm -rf /var/cache/apk/*

RUN addgroup -g 1001 -S collabmd \
    && adduser -u 1001 -S collabmd -G collabmd -h /home/collabmd

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/bin ./bin
COPY --from=build /app/scripts ./scripts

RUN mkdir -p /data /tmp/collabmd && chown -R collabmd:collabmd /data /tmp/collabmd

USER collabmd

# Default vault directory — mount a volume here
VOLUME ["/data"]

EXPOSE 1234

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 CMD wget -qO- http://127.0.0.1:1234/health || exit 1

CMD ["node", "bin/collabmd.js"]
