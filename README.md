# ProjectPilot

本地个人使用的 Windows 桌面项目管理软件，面向个人的工程、科研、课程设计与 FSAE 项目管理。

**核心闭环**：项目 → 任务 → 甘特图 → Milestone → 会议记录 → 行动项 → 任务 → Dashboard 风险追踪

## 特性（第一版范围）

- 完全离线，所有数据存本机 SQLite（Tauri app config 目录），无账号、无云同步、无付费服务
- 项目 / 任务（两层父子、五态、四级优先级）/ Milestone / 会议与行动项
- 自研 SVG 甘特图：周/月/季度时间轴、finish-to-start 依赖、循环依赖与排期冲突检测
- Dashboard 风险追踪：今日/未来 7 天/逾期任务、近期会议与未完成行动项、30 天 milestone、四类派生风险
- 月视图日历、文件与链接（仅 URL/路径）、全量 JSON 导入导出、CSV 单向导出、SQLite 备份恢复
- 深色/浅色/暖橙/彩色/跟随系统主题；界面简体中文

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

## 正式支持与限制

- 正式支持平台仅为 **Windows 10/11 x64**；不提供 macOS、Linux 或移动端的正式支持。
- 完全离线且只使用本机 SQLite；没有云同步、账号体系、多人协作或文件内容托管。
- Files & Links 只保存 URL 或 Windows 文件/目录路径。仅 `http/https` 可直接打开；其他协议或不存在的路径只能复制并给出中文提示。
- 甘特图和日历均不支持拖拽排期；请通过任务编辑表单修改日期。

### 已接受的依赖风险（待跟踪）

