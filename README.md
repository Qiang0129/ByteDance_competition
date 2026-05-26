# LabelHub Data Annotation Platform

LabelHub 是一个面向数据标注协作流程的 Web 平台。当前仓库包含 React 前端、Spring Boot 后端、MySQL 表结构与本地演示账号，已覆盖 Owner 创建任务/导入数据、Labeler 任务市场认领/我的任务、认证与角色切换等核心本地闭环。

## 当前状态

已实现或已接入的主要能力：

1. 认证与会话

   - `POST /api/auth/login`、`GET /api/auth/me`、`POST /api/auth/logout`
   - 基于 Redis 保存登录 token
   - 前端缓存当前用户,刷新后可回到默认工作台
   - 顶栏支持在当前账号已有角色之间切换
2. Owner 工作台

   - 任务列表、新建任务、发布/暂停等状态流转
   - 模板列表与模板设计器前端能力
   - 数据集列表、创建数据集、导入文件、向已有数据集追加文件数据
   - Owner 数据看板页面,后端接口未完成时会保留前端演示数据
3. Labeler 工作台

   - 任务市场读取后端真实任务
   - 支持按任务类型、分发策略、媒体类型、AI 预审等条件筛选
   - `POST /api/tasks/{taskId}/claim` 真实写入 `assignments`
   - “我的任务”读取 `GET /api/assignments/mine`
4. Reviewer 工作台

   - 当前保留 Reviewer 首页和后续审核流程入口

仍需注意的边界：

- `assigned` 分发策略目前只支持返回已预分配给当前标注员的 assignment,还没有 Owner 指派名单配置页。
- AI 预审、人工审核、导出等页面有前端入口,部分后端能力仍待后续阶段补齐。
- `infra/docker-compose.yml` 当前仍是占位文件,本地联调建议先按下面的手动方式启动 MySQL、Redis、后端和前端。

## 技术栈

前端：

- React 18
- TypeScript
- Vite 8
- Ant Design 6
- React Router 7
- dnd-kit

后端：

- Java 21
- Spring Boot 3.4.5
- Spring Web / Security / JDBC / Validation
- Spring Data Redis
- MySQL Connector/J
- Springdoc OpenAPI

存储与中间件：

- MySQL 8.0+
- Redis 6+

## 环境要求

建议本地环境：

```text
Node.js 22+
npm 10+
Java 21+
MySQL 8.0+
Redis 6+
```

默认后端配置：

```text
后端端口: 8080
MySQL 地址: 127.0.0.1:3306
MySQL 数据库: labelhub
MySQL 用户: root
MySQL 密码: 通过 LABELHUB_DB_PASSWORD 设置
Redis 地址: 127.0.0.1:6379
Redis 密码: 默认空
```

常用环境变量：

```text
LABELHUB_BACKEND_PORT=8080
LABELHUB_DB_URL=jdbc:mysql://127.0.0.1:3306/labelhub?useUnicode=true&characterEncoding=utf8&connectionCollation=utf8mb4_unicode_ci&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true
LABELHUB_DB_USERNAME=root
LABELHUB_DB_PASSWORD=你的数据库密码
LABELHUB_REDIS_HOST=127.0.0.1
LABELHUB_REDIS_PORT=6379
LABELHUB_REDIS_PASSWORD=
LABELHUB_AUTH_TOKEN_TTL_SECONDS=7200
LABELHUB_DEMO_USERS_ENABLED=true
LABELHUB_DEMO_ALL_ROLES_PASSWORD=demo123
```

## 数据库初始化

当前项目没有引入 Flyway 运行时依赖,需要手动执行 SQL 文件初始化表结构和演示账号。

1. 创建并初始化表结构

```powershell
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V1__init_labelhub_schema.sql"
```

2. 写入本地演示账号

```powershell
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V2__seed_demo_auth_users.sql"
```

已有数据库从旧版结构升级时,再执行一次数据集解绑迁移:

```powershell
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V3__allow_unbound_datasets.sql"
```

模板搭建后端需要 `task_schema_versions` 支持独立草稿,旧库还需要执行:

```powershell
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V4__support_schema_designer_backend.sql"
```

把命令中的 `123456` 换成你的 MySQL root 密码。`V1__init_labelhub_schema.sql` 内部会创建并切换到 `labelhub` 数据库。

后端启动时也会通过 `DemoUserInitializer` upsert 演示账号。新增或修改演示账号后,需要重启后端服务才会写入当前数据库。

## 启动后端

先确保 MySQL 和 Redis 已启动。

PowerShell：

```powershell
cd backend
$env:LABELHUB_DB_PASSWORD='123456'
.\mvnw.cmd spring-boot:run
```

cmd：

```cmd
cd backend
set LABELHUB_DB_PASSWORD=123456
mvnw.cmd spring-boot:run
```

