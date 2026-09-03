# ---------- 依赖层 ----------
FROM node:20-slim AS deps
WORKDIR /app
# 固定 pnpm 版本（lockfile v9 需要 pnpm 10；corepack 默认拉最新版会因 Node 版本不匹配失败）
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------- 构建层 ----------
FROM node:20-slim AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---------- 运行层（2C2G 优化：standalone + 精简依赖） ----------
FROM node:20-slim AS runner
WORKDIR /app
# Chromium：PDF 导出用；fonts-noto-cjk：中文 PDF 渲染必备
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    fonts-noto-cjk \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV CHROME_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
