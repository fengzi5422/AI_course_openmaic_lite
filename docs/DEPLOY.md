# 云服务器部署指南（阿里云 2核2G Ubuntu）

> 本机开发不用看本文；这是把项目部署到云服务器的完整步骤。

## 架构

```
用户 → 域名(DNS A记录→服务器IP) → Nginx(80/443) → 127.0.0.1:3000 (Docker app)
                                                      └→ Docker postgres(内网)
```

2C2G 资源预算：app ≤1.28G + postgres ≤384M + 系统 ≈0.3G，另配 2G swap 兜底（构建与 PDF 导出是内存峰值）。
**OCR（PaddleOCR）不在服务器启用**——2G 内存跑不动，扫描件识别请用本地环境。

## 1. 阿里云控制台准备

- 安全组放行：22（SSH）、80（HTTP）、443（HTTPS）
- 域名 DNS 加 A 记录指向服务器公网 IP（如 `@` 和 `www`）
- 国内服务器绑定域名需完成 ICP 备案（阿里云控制台可办）

## 2. 服务器初始化（SSH 登录后）

```bash
# 更新 + 基础工具
sudo apt update && sudo apt install -y curl git

# 安装 Docker（官方源）
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # 重新登录生效
```

## 3. 拉代码并部署

```bash
git clone https://github.com/fengzi5422/AI_course_openmaic_lite.git
cd AI_course_openmaic_lite
bash scripts/deploy.sh     # 自动：2G swap + .env 生成 + docker compose 构建 + 健康检查
```

脚本首次运行会生成 `.env` 并退出，编辑 `.env` 填入 `LLM_API_KEY` 后再跑一次：

```bash
nano .env && bash scripts/deploy.sh
```

验证：`curl http://127.0.0.1:3000` 返回页面即成功。

## 4. 日常运维

```bash
docker compose -f docker-compose.prod.yml logs -f app     # 看日志
docker compose -f docker-compose.prod.yml restart app     # 重启应用
docker compose -f docker-compose.prod.yml up -d --build   # 更新代码后重新部署
docker compose -f docker-compose.prod.yml down            # 停止（数据在 pgdata 卷，不丢）
docker exec -it $(docker ps -qf name=db) pg_dump -U openmaic openmaic > backup.sql  # 备份
```

## 5. Nginx 反向代理 + HTTPS

```bash
sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/openmaic
```

```nginx
server {
    listen 80;
    server_name your-domain.xyz www.your-domain.xyz;   # 换成你的域名
    client_max_body_size 25m;                          # 参考资料上传 20MB 限制

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;                       # 生成任务轮询/PDF 导出较慢
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/openmaic /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# HTTPS（ certbot 免费证书，自动续期）
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.xyz -d www.your-domain.xyz
```

## 6. 常见问题

| 问题 | 处理 |
|---|---|
| 构建 OOM / 卡死 | 确认 swap 已启用（`free -h`）；脚本已自动配 2G swap |
| PDF 导出失败 | 容器内自带 Chromium（`CHROME_PATH=/usr/bin/chromium`）；中文依赖 fonts-noto-cjk 已内置 |
| 生成一直失败 | `.env` 的 LLM_API_KEY 未填或失效；`docker compose logs app` 看 genjob 日志 |
| 上传大文件 413 | Nginx `client_max_body_size` 需 ≥20MB（模板已配 25m） |
| 访问慢 | 首次生成需 LLM 逐场景产出（10 场景约 5-8 分钟）；已做后台任务化，中途关页面不影响 |
| 数据在哪 | postgres 容器 pgdata 卷；`docker volume ls` 查看，重部署不丢数据 |
