# 演示与资料说明

本文件用于把演示和使用时需要查看的资料集中到一个入口，避免文档中心出现多个只有“待补充”的占位文档。

## 资料覆盖清单

### 源码仓库

- 仓库根目录包含前端、后端、AI Review Agent、数据库迁移脚本、项目文档和说明材料。
- 推荐先阅读根目录 `README.md`，再按需查看 `frontend/`、`backend/`、`agent/`、`docs/` 和 `submission/`。

### README.md

- `README.md` 是项目入口文档。
- 覆盖系统能力、技术栈、目录结构、本地运行、演示账号、API 与文档、部署说明和协作规范。

### 关于.md

- `关于.md` 是公开关于页的产品介绍文档。
- `/about` 页面直接渲染 `关于.md`，面向参赛评委和普通访客说明平台定位、角色协作、AI 预审和演示闭环。
- README 继续保留在 `/docs` 文档中心中，作为开发者和项目资料入口。

### 演示视频

- 演示视频建议控制在 5 到 10 分钟。
- 建议覆盖三条主线：
  - Owner 创建模板、导入数据集、发布任务、查看看板与导出。
  - Labeler 领取任务、作答、使用 LLM 助手、提交与处理打回项。
  - AI Reviewer / Reviewer 完成 AI 预审、人工审核、争议处理与审计追踪。
- 如视频文件较大，建议放入 `submission/` 或外部可访问地址，并在演示说明中标明文件名或链接。

### 相关文档

- 基础技术文档：`submission/Related_documents/基础技术文档.docx`。
- 系统架构图：`submission/screenshots/系统架构图.png`。
- 项目实施计划：`项目实施计划书.docx`。
- 课题要求原文：`LabelHub 数据标注平台 · AI全栈课题实现要求.docx`。

### AI Coding 过程记录

- `阶段计划.md` 记录每次实现前的目标、范围、验收标准和约束。
- `阶段实现.md` 记录对应实现内容、验证结果、影响范围和残留事项。
- 两份文档已按主题结构重组，适合并排阅读。

### 基础技术文档

- `基础技术文档.docx` 是技术说明主文档。
- 覆盖项目概述、技术栈、总体架构、目录结构、核心业务流程、数据模型、后端设计、前端设计、AI Review Agent、安全与配置、运行部署、测试验证和风险边界。

### 可访问演示环境

- 本地前端默认地址：`http://localhost:5173`。
- 本地后端默认地址：`http://127.0.0.1:8080`。
- Swagger UI 默认地址：`http://127.0.0.1:8080/swagger-ui/index.html`。
- 如部署到云平台，应在演示说明中补充公网访问地址、演示账号和必要的环境说明。

### API 文档

- `接口文档.md` 是接口契约和前后端闭环记录主入口。
- Swagger UI 是在线调试入口。
- README 只保留 API 总览和入口，不重复维护完整接口清单。

## 推荐阅读顺序

1. 先读 `README.md`，确认项目能力、运行方式和演示账号。
2. 再读 `基础技术文档.docx`，确认架构、流程、数据模型和关键技术点。
3. 查看 `系统架构图.png`，建立整体模块关系。
4. 查看 `阶段计划.md` 和 `阶段实现.md`，了解 AI Coding 过程与阶段闭环。
5. 查看 `接口文档.md` 和 Swagger UI，核对接口契约。
6. 最后按演示视频或现场答辩路线验证三类角色主流程。

## 说明

- 原 `docs/architecture.md`、`docs/state-machine.md`、`docs/api-docs.md`、`docs/demo-script.md` 和 `submission/demo-video.md` 目前只保留为仓库占位文件，不再作为文档中心独立入口。
- 技术说明以 `基础技术文档.docx`、`README.md`、`接口文档.md` 和源码为准。
- 生产部署以 `docs/deployment-labelhub.md`、`infra/docker-compose.yml`、`infra/env.example` 和 `infra/nginx.conf` 为准；当前推荐部署地址为 `https://www.scu-gpt.top/labelhub`。