`npm audit --omit=dev` 目前报告 2 个 moderate 生产依赖漏洞（无 high/critical）：`react-router-dom@6.30.4`
及其传递依赖 `react-router@6.30.4`。相关公告为
[GHSA-jjmj-jmhj-qwj2](https://github.com/advisories/GHSA-jjmj-jmhj-qwj2)（开放重定向/XSS）、
[GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6)（反斜杠绕过开放重定向）和
[GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg)（SSR hydration 的构造器注入）。
审计工具仅提供 `react-router-dom@7.18.2` 的 major 升级修复，当前 6.x 没有非破坏性安全升级路径；本版不使用
`--force` 升级。ProjectPilot 没有远程服务端、多人 Web 暴露或 SSR hydration，且数据仅本地保存，因此影响面较小，
但若应用未来处理不可信链接、运行在 Web 上下文或采用 SSR，仍可能受影响。这是已接受的非阻塞风险，后续版本将评估
React Router 7 迁移并持续跟踪上述公告。

## Windows 安装与首次启动

1. 从官方 GitHub Release 下载 NSIS `.exe` 安装包和同页的 `SHA256SUMS.txt`。
2. 在 PowerShell 运行 `Get-FileHash .\ProjectPilot_*.exe -Algorithm SHA256`，并与 `SHA256SUMS.txt` 中对应文件的值比对。
3. 运行安装包。安装包内置 WebView2 离线安装程序，因此首次安装包较大，但无须预先安装 WebView2。
4. 安装包未签名，Windows SmartScreen 提示时只应在确认下载来源为官方 GitHub Release 且校验和一致后继续。
5. 首次启动可使用示例数据熟悉界面；数据始终保留在本机的 Tauri app config 目录。

## 数据、备份与恢复

- 设置页显示数据库位置，并可打开数据目录。
- JSON 导入/导出用于完整数据迁移；替换导入会先明确确认，合并导入会跳过同 ID 数据。
- CSV 仅支持导出任务、里程碑和风险，使用 UTF-8 BOM 和公式注入保护，可用 Excel 打开。
- SQLite 备份使用在线备份；恢复前会验证文件并自动保存当前数据库的安全副本。**恢复完成后必须重启应用。**
- 请定期将备份保存到应用数据目录以外的位置。

## 环境要求（开发者）

| 依赖    | 版本              | 说明                                                                   |
| ------- | ----------------- | ---------------------------------------------------------------------- |
| Node.js | ≥ 20 LTS          | 附带 npm ≥ 10                                                          |
| Rust    | stable（≥ 1.77）  | 通过 [rustup](https://rustup.rs/) 安装                                 |
| 系统    | Windows 10/11 x64 | 需安装 Microsoft Visual Studio C++ 生成工具；发布安装包会处理 WebView2 |

前端相关命令（`lint` / `typecheck` / `test` / `format:check` / `dev`）只需 Node.js；
`npm run tauri dev` 与 `npm run tauri build` 需要完整的 Rust 工具链。

## 开发安装

```bash
npm install
```

`better-sqlite3` 为 devDependency，用于测试中运行真实迁移 SQL；安装时会编译原生模块，
因此需要上表中的 C++ 生成工具。

## 开发启动与构建

```bash
npm run tauri dev   # 桌面应用（Rust + 前端）
npm run dev         # 仅前端页面调试；数据库相关功能不可用
npm run tauri build # 生成本机平台的安装包
```

首次启动会自动创建示例项目与示例任务（带「示例」徽标），仅执行一次。

### 文件与链接

在项目详情的「文件与链接」区可保存网页 URL 或 Windows 本地文件/目录路径，并进行打开、复制、
编辑和删除。软件只保存地址字符串，不上传、复制、读取或托管文件内容；本地文件移动或删除后快捷方式会失效，
此时仍可复制原路径。仅 `http/https` URL 可直接打开，其他协议只允许复制。

## 测试与质量检查

```bash
npm run lint          # ESLint（typescript-eslint strictTypeChecked，禁止 any）
npm run typecheck     # tsc --noEmit
npm run test          # Vitest（含基于 better-sqlite3 的真实 SQLite 集成测试）
npm run format:check  # Prettier 格式检查
```

## 故障排除

| 现象                                       | 处理                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| `npm install` 时 `better-sqlite3` 编译失败 | 安装「Visual Studio 生成工具」的 C++ 桌面开发工作负载后重试                      |
| `npm run tauri dev` 报找不到 `cargo`       | 安装 Rust 工具链并重开终端，使 `cargo` 进入 PATH                                 |
| 启动时提示「数据库初始化失败」             | 说明迁移或数据库初始化失败；请查看控制台错误详情，避免在未确认原因前继续写入数据 |
| 启动时提示「示例数据创建失败」             | 示例数据为非致命功能，应用仍可使用；重装或清除数据库文件后重启即可重新创建       |
| 想从干净数据库重来                         | 删除 Tauri app config 目录下的 `projectpilot.db` 后重启应用                      |
| 界面显示为浅色                             | 在设置页选择深色、浅色、暖橙、彩色或跟随系统；选择会在重启后保持                 |
| 恢复后界面仍显示旧数据                     | 恢复会替换数据库；请按提示完全重启应用                                           |
| 本地链接无法打开                           | 检查文件或目录是否仍存在；应用不会读取、上传或托管文件内容，仍可复制保存的路径   |

## 文档

| 文档                                                         | 内容                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| [docs/product-spec.md](docs/product-spec.md)                 | 产品规格：范围内外、信息架构、核心流程、功能细则           |
| [docs/architecture.md](docs/architecture.md)                 | 架构：分层设计、持久层策略、Gantt 方案、日期策略、目录结构 |
| [docs/database-schema.md](docs/database-schema.md)           | 数据库：9 张表字段/约束/索引/外键/删除规则、Mermaid ER 图  |
| [docs/development-plan.md](docs/development-plan.md)         | 分阶段开发计划、测试计划、依赖候选清单                     |
| [docs/acceptance-checklist.md](docs/acceptance-checklist.md) | 按阶段的验收清单                                           |

## 项目状态

**阶段 7：发布准备** — 代码、自动化质量检查和 Windows 发布工作流已配置；Windows 真机安装体验仍需在发布后完成最终确认。

已具备：

- Tauri 2 + React 18 + TypeScript strict 工程，Tailwind + shadcn/ui 基础组件
- SQLite 迁移 0001（8 张基础表、索引、触发器、外键级联）与迁移 0002（任务生命周期列、索引、层级触发器）、
  0003（依赖触发器）、0004（`meetings.start_time`、里程碑日期索引、行动项防重复转换与审计触发器）、
  0005（结构化风险表）、0006（项目链接可选备注）；0002–0006 **均为纯增量**；启动时断言
  SQLx SQLite 连接默认启用外键，`execute_batch` 也显式启用 `PRAGMA foreign_keys = ON`
- repository 层（SQL 仅存在于 `src/repositories/` 与迁移文件）与 Zod 行 schema 类型边界
- Rust `execute_batch` 原子事务 command，任务批量修改经其单事务提交
- **项目**：列表（搜索 / 状态 / 活动·已归档·全部 / 排序）、新建、编辑、归档、恢复、
  永久删除（仅限已归档，确认框显示真实任务数量）、按任务口径计算的完成率
- **项目详情**：概览统计（总数 / 进行中 / 受阻 / 已完成 / 已逾期）+ 同页任务区
- **任务**：跨项目「我的任务」与项目内任务区共用实现；两层父子、五态、四级优先级、
  搜索 / 状态 / 优先级 / 项目 / 截止区间筛选、排序、批量修改（状态 / 优先级 / 截止日期，二次确认）
- **任务依赖（FS，完成后开始）**：项目详情内创建 / 删除依赖；候选下拉预过滤自身、已归档、
  已建立依赖与会成环的任务；service 在写入前重新校验全部规则（自依赖、跨项目、重复、任意深度成环、
  归档任务），迁移 0003 的触发器兜底同项目与直接反向边；删除二次确认，取消无副作用，
  且创建/删除都不会改写任务状态
- **依赖图算法**（`src/services/dependencyGraph.ts`，纯函数、无 React/SQLite/DOM 依赖）：构图、
  加边防环（反向可达性）、Kahn 稳定拓扑排序、前驱/后继查询、受阻风险传导、排期冲突计算
- **甘特图**：自研纯 SVG，单项目，周 / 月 / 季度三档时间轴、今日线、状态着色任务条、依赖箭头、
  中文图例；冲突边红色虚线并在下方列出「A 截止晚于 B 开始」并可定位；受阻风险在任务条与列表标注；
  无开始日期的任务不绘制但按名称列出；无截止日期按单日条显示并说明
- **会议**：跨项目会议列表（`/meetings`，标注所属项目或「独立会议」）、会议详情
  （`/meetings/:id`，议程 / 纪要 / 决议 / 风险 / 参与者 / 可选开始时间）、新建 / 编辑 / 删除；
  删除二次确认显示**真实行动项数量**并明示已转换出的任务会保留；项目详情内同页列出该项目会议
- **行动项**：会议详情内新建 / 编辑 / 删除，一键「转为任务」经 Rust `execute_batch` 单事务完成
  （条件插入任务 + 条件回写 `converted_task_id`，受影响行数不足即回滚）；提交中按钮显示
  「转换中…」并禁用；已转换显示「查看任务」链接；关联任务被删除后显示「任务已删除」且不重开转换；
  独立会议转换时弹窗要求选择目标项目，未选择前确认按钮禁用
- **里程碑**：项目详情内新建 / 编辑 / 删除，按 Asia/Hong_Kong 日历日显示「剩余 N 天」/
  「今天到期」/「已逾期 N 天」；可关联任务，关联任务全部完成时**仅弹出询问**是否标记为已达成，
  选「否，保持当前状态」不产生任何写入；归档项目禁用全部写入入口
- **日历**：`/calendar` 月视图，六周网格、周一为首日，同日的任务截止 / 会议 / 里程碑以中文文字标签
  `[任务截止]`/`[会议]`/`[里程碑]` 区分（不以颜色为唯一信号），条目过多折叠为「还有 N 项」可展开 / 收起，
  点击跳转对应详情，月份切换跨年正确，仅当前月显示「今天」标记；**只读视图**，不提供拖动改期
- 设置页：主题切换（深色 / 浅色 / 暖橙 / 彩色 / 跟随系统）、「清除示例数据」，以及完整的数据管理区域：
  - JSON schemaVersion 1 全量导出；严格 Zod 预检后以“同 ID 跳过”合并或清库替换，所有写入处于单一事务
  - 任务、里程碑、风险 CSV 导出；可选全部项目或单项目范围，UTF-8 BOM、中文表头与中文枚举
  - SQLite 在线备份、完整性校验后还原、还原前自动安全备份、数据库路径与打开数据目录
  - CSV 仅支持导出，不支持 CSV 导入
- 深色优先主题、6 项左侧导航；未实现能力一律为不可点击的「后续阶段」占位卡片
- **Dashboard（严格只读）**：进行中项目的真实完成率、今日/未来 7 天/逾期未完成任务、未来 7 天会议及其未完成行动项、
  今日/逾期/未来 30 天（含第 30 天）的未达成 milestone；展示四类实时派生风险（逾期未完成、临期低进度、
  blocked 依赖传导、14 天内 milestone 前置未完成），每项都可导航到来源任务或 milestone
- **风险**：`/risks` 支持项目/状态/等级/分类筛选与标题/描述搜索，默认将开放、监控风险置顶；
  可从风险页或项目详情的风险区创建、编辑、删除。字段包括项目归属、分类、可能性、影响、实时自动等级、
  状态、负责人、缓解计划和截止日期；状态机为 open → monitoring/closed，monitoring → mitigated/closed，
  mitigated/closed → open，进入已缓解/已关闭会写入 `resolved_at`
- **文件与链接**：项目详情同页 `#project-links` 支持 URL/Windows 本地路径的完整 CRUD、复制与安全打开；
  service 层只允许 `http/https` 交给官方 opener，Rust command 在打开本地路径前检查存在性且不读取文件内容

尚未具备（后续版本）：

- 甘特图内的里程碑菱形、关键路径与拖拽排期
- 提醒通知、数据库位置迁移
- **任务归档界面**：迁移 0002 已添加 `tasks.archived_at`，查询与完成率也已正确排除归档任务，
  但**仍不提供任务归档 / 恢复的界面入口**，该字段目前只由 schema、查询和完成率口径使用

后续阶段见 [docs/development-plan.md](docs/development-plan.md)。开发遵循的硬性质量规则：

- TypeScript strict mode，禁止 `any`
- 页面不散落 SQL，一律经 repository/service 层
- UI 数据必须来自真实 SQLite，最终不保留 mock 数据
- 危险操作二次确认；所有表单 Zod 校验
- 显式处理空状态、加载状态、数据库错误、日期错误与无效输入
- 未来 AI 功能只能是用户确认后写入数据的辅助层（详见 architecture.md 安全边界）

## 作者与许可证

Made by **Racliu** · [rliubp@connect.ust.hk](mailto:rliubp@connect.ust.hk)
本项目使用 [MIT License](LICENSE)，Copyright (c) 2026 Racliu。
