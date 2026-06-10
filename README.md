# LabelHub 数据标注平台

LabelHub 是一个面向数据标注、AI 预审和人工审核协作的 Web 平台。项目包含 React 前端、Spring Boot 后端、独立 AI Review Agent、MySQL 迁移脚本和本地演示账号，适合演示从任务创建到标注、预审、复核和导出的完整流程。

详细接口以 Swagger UI、源码和 [submission/API文档/接口文档.md](submission/API文档/接口文档.md) 为准。

## 核心流程

```text
Owner 创建任务、模板和数据集
  -> Labeler 领取任务并提交标注
  -> 后端创建 AI Review Job
  -> Agent 调用 LLM 完成预审
  -> Reviewer 参考 AI 结果进行人工审核
  -> Owner 查看进度并导出结果
```

## 主要能力

1. Owner 工作台

   - 任务管理、模板设计、数据集导入、AI 预审规则、审核管理、数据看板和结果导出。
2. Labeler 工作台

   - 任务市场、我的任务、结构化答题、草稿保存、批量提交、打回返工和问题上报。
3. Reviewer 工作台

   - AI 审核队列、三栏审核工作台、人工裁决、争议样本和审核时间线。
4. AI Review Agent

   - 登录后端、领取预审 Job、调用 OpenAI-compatible LLM，并把结构化审核结果写回后端。

## 技术栈

- 前端：React、TypeScript、Vite、Ant Design、React Router、Formily、Recharts。
- 后端：Java 21、Spring Boot、Spring Security、Spring JDBC、Spring Data Redis、Springdoc OpenAPI。
- Agent：Spring Boot Worker，负责 AI 预审任务轮询、LLM 调用和结果回写。
- 存储：MySQL 8.0+ 保存业务数据，Redis 6+ 保存登录 token，会话导出文件默认落本地目录。

## 目录结构

```text
frontend/    前端应用
backend/     后端 API 服务
agent/       AI Review Agent
infra/       部署配置入口，目前 docker-compose 仍为占位
datasets/    示例数据
docs/        补充文档
image/       项目图片资源
submission/  比赛提交材料、接口文档、阶段记录和演示说明
```

## 本地启动

### 1. 环境要求

```text
Node.js 22+
npm 10+
Java 21+
MySQL 8.0+
Redis 6+
```

### 2. 初始化数据库

按版本顺序执行 `backend/src/main/resources/db/migration/` 下的 SQL。`V1__init_labelhub_schema.sql` 会创建并切换到 `labelhub` 数据库。

PowerShell 示例：

```powershell
Get-ChildItem backend\src\main\resources\db\migration\V*.sql |
  Sort-Object { [int]($_.BaseName -replace '^V(\d+)__.*$', '$1') } |
  ForEach-Object { cmd /c "mysql -uroot -p < `"$($_.FullName)`"" }
```

### 3. 启动后端

```powershell
cd backend
$env:LABELHUB_DB_PASSWORD='你的数据库密码'
$env:LABELHUB_MODEL_CONFIG_SECRET='labelhub-local-dev-secret-2026'
.\mvnw.cmd spring-boot:run
```

默认地址：

```text
后端 API: http://127.0.0.1:8080
Swagger UI: http://127.0.0.1:8080/swagger-ui/index.html
OpenAPI JSON: http://127.0.0.1:8080/v3/api-docs
```

### 4. 启动 Agent

只体验普通标注流程时可以跳过 Agent。需要验证 AI 预审时再启动：

```powershell
cd agent
$env:LABELHUB_BACKEND_BASE_URL='http://localhost:8080'
$env:LABELHUB_AGENT_USERNAME='system_agent'
$env:LABELHUB_AGENT_PASSWORD='agent123'
$env:LABELHUB_AGENT_ROLE='system_agent'
$env:LABELHUB_AGENT_SERVICE_LOGIN_TOKEN='同一个强随机服务令牌'
$env:LABELHUB_LLM_BASE_URL='你的 OpenAI-compatible Base URL'
$env:LABELHUB_LLM_API_KEY='你的 API Key'
$env:LABELHUB_LLM_MODEL='你的模型名'
.\mvnw.cmd spring-boot:run
```

后端如启用 `LABELHUB_AUTH_SERVICE_LOGIN_TOKEN`，该值必须和 Agent 的 `LABELHUB_AGENT_SERVICE_LOGIN_TOKEN` 一致。

### 5. 启动前端

```powershell
cd frontend
npm install
npm run dev
```

默认地址：

```text
前端: http://localhost:5173
Vite preview: http://localhost:4173
```

## 演示账号

后端默认启用演示账号：

```text
labelhub_owner / abelhub_owner
labeler1 / labeler1123
reviewer2 / reviewer2123
ai_reviewer / ai_reviewer123
```

`demo` 账号拥有多角色，适合快速切换前端视角。`system_agent` 主要供 Agent 使用，不建议作为普通 Web 用户登录。

## 常用入口

```text
/                         公开首页
/docs                     文档入口
/about                    README 渲染页
/login                    登录与注册
/owner/tasks              Owner 任务管理
/owner/templates          Owner 模板管理
/owner/datasets           Owner 数据集管理
/owner/ai-review          Owner AI 预审规则
/owner/dashboard          Owner 数据看板
/labeler/market           Labeler 任务市场
/labeler/my-tasks         Labeler 我的任务
/reviewer/ai              Reviewer AI 审核任务
/reviewer/disputes        Reviewer 争议样本
/ai-reviewer              AI Reviewer 仪表盘
/ai-reviewer/queue        AI Reviewer 预审队列
```

## 常用检查

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

## 文档入口

- [submission/README.md](submission/README.md)：比赛提交说明。
- [submission/演示说明.md](submission/演示说明.md)：演示流程和注意事项。
- [submission/API文档/接口文档.md](submission/API文档/接口文档.md)：接口维护记录。
- [submission/相关文档/阶段计划.md](submission/相关文档/阶段计划.md)：阶段计划。
- [submission/相关文档/阶段实现.md](submission/相关文档/阶段实现.md)：阶段实现记录。
- [submission/相关文档/问题点归档.md](submission/相关文档/问题点归档.md)：问题归档。

## 注意事项

- `infra/docker-compose.yml` 目前仍是占位文件，本地开发以手动启动 MySQL、Redis、后端、Agent 和前端为准。
- 生产环境必须重置演示账号密码，配置真实 Turnstile key、数据库密码、Redis 密码和 LLM API Key。
- `LABELHUB_MODEL_CONFIG_SECRET` 首次保存模型配置前必须设置，保存后不要随意更换。
- 不要把数据库密码、Redis 密码、LLM API Key 或 Turnstile secret key 提交到 Git。
