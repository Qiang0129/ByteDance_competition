# LabelHub 数据标注平台提交说明

本文档是 LabelHub 比赛提交包的入口说明，面向已经部署完成的生产环境。评审、验收人员和后续运维人员可以先阅读本文，再按需查看 `API文档/`、`相关文档/` 和线上系统。

## 1. 项目简介

LabelHub 是一个面向数据标注项目的协作平台，目标是把任务创建、数据导入、人工标注、AI 预审、人工复核、质量看板和结果导出统一到同一套 Web 工作流中。系统按角色拆分职责，降低标注项目从任务发布到结果交付之间的信息断层。

当前提交版本已经完成生产部署，具备以下主流程：

1. Owner 创建数据集、标注模板、任务、查看标注结果及导出、查看审核结果/日志、创建审核人员、负责人账号（邀请制）。
2. Owner 发布任务，并配置数据范围、奖励规则、标注员、审核员参与范围、agent审核规则、模型配置。
3. Labeler 在任务市场领取任务，按 Schema 完成结构化标注，查看个人贡献，对打回项进行修改重新提交。
4. 后端为已提交标注创建 AI Review Job。
5. 独立 Agent 登录后端、领取 Job、查看审核日志、调用 OpenAI-compatible LLM，并写回 AI 预审结果。
6. Reviewer 在三栏审核工作台查看样本、标注答案和 AI 建议，完成通过、打回或争议裁决。
7. Owner 在看板查看进度、质量、风险和审核状态，并导出交付结果。

## 2. 生产环境信息

1. 访问地址：

   - 前端入口：`https://www.scu-gpt.top/labelhub/`
   - 登录入口：`https://www.scu-gpt.top/labelhub/login`
   - 注册入口：`https://www.scu-gpt.top/labelhub/login#signup`
2. 部署状态：

   - 当前版本已经部署到服务器，并通过宿主机 Nginx 的 `/labelhub/` 子路径对外提供 HTTPS 访问。
   - 前端静态资源通过容器内 Nginx 提供，宿主机 Nginx 负责 HTTPS、子路径转发和反向代理。
   - 后端 API 通过 `/labelhub/api/` 反向代理到 Spring Boot 后端服务。
   - MySQL、Redis、后端、Agent、前端静态服务均由 Docker Compose 编排。
3. 账号说明：

   - 生产环境已关闭或禁用 README 中用于本地开发的默认演示账号。
   - 正式 Owner 账号由系统初始化、reviewer账号由Owner 邀请注册产生、labeler账号注册产生。
   - 本提交包不写入生产密码、数据库口令、Redis 口令、Turnstile secret key、LLM API Key 等敏感信息。
4. 推荐访问环境：

   - Chrome、Edge 或其它现代 Chromium 内核浏览器以及移动端相应配置。
   - 建议使用桌面端完成 Owner 管理、模板设计、批量审核和导出操作。
   - 系统页面已做移动端适配，移动端更适合查看、轻量标注和状态确认。

## 3. 提交包结构

本次提交材料集中在 `submission/` 目录下：

```text
submission/
  README.md                    提交包入口说明
  演示说明.md                  演示视频、演示路径和注意事项说明
  API文档/
    接口文档.md                后端接口分组、关键请求和联调说明
  相关文档/
    项目实施计划书.docx        项目原始实施计划和阶段目标
    基础技术文档.docx          技术选型、基础设计和实现说明
    关键技术点.md              关键能力补充记录
    阶段计划.md                每轮实现前的阶段计划追加记录
    阶段实现.md                每轮实现后的实际落地记录
    问题点归档.md              已发现问题、风险和处理记录
    系统架构图.png             系统架构图
    Demo截图/                  演示截图材料
  演示视频/                    演示视频材料
```

建议阅读顺序：

1. 先读当前 `README.md`，了解线上系统、交付内容和验收路径。
2. 再读 `相关文档/项目实施计划书.docx`，确认项目目标和范围。
3. 查看 `相关文档/系统架构图.png` 与 `相关文档/基础技术文档.docx`，理解架构拆分。
4. 查看 `API文档/接口文档.md`，了解后端接口和前后端联调边界。
5. 根据需要查看 `阶段计划.md`、`阶段实现.md` 和 `问题点归档.md`，追溯功能增量和问题处理过程。

## 4. 系统角色与业务闭环

### 4.1 Owner

Owner 是标注项目负责人，主要负责项目配置、任务发布、质量追踪和结果交付。

核心能力：

