# Label Hub 数据标注平台

Label Hub 是一个面向数据标注、审核协作和 AI 预审流程的 Web 平台。当前仓库包含公开首页、React 前端、Spring Boot 后端、独立 AI Review Agent、MySQL 迁移脚本和本地演示账号，已经覆盖 Owner 建任务与导入数据、Labeler 领取和提交标注、AI Agent 预审、Reviewer 人工审核、Owner 审核管理、导出与仪表盘等本地联调闭环。

## 当前状态

已实现或已接入的主要能力：

1. 公开页与认证
   - 公开首页 `/`、文档占位页 `/docs`、关于页 `/about`。
   - 关于页直接渲染根目录 `README.md`，支持目录定位。
   - 登录、注册、退出、刷新会话和多角色切换。
   - Redis token 会话，后端启动时可自动 upsert 演示账号。

2. Owner 工作台
   - 任务管理：创建、编辑、删除、发布、暂停、恢复、状态筛选。
   - 任务范围：按题目范围固定任务题集，支持标注员和审核员按人题量配置。
   - 模板搭建：Schema 草稿、校验、发布、撤回和删除。
   - 数据集管理：创建、导入、追加导入、预览和删除，支持 JSON、JSONL、CSV 和基础 XLSX。
   - AI 预审规则：规则配置、启停、Job 队列、结果查看、重试、取消和批量删除。
   - 审核管理：任务审核概览、审核员负载、审核日志和题目时间线。
   - 数据看板和导出：Owner 看板、导出任务、导出下载与下载确认。
   - 设置：外观主题和 AI 模型配置。

3. Labeler 工作台
   - 标注员首页概览、任务市场、我的任务、草稿箱、打回项。
   - 任务领取写入真实 `assignments`。
   - 答题页支持 Schema 渲染、草稿保存、单题/批量提交、问题上报和 LLM 助手。
   - 最后一题统一提交后可创建待处理 AI Review Job。

4. Reviewer 工作台
   - Reviewer 首页概览、AI 审核任务列表、三栏审核工作台。
   - 人工审核裁决、AI 预审结果查看、审核时间线。
   - 争议样本页和终审处理。
   - 报告页入口保留。

5. AI Reviewer 与 Agent
   - AI Reviewer 仪表盘、Job 队列、预审队列和模型设置。
   - 后端提供 AI Review Job claim / complete / fail / retry / cancel API。
   - `agent/` 是独立 Spring Boot Worker，只通过后端 API 登录、领取 Job、调用 LLM、回写结果。
   - Web 端模型配置优先于 Agent 终端兜底环境变量。

仍需注意的边界：

- `infra/docker-compose.yml` 仍是占位文件，本地联调请按手动方式启动 MySQL、Redis、后端、Agent 和前端。
- README 是入口文档，接口细节以 `接口文档.md`、Swagger UI 和代码为准。
- 本地演示账号、默认密码和模型 API Key 只适合开发环境，不应直接用于生产。

## 技术栈

前端：

- React 18
- TypeScript 6
- Vite 8
- Ant Design 6
- React Router 7
- Formily / JSON Schema
- dnd-kit
- Recharts
- React Markdown / remark-gfm

后端：

- Java 21
- Spring Boot 3.4.5
- Spring Web / Security / JDBC / Validation
- Spring Data Redis
- MySQL Connector/J
- Apache POI
- Springdoc OpenAPI

Agent：

- Java 21
- Spring Boot 3.4.5
- Spring Web / Validation / Actuator
- OpenAI-compatible Responses API 调用链路

存储与中间件：

- MySQL 8.0+
- Redis 6+

## 目录结构

```text
agent/       独立 AI Review Worker
backend/     Spring Boot 后端 API
frontend/    React + Vite 前端
infra/       基础设施编排占位
datasets/    数据样例或外部数据目录
docs/        文档资料
image/       项目图片资源
submission/  比赛提交相关材料
```

## 环境要求

建议本地环境：

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
```

## 常用环境变量

后端：

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
LABELHUB_DEMO_OWNER_PASSWORD=owner123
LABELHUB_DEMO_LABELER_PASSWORD=labeler123
LABELHUB_DEMO_REVIEWER_PASSWORD=reviewer123
LABELHUB_DEMO_AI_REVIEWER_PASSWORD=ai_reviewer123
LABELHUB_DEMO_SYSTEM_AGENT_PASSWORD=agent123
LABELHUB_DEMO_ALL_ROLES_PASSWORD=demo123
LABELHUB_MODEL_CONFIG_SECRET=固定且足够随机的本地模型配置加密密钥
LABELHUB_EXPORT_STORAGE_DIR=data/exports
```

Agent：

