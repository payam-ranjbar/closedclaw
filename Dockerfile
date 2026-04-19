FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
COPY templates/ ./templates/
RUN npm run build

FROM node:20-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code

ARG UID=1000
ARG GID=1000
RUN groupadd -g ${GID} agent && useradd -u ${UID} -g ${GID} -m -s /bin/bash agent

WORKDIR /app
COPY --from=builder --chown=agent:agent /app/dist ./dist
COPY --from=builder --chown=agent:agent /app/templates ./templates
COPY --from=builder --chown=agent:agent /app/package.json ./
RUN npm install --omit=dev && npm link

USER agent
ENV CLOSEDCLAW_WORKSPACE=/workspace
VOLUME ["/workspace", "/home/agent/.claude"]
EXPOSE 3000
CMD ["closedclaw", "start"]