- 数据集管理：创建数据集、导入样本、追加导入、查看样本预览、删除数据集。
- 模板设计：通过表单 Schema 配置标注字段、校验规则和多 Tab 结构化表单。
- 任务管理：创建任务、绑定数据集和模板、配置任务范围、发布、暂停、恢复和删除任务。
- 题量配置：按标注员和审核员分配任务题量，控制任务流转范围。
- AI 预审配置：配置 AI 审核规则、启停规则、查看 Job 队列和重试失败任务。
- 审核管理：查看审核员负载、题目时间线、审核日志和人工裁决状态。
- 数据看板：查看任务进度、质量指标、风险提醒、争议分布和近期变化。
- 结果导出：创建导出任务，下载 JSON、JSONL、CSV、XLSX 等格式的结果文件。
- 模型配置：维护 OpenAI-compatible 模型地址、模型名称、API Key 和启用状态。
- 审核员邀请：创建 Reviewer 邀请码，让新审核员通过邀请注册进入系统。

推荐验收路径：

1. 登录 Owner 账号。
2. 创建或选择数据集，确认样本可预览。
3. 创建标注模板并发布。
4. 创建任务并绑定数据集和模板。
5. 配置标注员、审核员和题量。
6. 发布任务。
7. 在看板观察进度变化。
8. 在审核管理中查看标注、AI 预审和人工审核链路。
9. 在导出中心创建并下载结果文件。

### 4.2 Labeler

Labeler 是标注员，负责领取任务并提交结构化标注答案。

核心能力：

- 首页概览：查看已领取任务、贡献统计、待处理事项和近期记录。
- 任务市场：查看可领取任务并领取到自己的任务列表。
- 我的任务：查看已领取任务、完成进度和任务状态。
- 答题页：按 Owner 发布的 Schema 动态渲染表单，提交结构化答案。
- 草稿箱：保存未完成答案，后续继续作答。
- 批量提交：对同一任务中的多个题目进行批量提交。
- 打回项：查看 Reviewer 打回的问题，修改后重新提交。
- 问题上报：在样本或任务存在异常时提交反馈。
- LLM 助手：在答题过程中获取字段理解和标注建议。

推荐验收路径：

1. 登录 Labeler 账号。
2. 进入任务市场领取已发布任务。
3. 进入我的任务并打开答题页。
4. 保存一次草稿，确认草稿箱可继续编辑。
5. 提交标注答案。
6. 若审核打回，进入打回项完成返工。

### 4.3 Reviewer

Reviewer 是人工审核员，负责结合 AI 结果进行复核裁决。

核心能力：

- 首页概览：查看待审核、已处理、争议样本和近期审核统计。
- AI 审核任务：按任务聚合查看 AI 预审结果。
- 三栏工作台：同时查看样本原文、Labeler 答案、AI 建议和人工裁决区。
- 人工裁决：支持通过、打回、争议等审核动作。
- 审核时间线：查看题目从分配、提交、AI 预审到人工审核的完整事件链。
- 争议样本：集中处理需要进一步判断或终审的样本。
- 审核报表：导出或查看审核统计数据。

推荐验收路径：

1. 登录 Reviewer 账号。
2. 打开 AI 审核任务列表。
3. 进入某个任务的审核工作台。
4. 查看样本、标注答案、AI 建议和置信度。
5. 对题目执行通过、打回或争议裁决。
6. 查看时间线和争议样本状态变化。

### 4.4 AI Reviewer 与 Agent

AI Reviewer 是 Web 端的 AI 预审管理视角，Agent 是独立运行的后端 Worker。

核心能力：

- Web 端查看 AI 预审队列、预审结果、状态分布和趋势数据。
- Web 端配置模型运行参数，并将 active 配置提供给 Agent 使用。
- 后端维护 AI Review Job 的创建、领取、完成、失败、取消、重试和批量删除。
- Agent 使用 `system_agent` 机器账号登录后端，按并发配置轮询 Job。
- Agent 调用 OpenAI-compatible LLM，解析结构化输出后回写后端。
- Agent 环境变量中的 `LABELHUB_LLM_*` 可作为 Web active 配置不可用时的兜底。

验收重点：

1. Labeler 提交答案后，后端能生成 AI Review Job。
2. Agent 能领取 Job，并把状态从 pending/running 推进到 completed 或 failed。
3. Reviewer 工作台能看到 AI 建议、审核结论、理由和置信度。
4. Owner 或 AI Reviewer 能查看队列状态、失败重试和趋势数据。

## 5. 生产部署架构

当前生产环境采用 Docker Compose + 宿主机 Nginx 的部署方式。

### 5.1 服务组成

