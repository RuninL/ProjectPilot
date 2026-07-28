# ProjectPilot 架构设计（阶段 0）

> 本文是三个前沿模型（Claude Opus 4.8 / GPT 5.5 / Gemini 3.1 Pro）独立规划后的综合决策版本。分歧裁决记录见仓库外的 model-council-synthesis.md。

## 1. 总体分层

```
┌─────────────────────────────────────────────────────┐
│ UI 层  pages / components（shadcn/ui, 只调 hooks）    │
├─────────────────────────────────────────────────────┤
│ Store 层  Zustand 分域 store（UI 状态 + 轻缓存）       │
├─────────────────────────────────────────────────────┤
│ Service 层  领域用例、业务不变式、事务编排、Zod 校验     │
├─────────────────────────────────────────────────────┤
│ Repository 层  每表一个 repo，唯一 SQL 出现处，          │
│                查询结果经 Zod 收窄为强类型              │
├─────────────────────────────────────────────────────┤
│ DB 客户端  tauri-plugin-sql 单例 + 自写 Rust 原子命令   │
├─────────────────────────────────────────────────────┤
│ SQLite（Tauri app data 目录, PRAGMA foreign_keys=ON） │
└─────────────────────────────────────────────────────┘
```

依赖方向严格自上而下；React 页面禁止直接出现 SQL；真相永远在 SQLite，store 只做 UI 状态与失效标记。

## 2. 持久层策略（关键决策）

### 2.1 已核实的插件能力边界

