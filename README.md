# ProjectPilot

本地个人使用的 Windows 桌面项目管理软件，面向个人的工程、科研、课程设计与 FSAE 项目管理。

**核心闭环**：项目 → 任务 → 甘特图 → Milestone → 会议记录 → 行动项 → 任务 → Dashboard 风险追踪

## 特性（第一版范围）

- 完全离线，所有数据存本机 SQLite（Tauri app data 目录），无账号、无云同步、无付费服务
- 项目 / 任务（两层父子、五态、四级优先级）/ Milestone / 会议与行动项
- 自研 SVG 甘特图：周/月/季度时间轴、finish-to-start 依赖、循环依赖与排期冲突检测
- Dashboard 风险追踪：今日/本周/逾期、30 天 milestone、四类风险规则
- 月视图日历、文件与链接（仅 URL/路径）、JSON/CSV 导入导出、SQLite 备份恢复
- 深色/浅色/跟随系统主题；界面简体中文

## 技术栈（固定）

| 层 | 选型 |
|---|---|
| Desktop | Tauri 2 |
| Frontend | React + TypeScript (strict) + Vite |
| Styling / UI | Tailwind CSS + shadcn/ui |
| Database | SQLite（tauri-plugin-sql + 自写 Rust 原子事务 command） |
| Routing / State | React Router / Zustand |
| Forms / Date | React Hook Form + Zod / date-fns |
| Testing | Vitest + React Testing Library |
| Platform | Windows 10/11 x64 |

日期格式 `YYYY-MM-DD`，业务时区 Asia/Hong_Kong。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/product-spec.md](docs/product-spec.md) | 产品规格：范围内外、信息架构、核心流程、功能细则 |
| [docs/architecture.md](docs/architecture.md) | 架构：分层设计、持久层策略、Gantt 方案、日期策略、目录结构 |
| [docs/database-schema.md](docs/database-schema.md) | 数据库：8 张表字段/约束/索引/外键/删除规则、Mermaid ER 图 |
| [docs/development-plan.md](docs/development-plan.md) | 分阶段开发计划、测试计划、依赖候选清单 |
| [docs/acceptance-checklist.md](docs/acceptance-checklist.md) | 按阶段的验收清单 |

## 项目状态

**阶段 0：产品和架构规划（当前）** — 仅有规划文档，未安装任何依赖，未初始化 Tauri/React 工程。

后续阶段见 [docs/development-plan.md](docs/development-plan.md)。开发遵循的硬性质量规则：

- TypeScript strict mode，禁止 `any`
- 页面不散落 SQL，一律经 repository/service 层
- UI 数据必须来自真实 SQLite，最终不保留 mock 数据
- 危险操作二次确认；所有表单 Zod 校验
- 显式处理空状态、加载状态、数据库错误、日期错误与无效输入
- 未来 AI 功能只能是用户确认后写入数据的辅助层（详见 architecture.md 安全边界）