后端默认地址：

```text
http://127.0.0.1:8080
```

启动成功时日志中会出现类似内容：

```text
Tomcat started on port 8080
Started LabelHubBackendApplication
```

如果提示 `Port 8080 was already in use`,可以停止占用端口的旧进程,或设置 `LABELHUB_BACKEND_PORT` 使用其它端口。前端 Vite 代理默认转发到 `http://127.0.0.1:8080`,改后端端口时也要同步调整 `frontend/vite.config.ts`。

## 启动前端

另开一个终端：

```powershell
cd frontend
npm install
npm run dev
```

前端默认地址：

```text
http://localhost:5173
```

Vite 开发代理会把 `/api` 转发到：

```text
http://127.0.0.1:8080
```

本地联调时建议启动顺序为：MySQL -> Redis -> 后端 -> 前端。

## 演示账号

推荐使用多角色账号进行完整演示：

```text
账号: demo
密码: demo123
角色: owner + labeler + reviewer
用途: 登录后可在顶栏切换 Owner / Labeler / Reviewer 工作台
```

单角色账号仍然保留：

```text
1. Owner Demo
   - 用户名: owner
   - 密码: owner123
   - 角色: owner

2. Labeler Demo
   - 用户名: labeler
   - 密码: labeler123
   - 角色: labeler

3. Reviewer Demo
   - 用户名: reviewer
   - 密码: reviewer123
   - 角色: reviewer
```

登录页提供演示账号快捷按钮。`All Roles` 按钮会使用 `demo / demo123` 登录,默认进入 Owner 工作台。

## 常用入口

前端页面入口：

```text
/login
/owner/tasks
/owner/templates
/owner/templates/designer
/owner/datasets
/owner/ai-review
/owner/review
/owner/dashboard
/owner/export
/labeler
/labeler/market
/labeler/my-tasks
/labeler/drafts
/labeler/returned
/reviewer
```

后端主要 API：

```text
POST /api/auth/login
POST /api/auth/register
POST /api/auth/logout
GET  /api/auth/me

POST /api/tasks
GET  /api/tasks
PUT  /api/tasks/{taskId}/state
GET  /api/market/tasks
POST /api/tasks/{taskId}/claim
GET  /api/assignments/mine

GET  /api/datasets
POST /api/datasets
POST /api/datasets/import
POST /api/datasets/{datasetId}/items/import
GET  /api/datasets/{datasetId}/items
```

Swagger UI：

```text
http://127.0.0.1:8080/swagger-ui/index.html
```

OpenAPI JSON：

```text
http://127.0.0.1:8080/v3/api-docs
```

## 样例数据

前端内置了部分样例文件,可用于数据导入和任务演示：

```text
frontend/public/sample-datasets/qa_quality.json
frontend/public/sample-datasets/qa_quality.jsonl
frontend/public/sample-datasets/preference_compare.json
frontend/public/sample-datasets/preference_compare.jsonl
frontend/public/sample-datasets/market-tasks.json
```

数据集导入接口当前支持 JSON、JSONL、CSV 和基础 XLSX 文件解析。上传后数据会写入 `items.raw_payload`,Owner 数据集页面会读取后端数据进行预览。

## 构建检查

后端构建：

```powershell
cd backend
.\mvnw.cmd -q -DskipTests package
```

前端构建：

```powershell
cd frontend
npm run build
```

最近一次相关验证：

```text
backend: .\mvnw.cmd -q -DskipTests package 通过
frontend: npm run build 通过
```

前端构建可能提示 chunk 体积超过 500 kB,这是当前依赖和页面聚合带来的构建告警,不影响本地功能运行。

## 常见问题

1. 登录失败或刷新后掉线

   - 确认 Redis 已启动。
   - token 存在 Redis 中,重启或清空 Redis 后需要重新登录。
2. `demo / demo123` 不存在

   - 确认已经执行 `V2__seed_demo_auth_users.sql`,或重启后端让 `DemoUserInitializer` 自动 upsert。
   - 确认 `LABELHUB_DEMO_USERS_ENABLED` 没有被设置为 `false`。
3. “切换角色”只能看到一个角色

   - 单角色账号只能切换当前账号已有角色。
   - 需要跨 Owner / Labeler / Reviewer 演示时,使用 `demo / demo123`。
4. 前端请求 `/api` 失败

   - 确认后端运行在 `http://127.0.0.1:8080`。
   - 如果改了后端端口,同步修改 `frontend/vite.config.ts` 的 proxy target。
5. 认领成功但“我的任务”为空

   - 确认使用的是 Labeler 角色视角。
   - 确认任务已发布且数据集内有可认领 item。
   - 当前“我的任务”读取 `GET /api/assignments/mine`,需要后端和数据库都正常运行。
