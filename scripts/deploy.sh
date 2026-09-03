#!/usr/bin/env bash
# openmaic-lite 云服务器一键部署脚本（Ubuntu 22.04/24.04，2核2G 优化）
# 前置：已安装 Docker 与 Docker Compose 插件（见 docs/DEPLOY.md 第 2 步）
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> [1/4] 配置 2G swap（2C2G 必备，防构建/导出 OOM）"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "swap 已创建"
else
  echo "swap 已存在，跳过"
fi

echo "==> [2/4] 生成 .env（如不存在）"
if [ ! -f .env ]; then
  cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 12)
LLM_API_KEY=替换为你的Key
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
EOF
  echo "已生成 .env，请编辑填入 LLM_API_KEY 后重新运行本脚本"
  exit 1
fi

echo "==> [3/4] 构建并启动（首次约 3-5 分钟）"
docker compose -f docker-compose.prod.yml up -d --build

echo "==> [4/4] 健康检查"
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3000/api/courses >/dev/null 2>&1; then
    echo "✅ 应用已就绪：http://127.0.0.1:3000"
    echo "下一步：配置 Nginx 反向代理 + 域名 + HTTPS（见 docs/DEPLOY.md 第 5 步）"
    exit 0
  fi
  sleep 2
done
echo "❌ 健康检查超时，查看日志：docker compose -f docker-compose.prod.yml logs app"
exit 1