1. 前端服务：

   - 技术栈：React 18、TypeScript、Vite、Ant Design、React Router。
   - 构建产物：静态文件。
   - 容器运行：Nginx 1.27 Alpine。
   - 对外路径：`/labelhub/`。
   - 构建参数：`VITE_APP_BASE_PATH=/labelhub/`，`VITE_API_BASE_URL=/labelhub/api`。
2. 后端服务：

   - 技术栈：Java 21、Spring Boot 3.4.5、Spring Web、Spring Security、Spring JDBC、Spring Data Redis。
   - 容器端口：`8080`。
   - 对外路径：通过 Nginx 将 `/labelhub/api/` 转发到后端 `/api/`。
   - 核心职责：认证、任务、模板、数据集、标注、审核、AI 预审、导出、看板和附件。
3. Agent 服务：

   - 技术栈：Java 21、Spring Boot Worker。
   - 容器端口：`8091`，生产环境主要在 Docker 内网运行。
   - 核心职责：登录后端、领取 AI Review Job、调用模型、解析结果并回写。
4. MySQL：

   - 版本：MySQL 8.0。
   - 职责：保存业务数据、用户、任务、数据集、样本、标注、审核、导出记录和模型配置。
   - 访问方式：仅 Docker 网络内访问，不对公网暴露。
5. Redis：

   - 版本：Redis 7 Alpine。
   - 职责：保存登录 token 会话。
   - 访问方式：仅 Docker 网络内访问，不对公网暴露。
6. db-migrate：

   - 镜像：官方 `mysql:8.0` 客户端镜像。
   - 职责：按版本执行 `V*.sql` 数据库迁移，并写入 `schema_migrations` 记录。
   - 运行方式：只在首次部署或新增迁移时通过 migrate profile 单独执行。

### 5.2 网络与路径

生产访问路径如下：

```text
浏览器
  -> https://www.scu-gpt.top/labelhub/
  -> 宿主机 Nginx HTTPS server
  -> /labelhub/      转发到 127.0.0.1:18080
  -> /labelhub/api/  转发到 127.0.0.1:8080/api/
  -> Docker Compose 内部服务
```

说明：

- 前端深层路由由前端容器内 Nginx 回退到 `index.html`。
- 后端 API 只通过 `/labelhub/api/` 暴露给浏览器。
- MySQL 和 Redis 不直接暴露公网端口。
- 生产环境必须使用 HTTPS，避免 token 经明文 HTTP 传输。

### 5.3 数据与文件持久化

生产环境需要持久化以下数据：

- `labelhub-mysql-data`：MySQL 业务数据。
- `labelhub-redis-data`：Redis appendonly 数据。
- `labelhub-backend-exports`：后端导出文件。
- `labelhub-backend-attachments`：标注附件上传文件。
- 宿主机 Nginx 证书、Nginx 配置和部署 `.env`。

备份建议：

1. 定期备份 MySQL 数据库，至少包含 `labelhub` 库。
2. 定期备份导出文件卷和附件文件卷。
3. 备份部署目录中的 `infra/.env`，但不得提交到代码仓库。
4. `LABELHUB_MODEL_CONFIG_SECRET` 必须长期固定；如果更换，历史加密模型 Key 将无法正常解密。

## 6. 技术栈概览

1. 前端：

   - React 18
   - TypeScript 6
   - Vite 8
   - Ant Design 6
   - React Router 7
   - Formily / JSON Schema
   - dnd-kit
   - Recharts
   - React Markdown / remark-gfm
2. 后端：

   - Java 21
   - Spring Boot 3.4.5
   - Spring Web / Security / JDBC / Validation
   - Spring Data Redis
   - MySQL Connector/J
   - Apache POI
   - Springdoc OpenAPI
3. Agent：

   - Java 21
   - Spring Boot
   - OpenAI-compatible Responses API 调用方式
   - 独立 Worker 轮询模型
4. 基础设施：

   - Docker / Docker Compose
   - MySQL 8.0
   - Redis 7
   - Nginx
   - Cloudflare Turnstile
   - HTTPS 证书由宿主机 Nginx 管理

## 7. 接口与文档入口

1. 生产 API 路径：

   - 浏览器实际调用前缀：`https://www.scu-gpt.top/labelhub/api`
   - 后端服务内部路径前缀：`/api`
2. Swagger 与 OpenAPI 入口：

   - Swagger UI：`https://www.scu-gpt.top/labelhub/swagger-ui/index.html`
   - OpenAPI JSON：`https://www.scu-gpt.top/labelhub/v3/api-docs`
   - 服务器本机 `127.0.0.1:8080` 后端直连入口仅用于运维排查，不作为公开演示入口。
3. 提交包接口文档：

   - `submission/API文档/接口文档.md`
