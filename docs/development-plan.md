# ProjectPilot 开发计划（阶段 0 制定）

## 1. 阶段划分

| 阶段                  | 目标                                                                   | 关键交付                                                                                                                                                                                                                                                                                                                                                                  | 出口条件                                                  |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **0（已完成）**       | 产品与架构规划                                                         | 本仓库全部 docs；无代码、无依赖                                                                                                                                                                                                                                                                                                                                           | 用户确认规划                                              |
| **1（已完成）**       | 工程骨架与持久层地基                                                   | Tauri 2 + Vite + React + TS strict + Tailwind + shadcn/ui 初始化；SQLx SQLite 默认启用外键，Rust `execute_batch` 再显式启用；migration 0001（8 表 + 索引 + 触发器）；Rust `execute_batch` 原子命令与备份/恢复/打开目录命令桩；repository 层 + Zod row schemas；`lib/date.ts`；capabilities 最小授权（lint、类型检查、测试均在本地验证，CI 延后至发布阶段）                | 空应用可启动，DB 落在 app config 目录，全部 repo 单测通过 |
| **2（已完成）**       | 项目 + 任务核心                                                        | 项目 CRUD/归档/恢复/永久删除（级联事务）；任务 CRUD、两层父子、筛选/搜索/排序/批量修改；done→100 / cancelled 规则；空/加载/错误态；示例数据种子与清除                                                                                                                                                                                                                     | 流程 A/B 可走通（除 Gantt）                               |
| **3（已完成）**       | 依赖 + Gantt（自研 SVG）                                               | task_dependencies 创建/删除 + 加边防环（migration 0003 触发器兜底同项目与直接反向边）；dependencyGraph.ts（构图/防环/Kahn/前驱后继/blocked 传导/排期冲突）；ganttViewModel + 纯 SVG renderer（周/月/季轴、时间条、依赖线、今日线、冲突高亮、图例；菱形留待阶段 4）                                                                                                        | Gantt 稳定正确，检测全通过单测                            |
| **4（当前，已完成）** | 会议 + 行动项 + Milestone + 日历                                       | 迁移 0004（纯增量：`meetings.start_time`、`idx_milestones_date`、防重复转换与审计触发器）；会议 CRUD（可关联项目或独立）+ 会议详情页；行动项 CRUD + 一键转任务（`execute_batch` 单事务、防重复、双向关联、独立会议需选目标项目）；milestone CRUD + 香港时区倒计时/逾期 + 关联任务全完成仅提示（绝不自动改状态）；日历月视图（三类条目文字区分、折叠展开、跨年切换、只读） | 流程 C 闭环走通（Windows 本机 tauri dev/build 待验证）    |
| **5**                 | Dashboard + 风险                                                       | 今日/本周/逾期、30 天 milestone、项目完成率、四类风险卡                                                                                                                                                                                                                                                                                                                   | 风险规则与 product-spec §5.2 完全一致                     |
| **6（已完成）**       | 数据口 + 设置                                                          | JSON 全量导入导出（原子）；单项目 CSV（UTF-8 BOM）；SQLite 备份/恢复（自动预备份 + 二次确认）；主题三态；数据目录；关于页                                                                                                                                                                                                                                                 | 流程 D 自动化测试通过；JSON 往返无损                      |
| **7（进行中）**       | 打磨与发布                                                             | 版本统一、发布文档、千级数据性能基准、GitHub Actions Windows NSIS 构建与 Release 资产；Windows 真机安装验收保留为发布后确认                                                                                                                                                                                                                                               | 自动质量门和 Windows 工作流通过；真机项有明确记录         |
| **8+（后续版本）**    | Gantt 拖拽（切 SVAR 适配器）、AI 建议层（见 architecture.md §10 边界） | —                                                                                                                                                                                                                                                                                                                                                                         | —                                                         |

依赖关系：2 依赖 1；3 依赖 2；4/5 依赖 2（5 的 blocked 传导依赖 3）；6 依赖 1–5 数据全形态。

## 2. 测试计划

### 2.1 单元测试（Vitest）

- `dependencyGraph.ts`：自环、二元环、长链环、菱形无环、跨项目边、blocked 传导、空图、断链
- `lib/date.ts`：UTC+8 午夜边界（模拟系统时区非香港）、逾期/今日/本周判定、月末/闰年、无效输入
- service 业务规则：done→100、cancelled 剔除完成率、两层限制、milestone 只提示不改、转任务映射默认值
- `GanttViewModel`：三档刻度、坐标换算、无日期任务过滤、冲突标注
- 导入导出：JSON round-trip 等值、CSV 字段快照

