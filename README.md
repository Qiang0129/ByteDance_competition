# LabelHub 数据标注平台

LabelHub 是一个面向数据标注、AI 预审和人工审核协作的 Web 平台。当前仓库包含 React 前端、Spring Boot 后端、独立 AI Review Agent、MySQL 迁移脚本和本地演示账号，已经形成从 Owner 创建任务到 Labeler 标注、AI Agent 预审、Reviewer 裁决、Owner 查看进度与导出的本地联调闭环。

本文档作为项目入口，帮助开发者快速理解系统边界、目录结构、运行方式和主要入口。接口细节以 Swagger UI、代码和 [接口文档.md](接口文档.md) 为准。

## 1. 项目概览

### 1.1 适用场景

LabelHub 适合需要多人协作、质量审核和 AI 辅助质检的数据标注流程：

- Owner 负责创建任务、配置标注模板、导入数据集、分配题量、管理审核和导出结果。
- Labeler 负责领取任务、填写结构化标注表单、保存草稿、提交答案和处理打回项。
- Reviewer 负责结合 AI 预审结果进行人工裁决、处理争议样本和查看审核时间线。
- AI Review Agent 负责从后端领取预审 Job，调用 OpenAI-compatible LLM，并把结构化审核结果写回后端。

### 1.2 当前完成度

已具备的主要能力：

- 公开首页、文档页、关于页、登录、注册、退出、刷新会话和多角色切换。
- Redis token 会话与后端启动时自动 upsert 演示账号。
- Owner 任务、模板、数据集、AI 预审规则、审核管理、看板、导出、模型设置和审核员邀请注册。
- Labeler 首页、任务市场、我的任务、草稿箱、打回项、答题页、批量提交、问题上报和 LLM 助手。
- Reviewer 首页、AI 审核任务列表、三栏审核工作台、人工裁决、争议样本和审核时间线。
- 独立 Agent 服务，支持登录后端、领取 AI Review Job、调用 LLM、完成或失败回写。
- 外观主题设置，支持后台角色共享的明暗模式与样式版本。

当前需要注意的边界：

- `infra/docker-compose.yml` 仍是占位文件，Docker 生产编排需要另行补齐。
- `docs/architecture.md` 与 `docs/api-docs.md` 目前仍是占位文档，详细说明主要沉淀在 README、阶段文档、接口文档和源码中。
- 演示账号、默认密码、模型 API Key 和 `LABELHUB_MODEL_CONFIG_SECRET` 只适合开发环境，生产环境必须重新配置。

### 1.3 核心业务闭环

```text
Owner 创建任务/模板/数据集
  -> 发布任务并配置标注员、审核员题量
  -> Labeler 领取题目并提交标注
  -> 后端创建 AI Review Job
  -> Agent 调用 LLM 完成预审
  -> Reviewer 参考 AI 结果进行人工裁决
  -> Owner 在看板查看进度、风险和质量数据
  -> Owner 导出标注与审核结果
```

## 2. 系统能力

### 2.1 Owner 工作台

Owner 端覆盖标注项目从准备到交付的主要流程：

- 任务管理：创建、编辑、删除、发布、暂停、恢复、状态筛选和任务范围控制。
- 题量配置：支持标注员和审核员按人配置题量，任务题集可固定在指定数据范围内。
- 模板设计：支持 Schema 草稿、校验、发布、撤回、删除和多 Tab 表单编排。
- 数据集管理：支持创建、导入、追加导入、预览、删除，导入格式包括 JSON、JSONL、CSV 和基础 XLSX。
- AI 预审：支持规则配置、启停、Job 队列、结果查看、重试、取消和批量删除。
- 审核管理：支持任务审核概览、审核员负载、审核日志和题目时间线。
- 数据看板：展示任务进度、质量指标、到期风险、里程碑和近期数据变化。
- 结果导出：支持导出任务创建、状态查看、下载、下载确认和文件元数据记录。
- 系统设置：支持外观设置和 AI 模型运行配置。
- 审核员邀请：Owner 可创建 Reviewer 邀请，受邀用户可通过邀请码完成注册。

### 2.2 Labeler 工作台

Labeler 端面向标注员日常作业：

