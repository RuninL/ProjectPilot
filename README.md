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

| 层              | 选型                                                    |
| --------------- | ------------------------------------------------------- |
| Desktop         | Tauri 2                                                 |
| Frontend        | React + TypeScript (strict) + Vite                      |
| Styling / UI    | Tailwind CSS + shadcn/ui                                |
| Database        | SQLite（tauri-plugin-sql + 自写 Rust 原子事务 command） |
| Routing / State | React Router / Zustand                                  |
| Forms / Date    | React Hook Form + Zod / date-fns                        |
| Testing         | Vitest + React Testing Library                          |
| Platform        | Windows 10/11 x64                                       |

日期格式 `YYYY-MM-DD`，业务时区 Asia/Hong_Kong。

## 环境要求

| 依赖    | 版本              | 说明                                                                           |
| ------- | ----------------- | ------------------------------------------------------------------------------ |
| Node.js | ≥ 20 LTS          | 附带 npm ≥ 10                                                                  |
| Rust    | stable（≥ 1.77）  | 通过 [rustup](https://rustup.rs/) 安装                                         |
| 系统    | Windows 10/11 x64 | 需安装 Microsoft Visual Studio C++ 生成工具与 WebView2 Runtime（Win11 已内置） |

前端相关命令（`lint` / `typecheck` / `test` / `format:check` / `dev`）只需 Node.js；
`npm run tauri dev` 与 `npm run tauri build` 需要完整的 Rust 工具链。

## 安装

```bash
npm install
```

`better-sqlite3` 为 devDependency，用于测试中运行真实迁移 SQL；安装时会编译原生模块，
因此需要上表中的 C++ 生成工具。

## 开发启动

```bash
npm run tauri dev   # 桌面应用（Rust + 前端）
npm run dev         # 仅前端页面调试；数据库相关功能不可用
```

首次启动会自动创建示例项目与示例任务（带「示例」徽标），仅执行一次。

## 测试与质量检查

```bash
npm run lint          # ESLint（typescript-eslint strictTypeChecked，禁止 any）
npm run typecheck     # tsc --noEmit
npm run test          # Vitest（含基于 better-sqlite3 的真实 SQLite 集成测试）
npm run format:check  # Prettier 格式检查
```

## 故障排除

| 现象                                       | 处理                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `npm install` 时 `better-sqlite3` 编译失败 | 安装「Visual Studio 生成工具」的 C++ 桌面开发工作负载后重试                                       |
| `npm run tauri dev` 报找不到 `cargo`       | 安装 Rust 工具链并重开终端，使 `cargo` 进入 PATH                                                  |
| 启动时提示「数据库初始化失败」             | 说明迁移或 `PRAGMA foreign_keys` 断言失败；该断言会主动阻止启动以免数据损坏，请查看控制台错误详情 |
| 启动时提示「示例数据创建失败」             | 示例数据为非致命功能，应用仍可使用；重装或清除数据库文件后重启即可重新创建                        |
| 想从干净数据库重来                         | 删除 Tauri app data 目录下的 `projectpilot.db` 后重启应用                                         |
| 界面显示为浅色                             | 本应用深色优先；主题跟随系统时会读取系统偏好，跟随系统开关将在阶段 2 的设置页开放                 |

## 文档

| 文档                                                         | 内容                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| [docs/product-spec.md](docs/product-spec.md)                 | 产品规格：范围内外、信息架构、核心流程、功能细则           |
| [docs/architecture.md](docs/architecture.md)                 | 架构：分层设计、持久层策略、Gantt 方案、日期策略、目录结构 |
| [docs/database-schema.md](docs/database-schema.md)           | 数据库：8 张表字段/约束/索引/外键/删除规则、Mermaid ER 图  |
| [docs/development-plan.md](docs/development-plan.md)         | 分阶段开发计划、测试计划、依赖候选清单                     |
| [docs/acceptance-checklist.md](docs/acceptance-checklist.md) | 按阶段的验收清单                                           |

## 项目状态

**阶段 2：项目与任务管理（当前）** — 已完成。

已具备：

- Tauri 2 + React 18 + TypeScript strict 工程，Tailwind + shadcn/ui 基础组件
- SQLite 迁移 0001（8 张表、索引、触发器、外键级联）与迁移 0002（任务生命周期列、索引、层级触发器，**纯增量**），
  启动时断言 `PRAGMA foreign_keys = ON`
- repository 层（SQL 仅存在于 `src/repositories/` 与迁移文件）与 Zod 行 schema 类型边界
- Rust `execute_batch` 原子事务 command，任务批量修改经其单事务提交
- **项目**：列表（搜索 / 状态 / 活动·已归档·全部 / 排序）、新建、编辑、归档、恢复、
  永久删除（仅限已归档，确认框显示真实任务数量）、按任务口径计算的完成率
- **项目详情**：概览统计（总数 / 进行中 / 受阻 / 已完成 / 已逾期）+ 同页任务区
- **任务**：跨项目「我的任务」与项目内任务区共用实现；两层父子、五态、四级优先级、
  搜索 / 状态 / 优先级 / 项目 / 截止区间筛选、排序、批量修改（状态 / 优先级 / 截止日期，二次确认）
- 设置页：主题切换（深色 / 浅色 / 跟随系统）与「清除示例数据」（二次确认，仅删 `is_sample = 1`）
- 深色优先主题、6 项左侧导航；未实现能力一律为不可点击的「后续阶段」占位卡片

尚未具备（后续阶段）：

- 甘特图、里程碑、任务依赖、会议与行动项、真实日历视图
- 导入导出、备份恢复、提醒通知、数据库位置迁移（设置页中已列为「后续阶段」占位）
- **任务归档界面**：迁移 0002 已添加 `tasks.archived_at`，查询与完成率也已正确排除归档任务，
  但本阶段**不提供任务归档 / 恢复的界面入口**，该字段目前只由 schema、查询和完成率口径使用
- `tasks.source_meeting_id` 同理：字段与外键已就位，写入方（行动项转任务）留待后续阶段

后续阶段见 [docs/development-plan.md](docs/development-plan.md)。开发遵循的硬性质量规则：

- TypeScript strict mode，禁止 `any`
- 页面不散落 SQL，一律经 repository/service 层
- UI 数据必须来自真实 SQLite，最终不保留 mock 数据
- 危险操作二次确认；所有表单 Zod 校验
- 显式处理空状态、加载状态、数据库错误、日期错误与无效输入
- 未来 AI 功能只能是用户确认后写入数据的辅助层（详见 architecture.md 安全边界）