| 能力           | 现状                                                          | 来源                                                                     |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Migration      | 支持（Rust 端 Migration{version, description, sql, kind}）    | [Tauri SQL 插件文档](https://v2.tauri.app/plugin/sql/)                   |
| execute/select | 支持，`$1..$n` 参数绑定                                       | 同上                                                                     |
| 事务           | **无一等公民封装**；issue #886 自 2024 年起 Open              | [Issue #886](https://github.com/tauri-apps/plugins-workspace/issues/886) |
| 类型安全       | select 返回无类型，需前端收窄                                 | 插件 guest-js 源码                                                       |
| 权限           | 默认只含读取/load/close；`execute` 需显式 `sql:allow-execute` | [Tauri SQL 插件文档](https://v2.tauri.app/plugin/sql/)                   |

**核心陷阱**：插件底层是 sqlx 连接池，前端裸发 `BEGIN`/`COMMIT` 可能被分派到不同物理连接，事务边界失效、回滚不可靠（#886 报告的现象）。因此任何多语句写操作都不能依赖前端拼事务。

### 2.2 决策：混合持久层

| 场景                            | 通道                                                                                         | 理由                 |
| ------------------------------- | -------------------------------------------------------------------------------------------- | -------------------- |
| 单表 CRUD、查询、Dashboard 聚合 | tauri-plugin-sql `select/execute`                                                            | 官方维护、样板少     |
| **必须原子的多语句写**          | 自写 Rust `#[tauri::command] execute_batch(statements)`：单连接内 BEGIN…COMMIT，出错整体回滚 | 绕开连接池事务陷阱   |
| Schema migration                | 插件 Migration（Up/Down，幂等）                                                              | 官方机制             |
| 备份/恢复/打开数据目录          | 自写 Rust command（文件操作 + 连接管理）                                                     | 需要文件锁与关闭连接 |

必须走原子命令的操作（白名单）：

1. 行动项转任务（INSERT task + UPDATE action_item）
2. 项目永久删除的级联清理
3. 全量 JSON 导入（清空 + 重建 8 张表）
4. 清除示例数据（跨表删除 is_sample=1）
5. 批量修改任务（N 条 UPDATE）

**纵深防御**：Tauri capabilities 按最小授权配置——主窗口仅开放 `sql:allow-load/select/execute` 与白名单自定义命令；不开放插件的任意数据库路径加载。

**降级预案**：若 execute_batch 仍不满足（如需要行级回读逻辑），按触发条件整体迁移到 Rust command + rusqlite（事务/savepoint 完备，drop 默认回滚）。触发条件：事务压测失败、备份恢复需更强文件锁、需要精确 SQLite 错误码映射。

### 2.3 Repository / Service 约定

- 每张表一个 repository（`task.repo.ts` 等），方法输入输出均为强类型领域对象
- 插件 select 返回值在 repository 内立即经 **Zod row schema `.parse()`** 收窄——这是全项目唯一允许出现 unknown→类型转换的边界，从而满足 strict + 禁 any
- service 持有业务不变式：done→progress=100、cancelled 剔除完成率、两层父子校验、milestone 只提示不自动改、转任务防重复
- 所有写操作 service 先 Zod 校验再落库；错误统一映射为 `AppError`（用户可读文案 + 可重试标记）

## 3. Gantt 架构（关键决策）

### 3.1 决策：自研 SVG 渲染 + 可插拔适配器

```
GanttData（纯领域数据: bars[], milestones[], links[], conflicts[]）
   → GanttViewModel（纯函数: 像素坐标、周/月/季刻度、今日线、冲突标注 — 可单测）
   → GanttRenderer（可替换实现: SvgRenderer ← 第一版 | SvarAdapter | FrappeAdapter）
```

理由（三模型共识）：

- 第一版只需"正确稳定"的只读时间轴 + 日期编辑，自研 SVG 约 400–600 行，零运行时依赖、零许可证风险、可快照测试
- 循环/冲突/跨项目检测是业务逻辑，永远由自己的 `dependencyGraph.ts` 持有，与渲染库解耦——"Gantt 是领域模型的投影，而不是让 Gantt 库成为领域模型"

阶段 3 落地形态：`src/features/gantt/ganttViewModel.ts`（纯函数，日期进、像素出）+
`src/features/gantt/components/GanttChart.tsx`（无状态 SVG 渲染 + 图例）+
`GanttSection.tsx`（档位切换与加载/空/错误态）。milestone 菱形留到阶段 4，
本阶段只保留标记为「后续阶段」的占位，不伪造图元。

### 3.2 升级与降级路径

| 路径                        | 选择                                   | 条件与注意                                                                                                                                                  |
| --------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 升级（需要拖拽/自动排期时） | SVAR React Gantt（npm 包 2.4+ 为 MIT） | 只依赖 npm 包，**不得复制其 GPLv3 demo 仓库代码**；不得依赖 PRO-only 功能（auto-scheduling、critical path、baselines、export、undo/redo）；使用前复核许可证 |
| 降级（自研遇性能/工期瓶颈） | frappe-gantt（MIT，稳定但节奏慢）      | 需自写 React wrapper；milestone 菱形需叠层实现                                                                                                              |
| 排除                        | gantt-task-react                       | 2022 年后停止维护，弃养风险                                                                                                                                 |
| 极限降级                    | Tailwind 绝对定位进度条（无依赖线）    | 保底可视化，不阻塞发布                                                                                                                                      |

## 4. 依赖图与检测算法

**位置：前端 TypeScript 内存图**（三模型共识）。SQLite 只负责持久化边与外键；个人量级（千级任务）内存 O(V+E) 足够，纯函数便于 Vitest 覆盖。

| 检测                 | 算法                                                                                                               | 时机                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| 循环依赖（全图）     | Kahn 拓扑排序（同时产出合法顺序，供未来自动排期）                                                                  | 载入 Gantt、导入数据时                                |
| 加边即时防环         | 从 successor 出发 DFS/BFS 判断 predecessor 可达性，可达则拒绝                                                      | 创建/编辑依赖时（阻止保存）                           |
| 排期冲突（FS 语义）  | 对每条边 A→B：两端日期齐全且 `A.due_date > B.start_date` 即冲突（缺日期不产生伪冲突）                              | Gantt 与依赖列表红色虚线 + 文字说明                   |
| 跨项目依赖           | 遍历边比较两端 project_id；migration 0003 触发器在 DB 层兜底                                                       | UI 禁止创建；对导入产生的存量数据警示标记             |
| blocked 传导         | 从 status=blocked 节点正向可达集合（跳过已归档前驱，忽略 done/cancelled/archived 后继）；纯派生，不写 tasks.status | 依赖列表与 Gantt 的「受阻风险」提示、Dashboard 风险区 |
| Milestone 前置未完成 | milestone 关联任务的前驱链存在非 done 任务且 14 天内                                                               | Dashboard 风险区                                      |

## 5. 日期与时区策略

**原则：业务日期是"日历日"（date-only），不掺时区；只有审计时间戳用 UTC。**

- 业务日期存 `TEXT 'YYYY-MM-DD'`；created_at/updated_at 存 UTC ISO-8601
- "今天" = Asia/Hong_Kong 本地日历日。实现用 `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' })` 取日期字符串——**禁止** `new Date().toISOString().slice(0,10)`（那是 UTC 日，UTC+8 午夜后 8 小时内会差一天）
- 所有判定用字符串比较（`YYYY-MM-DD` 字典序 = 日期序，SQLite 与 JS 均成立）：
  - 逾期：`due_date < today` 且 status ∉ {done, cancelled}
  - 今日到期：`due_date === today`；本周：date-fns `startOfWeek/endOfWeek`（weekStartsOn: 1）
  - 倒计时：`differenceInCalendarDays`
- 统一入口 `lib/date.ts`：`todayHK() / isOverdue() / isDueToday() / formatDisplay() / parseInput()`；**全应用禁止裸用 new Date() 做业务日期**（ESLint 约定强制）
- 无效日期由 Zod 在表单层拦截（格式 regex + 真实日期校验）；null 日期渲染"未设置"

## 6. 状态管理（Zustand 分域）

| Store                | 内容                                           |
| -------------------- | ---------------------------------------------- |
| `useAppStore`        | 主题、侧栏、全局错误、dbReady                  |
| `useProjectStore`    | 项目列表缓存、activeProjectId、归档过滤        |
| `useTaskFilterStore` | 筛选/搜索/排序/批量选择（UI 态，不含数据本体） |
| `useGanttStore`      | 视图档位、可见范围、选中任务、冲突覆盖层       |
| `useDashboardStore`  | 风险卡缓存 + 失效标记                          |

原则：store 存"UI 状态与轻缓存"；写操作走 service→repository→DB，成功后失效重查。表单草稿由 React Hook Form 管理，不进 store。禁止最终保留 mock 数据。

## 7. 目录结构（推荐）

```
projectpilot/
├── src/                          # React 前端
│   ├── main.tsx / App.tsx / router.tsx
│   ├── lib/                      # db.ts(单例+PRAGMA) date.ts uuid.ts errors.ts cn.ts
│   ├── db/
│   │   └── schemas.ts            # Zod row schemas（repository 用）
│   ├── repositories/             # 每表一个 repo，唯一 SQL 出现处
│   ├── services/                 # 领域用例 + 事务编排 + dependencyGraph.ts
│   ├── stores/                   # Zustand 分域 store
│   ├── features/                 # 按领域分 UI：projects/ tasks/ dashboard/
│   │                             #   meetings/ milestones/ gantt/ calendar/
│   │                             #   links/ settings/（各含 components/ hooks/ pages/）
│   ├── components/ui/            # shadcn/ui 组件（代码归本仓库）
│   ├── components/common/        # EmptyState ErrorState LoadingState ConfirmDialog
│   └── types/                    # 领域类型（从 Zod infer）
├── src-tauri/                    # Rust 侧
│   ├── src/
│   │   ├── main.rs / lib.rs
│   │   ├── migrations.rs         # 插件 Migration 注册（SQL 用 include_str! 外置）
│   │   ├── atomic.rs             # execute_batch 原子命令
│   │   └── backup.rs             # 备份/恢复/打开数据目录命令
│   ├── migrations/               # 0001_init.sql ...
│   ├── capabilities/             # 最小权限配置
│   └── tauri.conf.json
├── docs/
└── tests/                        # 跨层集成测试
```

## 8. 错误与状态处理

- 四态组件化：`EmptyState / LoadingState / ErrorState`（含重试）统一复用
- `AppError` 分类：ValidationError（表单内联）、DbError（toast + 重试）、NotFoundError（跳转空态页）、ConflictError（如重复转换，提示并刷新）
- 危险操作（永久删除、恢复、导入、清示例、批量修改）一律 ConfirmDialog 二次确认，文案明示影响范围
- 数据库初始化失败：阻断进入主界面，显示数据目录路径与修复指引

## 9. 风险与降级策略汇总

| 风险                      | 概率 | 影响           | 缓解 / 降级                                             |
| ------------------------- | ---- | -------------- | ------------------------------------------------------- |
| 插件事务不可靠（#886）    | 高   | 高（数据损坏） | 多语句写全走 Rust 原子命令；预案整体迁 rusqlite         |
| select 无类型             | 高   | 中             | repository 层 Zod 收窄，unknown 不出边界                |
| Gantt 自研延期            | 中   | 中             | 降级 frappe-gantt；极限降级纯 CSS 时间条                |
| SVAR 许可证/PRO 边界误用  | 低   | 中             | 只依赖 MIT npm 包；不依赖 PRO 功能；使用前复核          |
| SQLite 外键默认关闭       | 高   | 高             | 每连接 PRAGMA + 启动断言（查询 pragma 值不为 1 则报错） |
| 时区差一天                | 中   | 中             | date.ts 统一 + 禁裸 new Date + UTC+8 午夜单测           |
| 两层父子被绕过            | 中   | 中             | DB 触发器 + service 双重校验                            |
| 恢复损坏当前库            | 低   | 高             | 恢复前自动备份 + 二次确认，全程 Rust 命令内完成         |
| WebView2 缺失（旧 Win10） | 低   | 中             | Tauri 安装器引导安装 WebView2 运行时                    |
| 双开写库冲突              | 低   | 中             | tauri-plugin-single-instance                            |

## 10. 未来 AI 功能安全边界（硬规则）

1. **纯建议层**：AI 产出（会议纪要提取行动项、任务拆分建议、风险摘要）一律为草稿，填充到普通表单/预览 UI
2. **写路径唯一**：必须用户显式确认后，经现有 service→repository→事务链路写入；AI 无任何直接 DB 权限
3. **同规则约束**：AI 发起的写入走同一套 Zod 校验、二次确认、删除/归档规则
4. **可审计**：被采纳的 AI 写入记录来源标记（预留 origin 字段），含用户确认时间
5. **数据主权**：默认零外发；若未来接云端模型须设置页显式开关并明示外发范围，优先本地模型（如 Ollama）；密钥不入业务数据库
6. **最小读取**：AI 只能读取用户明确选择范围内的数据，禁止后台轮询全库