- 首页概览：展示任务数量、贡献统计、待处理事项和近期标注记录。
- 任务市场：查看可领取任务，领取后写入真实 `assignments`。
- 我的任务：查看已领取任务和作业进度。
- 答题页：按任务 Schema 渲染结构化表单，支持草稿保存、单题提交和批量提交。
- 打回项：查看审核打回的题目，按要求返工并重新提交。
- 问题上报：在标注过程中记录样本或任务问题。
- LLM 助手：在答题页提供辅助理解和标注建议入口。

### 2.3 Reviewer 工作台

Reviewer 端面向人工复核与争议处理：

- 首页概览：展示待审核、已处理、争议和近期审核数据。
- AI 审核队列：查看按任务聚合的 AI 预审结果。
- 三栏工作台：同时查看样本内容、Labeler 答案、AI 建议和人工裁决区。
- 审核裁决：支持通过、打回、争议等审核动作。
- 时间线：追踪题目从分配、提交、AI 预审到人工审核的关键事件。
- 争议样本：集中处理存在分歧或需要终审的样本。

### 2.4 AI Reviewer 与 Agent

AI 预审能力由后端 API、Web 配置页和独立 Agent 共同完成：

- Web 端提供 AI Reviewer 仪表盘、预审队列和模型设置。
- 后端提供 AI Review Job 的 claim、complete、fail、retry、cancel 等接口。
- Agent 使用 `system_agent` 账号登录后端，轮询领取 Job，并调用 OpenAI-compatible Responses API。
- Web 端 active 模型配置优先于 Agent 终端环境变量；终端 `LABELHUB_LLM_*` 只作为兜底。
- `LABELHUB_MODEL_CONFIG_SECRET` 用于加密 Web 端保存的模型 API Key，保存后必须保持稳定。

### 2.5 公开页与个性化

公开页面和通用能力包括：

- `/`：公开首页。
- `/docs`：文档入口页。
- `/about`：渲染根目录 README，并支持目录定位。
- `/login`：登录和注册入口。
- 外观设置：Owner、Labeler、Reviewer、AI Reviewer 均可通过各自设置路径调整外观。

## 3. 技术架构

### 3.1 前端

前端位于 `frontend/`，采用 React + Vite 构建：

- React 18、TypeScript 6、Vite 8。
- Ant Design 6 作为主要 UI 组件库。
- React Router 7 负责前端路由。
- Formily / JSON Schema 负责动态标注表单渲染。
- dnd-kit 支撑模板设计器拖拽能力。
- Recharts 用于看板图表。
- React Markdown / remark-gfm 用于 README 和文档内容渲染。

关键目录：

```text
frontend/src/api/        前端 API 请求封装
frontend/src/layouts/    后台布局、错误边界、主题切换入口
frontend/src/modules/    Schema 渲染、编译、校验等领域模块
frontend/src/pages/      公开页与各角色页面
frontend/src/router/     路由定义
frontend/src/styles/     全局样式和公开页样式
frontend/src/theme/      主题预设和主题上下文
frontend/src/types/      前端接口类型
```

### 3.2 后端

后端位于 `backend/`，采用 Java 21 + Spring Boot：

- Spring Boot 3.4.5。
- Spring Web / Security / JDBC / Validation。
- Spring Data Redis 用于 token 会话。
- MySQL Connector/J 连接业务数据库。
- Apache POI 支持基础 XLSX 导入。
- Springdoc OpenAPI 提供 Swagger UI。

后端模块按业务域组织，典型包包括：

```text
auth              登录、注册、token、演示账号、审核员邀请
task              任务管理、任务范围、分配配置
schema            标注模板和 Schema 版本
dataset           数据集导入、预览和样本管理
labeler           标注员工作台与任务作业
reviewer          审核员工作台与人工裁决
ownerreview       Owner 审核管理视图
ai                AI 预审规则、Job 队列和模型配置
dashboard         Owner / Labeler / Reviewer 看板数据
export            导出任务、文件元数据和下载确认
workflow          状态机与审计日志
```

### 3.3 Agent

Agent 位于 `agent/`，是独立 Spring Boot Worker：

- 通过后端登录接口获取 token。
- 按配置并发轮询 AI Review Job。
- 组装样本、Schema、标注答案和规则提示词。
- 调用 OpenAI-compatible LLM。
- 解析结构化输出并回写后端。

关键目录：

```text
agent/src/main/java/com/labelhub/agent/config/   Agent 配置
agent/src/main/java/com/labelhub/agent/jobs/     Job 轮询与执行
agent/src/main/java/com/labelhub/agent/llm/      LLM 调用
agent/src/main/java/com/labelhub/agent/parser/   AI 输出解析
agent/src/main/java/com/labelhub/agent/model/    请求与响应模型
```