```text
LABELHUB_AGENT_PORT=8091
LABELHUB_BACKEND_BASE_URL=http://localhost:8080
LABELHUB_AGENT_USERNAME=system_agent
LABELHUB_AGENT_PASSWORD=agent123
LABELHUB_AGENT_ROLE=system_agent
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

注意：

- `LABELHUB_MODEL_CONFIG_SECRET` 用于加密 Web 端保存的模型 API Key。首次保存模型配置前必须设置；保存后必须保持同一个值，否则旧 API Key 无法解密。
- `LABELHUB_LLM_API_KEY` 不要写入仓库文件。
- Web 端已有 active 模型配置时，Agent 会优先读取后端运行时配置；终端里的 `LABELHUB_LLM_*` 只作为兜底。

## 数据库初始化

当前项目没有引入 Flyway 运行时依赖，需要手动按版本顺序执行迁移 SQL。`V1__init_labelhub_schema.sql` 会创建并切换到 `labelhub` 数据库。

PowerShell / cmd 示例：

```powershell
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V1__init_labelhub_schema.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V2__seed_demo_auth_users.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V3__allow_unbound_datasets.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V4__support_schema_designer_backend.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V5__soft_delete_schema_versions.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V6__extend_audit_logs_for_state_machine.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V7__soft_delete_tasks_and_void_annotations.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V8__scope_assignment_unique_key_by_task.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V9__annotation_schema_snapshot.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V10__ai_review_rules_agent_runtime.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V11__ai_review_job_run_token.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V12__ai_model_configs.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V13__assignment_issues.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V14__ai_review_score_scale_100.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V15__allow_reclaim_released_assignments.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V16__assignment_rework_deadline.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V17__ai_model_config_worker_concurrency.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V18__export_jobs_file_metadata.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V19__export_jobs_downloaded_at.sql"
cmd /c "mysql -uroot -p123456 < backend\src\main\resources\db\migration\V20__task_scope_and_review_allocations.sql"
```

把命令中的 `123456` 换成你的 MySQL root 密码。

说明：

- `V2` SQL 是早期演示账号种子。
- 后端启动时 `DemoUserInitializer` 会继续 upsert 当前版本需要的演示账号，包括 `ai_reviewer` 和 `system_agent`。
- 如果修改了演示账号环境变量，需要重启后端服务才会写入当前数据库。

## 启动顺序

本地完整联调建议顺序：

```text
MySQL -> Redis -> 后端 -> Agent -> 前端
```

如果暂时不验证 AI 预审，可以跳过 Agent。

## 启动后端

PowerShell：

```powershell
cd backend
$env:LABELHUB_DB_PASSWORD='数据库密码'
$env:LABELHUB_MODEL_CONFIG_SECRET='labelhub-local-dev-secret-2026'
.\mvnw.cmd spring-boot:run
```

cmd：

```cmd
cd backend
set LABELHUB_DB_PASSWORD=123456
set LABELHUB_MODEL_CONFIG_SECRET=labelhub-local-dev-secret-2026
mvnw.cmd spring-boot:run
```

启动成功日志通常包含：

```text
Tomcat started on port 8080
Started LabelHubBackendApplication
```

如果提示 `Port 8080 was already in use`，停止占用端口的旧进程，或设置 `LABELHUB_BACKEND_PORT` 使用其它端口。修改后端端口时，需要同步调整 `frontend/vite.config.ts` 的 `/api` proxy target。

## 启动 Agent

方式 A：已经在 Web 端保存并激活模型配置时，只需要后端连接和登录变量：

```powershell
cd agent
$env:LABELHUB_BACKEND_BASE_URL='http://localhost:8080'
$env:LABELHUB_AGENT_USERNAME='system_agent'
$env:LABELHUB_AGENT_PASSWORD='agent123'
$env:LABELHUB_AGENT_ROLE='system_agent'
$env:LABELHUB_AGENT_CONCURRENCY='3'
.\mvnw.cmd spring-boot:run
```

方式 B：没有 Web 端 active 模型配置时，额外提供兜底模型变量：

```powershell
cd agent
$env:LABELHUB_BACKEND_BASE_URL='http://localhost:8080'
$env:LABELHUB_AGENT_USERNAME='system_agent'
$env:LABELHUB_AGENT_PASSWORD='agent123'
$env:LABELHUB_AGENT_ROLE='system_agent'
$env:LABELHUB_AGENT_CONCURRENCY='3'
$env:LABELHUB_LLM_BASE_URL='https://www.pqapi.store/v1'
$env:LABELHUB_LLM_API_KEY='你的 API Key'
$env:LABELHUB_LLM_MODEL='gpt-5.5'
$env:LABELHUB_LLM_REASONING_EFFORT='high'
$env:LABELHUB_LLM_WIRE_API='responses'
.\mvnw.cmd spring-boot:run
```

Agent 注意事项：

- Agent 不直连数据库，只调用后端 API。
- 如果暂时没有 `pending` AI Review Job，Agent 会保持轮询。
- Labeler 最后一题统一提交成功后，会创建待处理 Job；Agent 才会领取和处理。
- 修改 Web 端模型配置里的 Agent 并发数后，需要重启 Agent 才会生效。

## 启动前端

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

## 演示账号

推荐使用多角色账号：

```text
账号: demo
密码: demo123
角色: owner + labeler + reviewer + ai_reviewer
用途: 登录后可在顶栏切换多个工作台
```

单角色和系统账号：

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

4. AI Reviewer Demo
   - 用户名: ai_reviewer
   - 密码: ai_reviewer123
   - 角色: ai_reviewer

5. System Agent
   - 用户名: system_agent
   - 密码: agent123
   - 角色: system_agent
   - 用途: Agent 登录后端领取 AI Review Job
```