4. 主要接口分组：

   - 认证与用户：登录、注册、退出、当前用户、Reviewer/Owner 邀请。
   - Owner：任务、模板、数据集、AI 规则、审核管理、看板、导出和模型配置。
   - Labeler：任务市场、我的任务、草稿、提交、返修项、问题上报和 LLM 辅助。
   - Reviewer：审核任务、工作台详情、人工裁决、争议样本和报表。
   - AI Agent：Job 领取、完成、失败、取消、重试、运行时配置和健康检查。
   - 文件能力：附件上传下载、导出文件下载和下载确认。

接口文档与实际接口不一致时，以当前后端 Controller、Swagger/OpenAPI 输出和前端 `frontend/src/api/` 调用为准。

## 8. 生产验收建议

### 8.1 基础可用性

1. 打开 `https://www.scu-gpt.top/labelhub/`，确认首页可正常加载。
2. 打开 `https://www.scu-gpt.top/labelhub/login`，确认登录页不再展示本地演示账号入口。
3. 刷新深层路由，例如 `/labelhub/owner/tasks`，确认前端路由不会 404。
4. 确认浏览器标签页显示 LabelHub favicon。
5. 在登录页完成 Turnstile 人机验证并登录。

### 8.2 业务闭环

建议按以下最小流程验收：

1. Owner 创建数据集并导入少量样本。
2. Owner 创建模板，配置文本、单选、多选、评分或结构化字段。
3. Owner 创建任务，绑定数据集和模板，并发布任务。
4. Labeler 领取任务，填写表单并提交答案。
5. Agent 领取 AI Review Job 并回写预审结果。
6. Reviewer 打开审核工作台，参考 AI 结果完成人工裁决。
7. Owner 查看任务看板、审核日志和题目时间线。
8. Owner 在导出中心创建导出任务并下载结果文件。

### 8.3 运维检查

服务器上可通过以下方式检查服务状态：

```bash
cd /opt/labelhub/infra
docker compose --env-file .env ps
docker compose --env-file .env logs --tail=120 backend
docker compose --env-file .env logs --tail=120 agent
curl -I https://www.scu-gpt.top/labelhub/
curl -I https://www.scu-gpt.top/labelhub/login
```

首次部署或新增迁移后，需要单独执行数据库迁移：

```bash
cd /opt/labelhub/infra
docker compose --env-file .env --profile migrate run --rm db-migrate
```

常规更新流程：

```bash
cd /opt/labelhub/infra
docker compose --env-file .env pull
docker compose --env-file .env up -d
```

如果前端构建参数发生变化，例如 `VITE_APP_BASE_PATH`、`VITE_API_BASE_URL` 或 `VITE_TURNSTILE_SITE_KEY`，必须重新构建并发布前端镜像；仅修改服务器环境变量不会改变已经打包进静态资源的值。

## 9. 安全与生产配置要求

生产环境至少需要满足以下要求：

1. 关闭或禁用所有本地开发演示账号。
2. 使用真实 Cloudflare Turnstile site key 和 secret key。
3. 使用强随机 `LABELHUB_AUTH_SERVICE_LOGIN_TOKEN`，并保证后端与 Agent 配置完全一致。
4. 使用强随机且长期稳定的 `LABELHUB_MODEL_CONFIG_SECRET`。
5. 不把数据库密码、Redis 密码、LLM API Key、Turnstile secret key 写入仓库或提交包。
6. MySQL、Redis 仅在 Docker 网络内访问，不开放公网端口。
7. 后端、前端只绑定宿主机回环地址，由宿主机 Nginx 统一对外暴露 HTTPS。
8. 定期备份 MySQL、导出文件、附件文件和部署配置。
9. 控制服务器安全组和防火墙，仅开放必要端口。
10. 登录 token 必须通过 HTTPS 传输，禁止在公网使用明文 HTTP。

## 10. 已知边界

1. 当前生产部署更适合比赛演示、小规模试用和功能验收；长期大规模生产运行建议升级服务器内存、CPU 和独立数据盘。
2. 单次数据集导入和附件上传仍受后端与 Nginx 上传大小限制约束，超大文件需要拆分导入或后续扩展对象存储。
3. AI 预审质量取决于模型供应商、模型配置、提示词和样本内容，人工 Reviewer 仍是最终裁决环节。
4. Swagger UI 主要作为本地或内网开发调试入口，公开生产访问以 Web 前端和 `/labelhub/api/` 业务调用为准。
5. `LABELHUB_MODEL_CONFIG_SECRET` 更换会影响已保存模型 API Key 的解密，生产中不得随意轮换。
6. `infra/.env` 是生产部署关键配置文件，必须妥善保存并限制访问权限。