### 3.4 存储与基础设施

当前依赖：

- MySQL 8.0+：业务数据、迁移 SQL、任务、样本、标注、审核、导出和模型配置。
- Redis 6+：登录 token 会话。
- 本地文件系统：导出文件默认保存到后端 `data/exports`。

基础设施目录：

```text
infra/       基础设施配置入口，目前 docker-compose 仍为占位
datasets/    样例或外部数据目录
docs/        补充文档入口
image/       项目图片资源
submission/  比赛提交材料
```

## 4. 本地运行

### 4.1 环境要求

建议使用以下版本：

```text
Node.js 22+
npm 10+
Java 21+
MySQL 8.0+
Redis 6+
```

默认端口：

```text
后端: http://127.0.0.1:8080
Agent: http://127.0.0.1:8091
前端: http://localhost:5173
Vite preview: http://localhost:4173
Swagger UI: http://127.0.0.1:8080/swagger-ui/index.html
```

### 4.2 常用环境变量

后端最小配置：

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
LABELHUB_MODEL_CONFIG_SECRET=固定且足够随机的本地模型配置加密密钥
LABELHUB_EXPORT_STORAGE_DIR=data/exports
```

认证与人机验证配置：

```text
# 后端启动时读取，生产环境必须使用 Cloudflare Turnstile 真实 secret key。
LABELHUB_AUTH_TURNSTILE_SECRET_KEY=你的 Cloudflare Turnstile secret key
LABELHUB_AUTH_TURNSTILE_SITEVERIFY_URL=https://challenges.cloudflare.com/turnstile/v0/siteverify
LABELHUB_AUTH_TURNSTILE_TIMEOUT_MS=5000