登录页提供演示账号快捷按钮。演示账号由 SQL 种子和后端 `DemoUserInitializer` 共同保证可用。

## 前端常用入口

公开页：

```text
/
/docs
/about
/login
/login#signup
```

Owner：

```text
/owner/tasks
/owner/templates
/owner/templates/designer
/owner/datasets
/owner/ai-review
/owner/review
/owner/dashboard
/owner/export
/owner/settings/model
/owner/settings/appearance
```

Labeler：

```text
/labeler
/labeler/market
/labeler/my-tasks
/labeler/drafts
/labeler/returned
/labeler/answer/:assignmentId
/labeler/settings/appearance
```

Reviewer：

```text
/reviewer
/reviewer/ai
/reviewer/ai/:taskId
/reviewer/disputes
/reviewer/reports
/reviewer/settings/appearance
```

AI Reviewer：

```text
/ai-reviewer
/ai-reviewer/jobs
/ai-reviewer/queue
/ai-reviewer/settings/model
/ai-reviewer/settings/appearance
```

## 后端主要 API

认证：

```text
POST /api/auth/login
POST /api/auth/register
POST /api/auth/logout
GET  /api/auth/me
```

任务、数据集、模板：

```text
POST   /api/tasks
PUT    /api/tasks/{taskId}
GET    /api/tasks
GET    /api/tasks/{taskId}
DELETE /api/tasks/{taskId}
PUT    /api/tasks/{taskId}/state
GET    /api/tasks/assignable-labelers
GET    /api/tasks/assignable-reviewers
GET    /api/market/tasks
POST   /api/tasks/{taskId}/claim
GET    /api/assignments/mine

GET    /api/datasets
POST   /api/datasets
POST   /api/datasets/import
POST   /api/datasets/{datasetId}/items/import
GET    /api/datasets/{datasetId}/items
GET    /api/datasets/{datasetId}/item-options
DELETE /api/datasets/{datasetId}

GET    /api/schemas
GET    /api/schemas/{versionId}
POST   /api/schemas/draft
PUT    /api/schemas/{versionId}/draft
POST   /api/schemas/{versionId}/publish
POST   /api/schemas/{versionId}/withdraw
DELETE /api/schemas/{versionId}
```

Labeler：

```text
GET    /api/labeler/overview
GET    /api/assignments/{assignmentId}/item
GET    /api/assignments/{assignmentId}/draft
PUT    /api/assignments/{assignmentId}/draft
DELETE /api/assignments/{assignmentId}/draft
GET    /api/labeler/drafts
POST   /api/assignments/{assignmentId}/submit
POST   /api/tasks/{taskId}/assignments/submit
POST   /api/assignments/{assignmentId}/issues
GET    /api/labeler/returned-items
POST   /api/labeler/assignments/{assignmentId}/assistant
```

AI Review / AI Reviewer：

```text
GET    /api/ai-review/rules
POST   /api/ai-review/rules
GET    /api/ai-review/jobs
POST   /api/ai-review/jobs/claim-next
POST   /api/ai-review/jobs/{jobId}/complete
POST   /api/ai-review/jobs/{jobId}/fail
POST   /api/ai-review/jobs/{jobId}/cancel
POST   /api/ai-review/jobs/{jobId}/retry
POST   /api/ai-review/jobs/batch-delete
GET    /api/ai-review/jobs/{jobId}/timeline
GET    /api/ai-review/results/{annotationId}
GET    /api/ai-review/dashboard/kpi
GET    /api/ai-review/dashboard/decisions
GET    /api/ai-review/dashboard/trend
GET    /api/ai-review/dashboard/tasks
GET    /api/ai-review/model-config
PUT    /api/ai-review/model-config
GET    /api/ai-review/model-configs
POST   /api/ai-review/model-configs
PUT    /api/ai-review/model-configs/{configId}
DELETE /api/ai-review/model-configs/{configId}
POST   /api/ai-review/model-configs/{configId}/activate
```

