FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY bin ./bin
COPY scripts ./scripts
COPY src ./src
COPY tsconfig.json ./

RUN pnpm run build

FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runtime

LABEL org.opencontainers.image.source="https://github.com/Mistermode45/FuryPipe" \
      org.opencontainers.image.description="FuryPipe governed AI workflow runtime" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
ENV FURYPIPE_HOST=0.0.0.0
ENV FURYPIPE_PORT=48721
ENV FURYPIPE_CONFIG=/data/config.json
ENV FURYPIPE_LOG=/data/events.jsonl

WORKDIR /app

COPY --from=build --chown=node:node /app/dist/node.js ./dist/node.js
COPY --chown=node:node LICENSE ./licenses/LICENSE
COPY --chown=node:node assets/*LICENSE.txt ./licenses/

RUN mkdir /data && chown node:node /data

USER node

EXPOSE 48721
VOLUME ["/data"]

HEALTHCHECK --interval=5s --timeout=2s --start-period=2s --retries=3 \
  CMD node -e "const s=require('node:net').connect(process.env.FURYPIPE_PORT,'127.0.0.1');s.setTimeout(1500);s.on('connect',()=>{s.destroy();process.exit(0)});s.on('timeout',()=>process.exit(1));s.on('error',()=>process.exit(1))"

CMD ["node", "dist/node.js"]