# 后端启动时读取，用于允许 system_agent 机器登录绕过浏览器 Turnstile。
# 生产环境必须替换为强随机值。
LABELHUB_AUTH_SERVICE_LOGIN_TOKEN=同一个强随机服务令牌
```

前端构建配置：

```text
# 前端构建时读取，必须在 npm run build 前设置。
# 这是公开 site key，可以出现在浏览器静态资源中。
VITE_TURNSTILE_SITE_KEY=你的 Cloudflare Turnstile site key
```

后端演示账号密码可通过以下变量覆盖：

```text
LABELHUB_DEMO_OWNER_PASSWORD=owner123
LABELHUB_DEMO_LABELER_PASSWORD=labeler123
LABELHUB_DEMO_REVIEWER_PASSWORD=reviewer123
LABELHUB_DEMO_AI_REVIEWER_PASSWORD=ai_reviewer123
LABELHUB_DEMO_SYSTEM_AGENT_PASSWORD=agent123
LABELHUB_DEMO_ALL_ROLES_PASSWORD=demo123
```

Agent 常用配置：

```text
LABELHUB_AGENT_PORT=8091
LABELHUB_BACKEND_BASE_URL=http://localhost:8080
LABELHUB_AGENT_USERNAME=system_agent
LABELHUB_AGENT_PASSWORD=agent123
LABELHUB_AGENT_ROLE=system_agent
LABELHUB_AGENT_SERVICE_LOGIN_TOKEN=同一个强随机服务令牌
LABELHUB_AGENT_WORKER_ENABLED=true
LABELHUB_AGENT_CONCURRENCY=3
LABELHUB_AGENT_POLL_INTERVAL_MS=5000
LABELHUB_AGENT_IDLE_DELAY_MS=1500
LABELHUB_LLM_BASE_URL=https://www.pqapi.store/v1
LABELHUB_LLM_API_KEY=你的 API Key
LABELHUB_LLM_MODEL=gpt-5.5
LABELHUB_LLM_REASONING_EFFORT=high
LABELHUB_LLM_WIRE_API=responses
LABELHUB_LLM_TIMEOUT_MS=120000
```

注意事项：

- `LABELHUB_MODEL_CONFIG_SECRET` 首次保存模型配置前必须设置，保存后不能随意更换。
- `LABELHUB_LLM_API_KEY` 不要写入仓库文件，也不要提交到 Git。
- `VITE_TURNSTILE_SITE_KEY` 是前端构建期变量，修改后需要重新执行 `npm run build`。
- `LABELHUB_AUTH_TURNSTILE_SECRET_KEY` 只给后端使用，不要暴露到前端或提交到 Git。
- `LABELHUB_AUTH_SERVICE_LOGIN_TOKEN` 与 `LABELHUB_AGENT_SERVICE_LOGIN_TOKEN` 必须完全一致，否则 Agent 无法登录后端领取 AI 审核任务。
- 生产环境应关闭或重新配置演示账号，不要沿用 README 中的默认密码。

生成强随机服务令牌的 PowerShell 示例：

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

### 4.3 初始化数据库

当前项目没有引入 Flyway 运行时依赖，需要手动按版本顺序执行 `backend/src/main/resources/db/migration/` 下的 SQL。`V1__init_labelhub_schema.sql` 会创建并切换到 `labelhub` 数据库。

Windows PowerShell 示例：

```powershell
Get-ChildItem backend\src\main\resources\db\migration\V*.sql |
  Sort-Object { [int]($_.BaseName -replace '^V(\d+)__.*$', '$1') } |
  ForEach-Object { cmd /c "mysql -uroot -p < `"$($_.FullName)`"" }
```

Linux / macOS 示例：

```bash
for f in $(ls -v backend/src/main/resources/db/migration/V*.sql); do
  mysql -uroot -p < "$f"
done
```

说明：

- 使用 `-p` 让 MySQL 在终端提示输入密码，避免把密码写进命令历史。
- 新增迁移时只需要把 SQL 放入迁移目录，并保持 `V数字__说明.sql` 命名。
- 后端启动时 `DemoUserInitializer` 会继续 upsert 当前版本需要的演示账号。

### 4.4 启动顺序

完整联调建议顺序：

```text
MySQL -> Redis -> 后端 -> Agent -> 前端
```

如果暂时不验证 AI 预审，可以跳过 Agent。

### 4.5 启动后端

PowerShell：

```powershell
cd backend
$env:LABELHUB_DB_PASSWORD='数据库密码'
$env:LABELHUB_MODEL_CONFIG_SECRET='labelhub-local-dev-secret-2026'
$env:LABELHUB_AUTH_TURNSTILE_SECRET_KEY='你的 Cloudflare Turnstile secret key'
$env:LABELHUB_AUTH_SERVICE_LOGIN_TOKEN='同一个强随机服务令牌'
.\mvnw.cmd spring-boot:run
```

cmd：

```cmd
cd backend
set LABELHUB_DB_PASSWORD=123456
set LABELHUB_MODEL_CONFIG_SECRET=labelhub-local-dev-secret-2026
set LABELHUB_AUTH_TURNSTILE_SECRET_KEY=你的 Cloudflare Turnstile secret key
set LABELHUB_AUTH_SERVICE_LOGIN_TOKEN=同一个强随机服务令牌
mvnw.cmd spring-boot:run
```

启动成功日志通常包含：

```text
Tomcat started on port 8080
Started LabelHubBackendApplication
```

如果 `8080` 被占用，可以设置 `LABELHUB_BACKEND_PORT` 使用其它端口；同时需要同步调整前端 Vite proxy 的 `/api` target。

说明：

- 本地开发如果不配置 Turnstile 变量，会使用代码中的 Cloudflare 官方测试 key；生产环境必须覆盖为真实 key。
- `LABELHUB_AUTH_TURNSTILE_SECRET_KEY` 是后端私密配置，只在后端启动时设置。
- `LABELHUB_AUTH_SERVICE_LOGIN_TOKEN` 是后端校验 Agent 机器登录的共享令牌，必须和 Agent 侧 `LABELHUB_AGENT_SERVICE_LOGIN_TOKEN` 一致。

### 4.6 启动 Agent

已有 Web 端 active 模型配置时：

```powershell
cd agent
$env:LABELHUB_BACKEND_BASE_URL='http://localhost:8080'
$env:LABELHUB_AGENT_USERNAME='system_agent'
$env:LABELHUB_AGENT_PASSWORD='agent123'
$env:LABELHUB_AGENT_ROLE='system_agent'
$env:LABELHUB_AGENT_SERVICE_LOGIN_TOKEN='同一个强随机服务令牌'
$env:LABELHUB_AGENT_CONCURRENCY='3'
.\mvnw.cmd spring-boot:run
```

没有 Web 端 active 模型配置时，额外提供兜底模型变量：

```powershell
cd agent
$env:LABELHUB_BACKEND_BASE_URL='http://localhost:8080'
$env:LABELHUB_AGENT_USERNAME='system_agent'
$env:LABELHUB_AGENT_PASSWORD='agent123'
$env:LABELHUB_AGENT_ROLE='system_agent'
$env:LABELHUB_AGENT_SERVICE_LOGIN_TOKEN='同一个强随机服务令牌'
$env:LABELHUB_LLM_BASE_URL='https://www.pqapi.store/v1'
$env:LABELHUB_LLM_API_KEY='你的 API Key'
$env:LABELHUB_LLM_MODEL='gpt-5.5'
.\mvnw.cmd spring-boot:run
```

启动成功后可在后端日志和 AI Reviewer 页面观察 Job claim / complete / fail 状态变化。

Agent 说明：

- `LABELHUB_AGENT_SERVICE_LOGIN_TOKEN` 在 Agent 启动时读取。
- 该值必须和后端启动时的 `LABELHUB_AUTH_SERVICE_LOGIN_TOKEN` 完全一致。
- 该令牌只用于 `system_agent` 机器登录绕过浏览器 Turnstile；普通 Web 登录、注册和演示账号登录仍需要 Turnstile。

### 4.7 启动前端

首次安装依赖：

```powershell
cd frontend
npm install
```

开发模式：

```powershell
cd frontend
$env:VITE_TURNSTILE_SITE_KEY='你的 Cloudflare Turnstile site key'
npm run dev
```

构建与预览：

```powershell
cd frontend
$env:VITE_TURNSTILE_SITE_KEY='你的 Cloudflare Turnstile site key'
npm run build
npm run preview
```

Vite 开发服务默认把 `/api` 代理到后端 `http://127.0.0.1:8080`。

前端 Turnstile 说明：

- `VITE_TURNSTILE_SITE_KEY` 在 Vite dev server 启动或 `npm run build` 构建时读取。
- 构建产物生成后再修改服务器环境变量不会改变已打包进静态资源的 site key。
- 生产环境更换 Cloudflare Turnstile site key 后，需要重新构建并重新发布前端静态资源。
- site key 是公开值；真正的 secret key 只能配置在后端 `LABELHUB_AUTH_TURNSTILE_SECRET_KEY`。

### 4.8 演示账号

后端默认启用演示账号，可用下面账号登录：

```text
owner / owner123
labeler / labeler123
reviewer / reviewer123
ai_reviewer / ai_reviewer123
system_agent / agent123
demo / demo123
```

`demo` 账号拥有多角色，适合快速切换前端角色视角。`system_agent` 主要供 Agent 使用，不建议作为普通 Web 用户使用。

## 5. 前端入口

公开入口：

```text
/          公开首页
/docs      文档入口页
/about     README 渲染页
/login     登录与注册页
```

Owner 入口：

```text
/owner/tasks              任务管理
/owner/templates          模板列表
/owner/templates/designer 模板设计器
/owner/datasets           数据集管理
/owner/ai-review          AI 预审规则与队列
/owner/review             审核管理
/owner/dashboard          数据看板
/owner/export             导出中心
/owner/settings/model     模型配置
/owner/settings/appearance 外观设置
```

Labeler 入口：

```text
/labeler                    标注员首页
/labeler/market             任务市场
/labeler/my-tasks           我的任务
/labeler/drafts             草稿箱
/labeler/returned           打回项
/labeler/answer/:assignmentId 答题页
/labeler/settings/appearance 外观设置
```

Reviewer 与 AI Reviewer 入口：

```text
/reviewer                     审核员首页
/reviewer/ai                  AI 审核任务
/reviewer/ai/:taskId          审核工作台
/reviewer/disputes            争议样本
/reviewer/settings/appearance 外观设置
/ai-reviewer                  AI Reviewer 仪表盘
/ai-reviewer/queue            预审队列
/ai-reviewer/settings/model   模型配置
/ai-reviewer/settings/appearance 外观设置
```

## 6. API 与文档

### 6.1 接口入口

本地后端启动后访问：

```text
Swagger UI: http://127.0.0.1:8080/swagger-ui/index.html
OpenAPI JSON: http://127.0.0.1:8080/v3/api-docs
```

接口文档维护在：

```text
接口文档.md
frontend/src/api/
frontend/src/types/
backend/src/main/java/com/labelhub/backend/
agent/src/main/java/com/labelhub/agent/
```

### 6.2 接口分组

README 不再内联完整 API 清单，避免和代码重复维护。当前主要接口分组如下：

- 认证与用户：登录、注册、刷新会话、退出、当前用户、审核员邀请。
- Owner：任务、模板、数据集、AI 规则、审核管理、看板、导出和模型配置。
- Labeler：任务市场、我的任务、草稿、提交、打回项、问题上报和概览。
- Reviewer：审核任务、工作台详情、人工裁决、争议样本和概览。
- AI Agent：Job 领取、完成、失败、运行时配置和健康检查。
- 文件导出：导出任务、下载、下载确认和文件元数据。

### 6.3 鉴权约定

后端使用 Redis token 会话：

- 前端登录后保存 token，并在请求中携带认证信息。
- 后端通过认证过滤器解析 token，生成当前用户上下文。
- 多角色用户可在前端切换当前角色，访问不同角色下的页面和接口。
- 生产环境需要配置更严格的 token TTL、HTTPS、CORS 和演示账号策略。

## 7. 部署说明

### 7.1 当前状态

当前仓库已经有 `infra/` 目录作为部署配置入口，但 `infra/docker-compose.yml` 仍是占位文件。因此本地开发以手动启动 MySQL、Redis、后端、Agent 和前端为准。

如果要通过 Docker 部署到服务器，需要补齐：

- MySQL 服务、数据卷、初始化迁移脚本执行策略。
- Redis 服务、密码和持久化策略。
- 后端镜像、环境变量、导出文件卷和健康检查。
- Agent 镜像、并发参数、后端地址和模型配置读取策略。
- 前端构建镜像和 Nginx 静态资源服务。
- Nginx 反向代理、HTTPS 证书、上传大小、超时、缓存和 WebSocket/长请求策略。

### 7.2 子路径部署

如果部署访问地址为 `https://www.scu-gpt.top/labelhub`，需要同步处理：

- Vite 构建 `base`。
- React Router basename。
- 前端 API base URL。
- Nginx `location /labelhub/` 静态资源回退。
- Nginx `/labelhub/api/` 到后端 `/api/` 的反向代理。
- 后端 CORS 与公开地址配置。

这些配置目前不能只靠 README 完成，需要在代码和 `infra/` 中落地后再作为生产部署方案使用。

### 7.3 生产安全提醒

生产环境至少需要处理：

- 禁用或重置全部演示账号默认密码。
- 使用足够随机且稳定的 `LABELHUB_MODEL_CONFIG_SECRET`。
- 使用真实 `VITE_TURNSTILE_SITE_KEY` 重新构建前端静态资源。
- 使用真实 `LABELHUB_AUTH_TURNSTILE_SECRET_KEY` 启动后端。
- 使用一致的强随机 `LABELHUB_AUTH_SERVICE_LOGIN_TOKEN` 和 `LABELHUB_AGENT_SERVICE_LOGIN_TOKEN` 启动后端与 Agent。
- 不把数据库密码、Redis 密码和 LLM API Key 写入仓库。
- 给 MySQL、Redis、导出文件和 Nginx 证书配置持久化备份。
- 限制服务器安全组和防火墙，只暴露必要端口。
- 配置 HTTPS，并避免通过明文 HTTP 传输 token。

## 8. 开发检查

常用检查命令：

```powershell
cd frontend
npm run build
```

```powershell
cd backend
.\mvnw.cmd test
```

```powershell
cd agent
.\mvnw.cmd test
```

```powershell
git diff --check
```

说明：

- 前端 `npm run build` 会先执行 TypeScript project build，再执行 Vite build。
- 后端和 Agent 当前以 Maven wrapper 为入口。
- 文档或样式小改动至少运行 `git diff --check`。
- 涉及权限、状态机、任务分配、审核或导出时，应额外走一遍端到端手动流程。

## 9. 协作约定

本项目按阶段推进，文档需要和实现同步：

- 新增或调整实现前，先追加 `阶段计划.md`。
- 完成实现后，追加 `阶段实现.md`。
- 新增、删除或调整接口时，同步更新 `接口文档.md`。
- 发现暂不处理的问题，记录到 `问题点归档.md`。
- 保持 README 作为入口文档，避免把完整 API、完整迁移历史和每个页面细节都堆进 README。

建议下一步补齐：

- `docs/architecture.md`：沉淀系统架构、状态流转和模块边界。
- `docs/api-docs.md`：从 Swagger 和前端调用角度整理核心接口。
- `infra/docker-compose.yml`：按目标服务器补齐可执行的 Docker 部署编排。