Reviewer / Owner Review / Dashboard / Export：

```text
GET  /api/reviewer/overview
GET  /api/reviewer/batches
POST /api/reviewer/batches/{batchId}/claim
GET  /api/reviewer/batches/{batchId}/annotations
GET  /api/reviewer/ai-review/tasks
GET  /api/reviewer/ai-review/tasks/{taskId}/annotations
POST /api/reviewer/annotations/{annotationId}/decision
GET  /api/reviewer/disputes
GET  /api/reviewer/disputes/{disputeId}
POST /api/reviewer/disputes/{disputeId}/resolve

GET  /api/reviews/overview
GET  /api/reviews/tasks
GET  /api/reviews/reviewers
GET  /api/reviews/tasks/{taskId}/annotations
GET  /api/reviews/audit-log
GET  /api/reviews/audit-log/{logId}/item-timeline

GET  /api/dashboard/overview
GET  /api/dashboard/task-progress
GET  /api/dashboard/review-distribution
GET  /api/dashboard/labeler-performance
GET  /api/dashboard/submission-timeline
GET  /api/dashboard/recent-activities
GET  /api/dashboard/role-breakdown
GET  /api/dashboard/disputes
GET  /api/dashboard/issue-feedback

POST /api/exports
GET  /api/exports
GET  /api/exports/overview
GET  /api/exports/tasks/{taskId}/options
GET  /api/exports/{exportId}/download
POST /api/exports/{exportId}/download/confirm
POST /api/exports/{exportId}/start
POST /api/exports/{exportId}/complete
POST /api/exports/{exportId}/fail
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

前端内置了部分样例文件，可用于数据导入和任务演示：

```text
frontend/public/sample-datasets/qa_quality.json
frontend/public/sample-datasets/qa_quality.jsonl
frontend/public/sample-datasets/preference_compare.json
frontend/public/sample-datasets/preference_compare.jsonl
frontend/public/sample-datasets/market-tasks.json
```

数据集导入接口会写入 `items.raw_payload`，并保留 `media_type`、`media_url`、`content_markdown` 等字段用于多模态展示。

## 构建检查

后端构建：

```powershell
cd backend
.\mvnw.cmd -q -DskipTests package
```

Agent 构建：

```powershell
cd agent
.\mvnw.cmd -q -DskipTests package
```

前端构建：

```powershell
cd frontend
npm run build
```

前端构建可能提示 chunk 体积超过 500 kB，这是当前依赖和页面聚合带来的构建告警，不影响本地功能运行。

## 常见问题

1. 登录失败或刷新后掉线
   - 确认 Redis 已启动。
   - token 存在 Redis 中，重启或清空 Redis 后需要重新登录。

2. `demo / demo123` 不存在
   - 确认已经执行基础迁移，或重启后端让 `DemoUserInitializer` 自动 upsert。
   - 确认 `LABELHUB_DEMO_USERS_ENABLED` 没有被设置为 `false`。

3. AI Reviewer 或 Agent 账号不存在
   - 确认后端已用当前代码启动过一次。
   - `DemoUserInitializer` 会自动写入 `ai_reviewer` 和 `system_agent`。

4. 前端请求 `/api` 失败
   - 确认后端运行在 `http://127.0.0.1:8080`。
   - 如果改了后端端口，同步修改 `frontend/vite.config.ts` 的 proxy target。

5. Web 端保存模型配置失败
   - 确认后端启动时设置了 `LABELHUB_MODEL_CONFIG_SECRET`。
   - 已保存过 API Key 后，后续启动必须继续使用同一个密钥。

6. Agent 没有处理日志
   - 确认 Agent 已登录成功。
   - 确认存在 `pending` AI Review Job。
   - 确认 Web 端模型配置已激活，或 Agent 终端已提供 `LABELHUB_LLM_API_KEY`。

7. “我的任务”为空
   - 确认当前是 Labeler 角色。
   - 确认任务已发布，且任务范围内仍有当前用户可领取或已领取的题目。

## 外部链接

- 项目仓库：<https://github.com/Qiang0129/ByteDance_competition>
- Codex：<https://openai.com/zh-Hans-CN/codex/>
- Claude：<https://claude.com/>
- 工信部备案查询：<https://beian.miit.gov.cn/#/Integrated/recordQuery>
