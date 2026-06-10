# LabelHub Docker Compose 生产部署说明

本文面向 `https://www.scu-gpt.top/labelhub` 子路径部署。目标服务器为 Ubuntu 24.04、Docker Compose v5、宿主机 Nginx 已管理 HTTPS 证书的场景。

## 1. 镜像构建与推送

在本地或 CI 中从仓库根目录构建并推送 Docker Hub 镜像：

```bash
export DOCKERHUB_USER=your-dockerhub-user
export LABELHUB_IMAGE_TAG=0.1.0

docker buildx build --platform linux/amd64 -f backend/Dockerfile \
  -t docker.io/$DOCKERHUB_USER/labelhub-backend:$LABELHUB_IMAGE_TAG \
  --push .

docker buildx build --platform linux/amd64 -f agent/Dockerfile \
  -t docker.io/$DOCKERHUB_USER/labelhub-agent:$LABELHUB_IMAGE_TAG \
  --push .

docker buildx build --platform linux/amd64 -f frontend/Dockerfile \
  --build-arg VITE_APP_BASE_PATH=/labelhub/ \
  --build-arg VITE_API_BASE_URL=/labelhub/api \
  --build-arg VITE_TURNSTILE_SITE_KEY=your-turnstile-site-key \
  --build-arg VITE_DEMO_VIDEO_URL= \
  -t docker.io/$DOCKERHUB_USER/labelhub-frontend:$LABELHUB_IMAGE_TAG \
  --push .
```

## 2. 服务器准备

1. 创建 swap，1.6 GiB 内存服务器建议至少 2 GiB：

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

2. 准备部署目录并放入仓库中的 `infra/`：

```bash
sudo mkdir -p /opt/labelhub
sudo chown "$USER:$USER" /opt/labelhub
cd /opt/labelhub
```

确保部署目录内包含仓库中的 `infra/docker-compose.yml`、`infra/nginx.conf`、`infra/.env`，以及数据库迁移目录 `infra/db/migration/V*.sql`。如果从仓库根目录复制，可以执行：

```bash
mkdir -p /opt/labelhub/infra/db
cp infra/docker-compose.yml /opt/labelhub/infra/
cp infra/nginx.conf /opt/labelhub/infra/
cp -a backend/src/main/resources/db/migration /opt/labelhub/infra/db/
```

3. 复制 `infra/env.example` 为 `infra/.env`，填写真实密码、Docker Hub 镜像、Turnstile、LLM 和初始 Owner：

```bash
cp infra/env.example infra/.env
chmod 600 infra/.env
```

必须替换的值包括：

- `LABELHUB_BACKEND_IMAGE` / `LABELHUB_AGENT_IMAGE` / `LABELHUB_FRONTEND_IMAGE`
- `LABELHUB_MYSQL_ROOT_PASSWORD` / `LABELHUB_DB_PASSWORD` / `LABELHUB_REDIS_PASSWORD`
- `LABELHUB_AUTH_TURNSTILE_SECRET_KEY`
- `LABELHUB_AUTH_SERVICE_LOGIN_TOKEN`
- `LABELHUB_INITIAL_OWNER_USERNAME` / `LABELHUB_INITIAL_OWNER_PASSWORD`
- `LABELHUB_SYSTEM_AGENT_PASSWORD`
- `LABELHUB_MODEL_CONFIG_SECRET`
- `LABELHUB_LLM_BASE_URL` / `LABELHUB_LLM_API_KEY` / `LABELHUB_LLM_MODEL`
- `VITE_DEMO_VIDEO_URL` 可选；如需在文档中心播放演示视频，填外部可访问的视频 URL。

## 3. 首次初始化与启动

从 `infra/` 目录执行：

```bash
cd /opt/labelhub/infra
docker compose --env-file .env pull
docker compose --env-file .env up -d mysql redis
docker compose --env-file .env --profile migrate run --rm db-migrate
docker compose --env-file .env up -d backend agent frontend
```

`db-migrate` 使用官方 `mysql:8.0` 客户端镜像，并从部署目录挂载 `/opt/labelhub/infra/db/migration/V*.sql`。迁移会显式选择 `labelhub` 数据库，并按版本号顺序执行尚未记录的迁移。迁移容器会创建 `schema_migrations` 运维表，记录已执行版本，避免后续升级时重复运行旧 SQL。当 `LABELHUB_DEMO_USERS_ENABLED=false` 时，迁移结束后会禁用 `owner`、`labeler`、`reviewer`、`demo` 演示账号，后端首次启动会创建正式 Owner，并独立 upsert `system_agent` 机器账号。

后续普通重启只需要：

```bash
cd /opt/labelhub/infra
docker compose --env-file .env pull
docker compose --env-file .env up -d
```

新增迁移后，再单独执行一次：

```bash
docker compose --env-file .env --profile migrate run --rm db-migrate
```

如果不是新库，而是接入已有手工初始化过的 `labelhub` 库，先不要直接运行迁移容器；需要先核对已执行到的 `V*.sql` 版本并补齐 `schema_migrations` 记录，避免重复执行非幂等的 `ALTER TABLE` 迁移。

## 4. Nginx 子路径接入

将 `infra/nginx.conf` 的内容放入宿主机 Nginx 中 `www.scu-gpt.top` 的 HTTPS `server` 块内，然后检查并重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

该片段只新增：

- `/labelhub/` -> `127.0.0.1:18080`
- `/labelhub/api/` -> `127.0.0.1:8080/api/`

MySQL、Redis、backend、frontend 只绑定本机或 Docker 内网，不需要对公网开放。

## 5. 验证

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs --tail=120 backend
docker compose --env-file .env logs --tail=120 agent
curl -I https://www.scu-gpt.top/labelhub/
curl -I https://www.scu-gpt.top/labelhub/login
```

浏览器验证：

1. 打开 `https://www.scu-gpt.top/labelhub/`。
2. 刷新 `/labelhub/login`、`/labelhub/owner/tasks` 等深层路由。
3. 使用 `.env` 中的正式 Owner 登录。
4. 确认演示账号不可登录。
5. 创建数据集、任务、标注、AI 预审、人工审核和导出，走完最小闭环。

## 6. 已知边界

- 当前单次数据集导入和附件上传仍按后端限制保持 20 MB；5 GB 仅按累计容量规划。
- 1.6 GiB 内存只适合演示部署；长期运行建议升级到至少 4 GiB 内存并增加数据盘。
- `LABELHUB_MODEL_CONFIG_SECRET` 首次保存模型配置后必须长期固定，不能随意更换。