### 2.2 组件测试（React Testing Library）

- 表单 Zod 校验（必填、日期格式、start≤due）
- 空/加载/错误态渲染与重试
- ConfirmDialog 二次确认流（取消不产生副作用）
- 行动项按钮态：未转换"转为任务"（提交中禁用并显示"转换中…"）/ 已转换"查看任务" / 任务已删"任务已删除"
- 里程碑提示：关联任务全部完成时选"否"不产生任何写入（读库回验状态与 `achieved_at` 未变）
- 日历：月份切换（含跨年）、忙日折叠展开、三类条目的文字类型标签与跳转链接、只读说明

### 2.3 集成测试（临时 SQLite）

- 外键级联全链路：删项目后无孤儿行
- UNIQUE(converted_task_id) 与重复点击转换（并发模拟）→ 仅一次成功
- execute_batch 中途失败 → 全部回滚
- 触发器：三层父子被 ABORT
- migration 幂等重跑

### 2.4 手动 / E2E（阶段 6–7）

- 备份→改数据→恢复→数据回到备份点，且恢复前自动备份存在
- Windows 10/11 安装、启动、数据目录定位、WebView2 引导
- 千级任务 Gantt/列表滚动流畅度

## 3. 依赖候选清单（阶段 0 不安装）

| 用途                    | 候选                                                                                                   | 理由                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| 脚手架                  | `create-tauri-app`（Tauri 2 + React-TS + Vite 模板）                                                   | 官方模板                                     |
| SQLite bridge           | `@tauri-apps/plugin-sql`（sqlite feature）                                                             | 官方；migration 内建；事务缺口由自写命令补   |
| Rust SQLite（原子命令） | `rusqlite`                                                                                             | 事务/savepoint 完备，drop 默认回滚           |
| 单实例                  | `tauri-plugin-single-instance`                                                                         | 防双开写库                                   |
| 打开文件/目录           | `tauri-plugin-opener`                                                                                  | 安全打开 URL/路径；禁止 shell 拼接命令       |
| 文件对话框              | `tauri-plugin-dialog`                                                                                  | 备份/恢复选路径                              |
| UI                      | shadcn/ui（CLI 拷贝进仓库）+ Tailwind CSS                                                              | MIT、代码归本仓库、主题三态                  |
| 路由                    | `react-router`                                                                                         | 固定栈                                       |
| 状态                    | `zustand`                                                                                              | 固定栈；分域 store                           |
| 表单                    | `react-hook-form` + `zod` + `@hookform/resolvers`                                                      | 固定栈                                       |
| 日期                    | `date-fns`（必要时 `@date-fns/tz`）                                                                    | 固定栈；date-only 策略下核心是自封装 todayHK |
| 图标                    | `lucide-react`                                                                                         | 固定栈                                       |
| 测试                    | `vitest` + `@testing-library/react` + `@testing-library/user-event` + `jsdom`                          | 固定栈                                       |
| Lint/格式               | `eslint`（typescript-eslint, strict）+ `prettier`                                                      | 禁 any 落地为规则                            |
| CSV                     | 自写序列化（字段少）或 `papaparse`                                                                     | 避免不必要依赖，优先自写                     |
| Gantt                   | **无**（自研 SVG）；升级候选 `@svar-ui/react-gantt`（MIT，使用前复核）；降级候选 `frappe-gantt`（MIT） | 见 architecture.md §3                        |

明确不引入：任何云数据库 SDK、状态机库、重型表格库、必须付费的 Gantt 库。

## 4. 交付与打包路线

- Linux 沙箱承担编码、Vitest/RTL 与 SQLite 集成测试；Windows 真机负责安装体验和系统集成验收。
- 推送 `v*` tag 后，GitHub Actions 在 `windows-latest` 执行完整质量门、构建 NSIS，并创建带 SHA-256 文件的 GitHub Release。
- NSIS 使用 Tauri WebView2 Offline Installer，保证未安装 WebView2 时无需网络即可安装，但安装包体积更大。
- 版本号已统一为 1.0.0；正式支持平台为 Windows 10/11 x64。
