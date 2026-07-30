# ProjectPilot 验收清单

> 标记：[ ] 尚未确认 / [x] 已由所列自动化测试、静态源码审计或真实环境记录确认。发布不要求机械勾满：
> 数据完整性、核心 CRUD、迁移、导入导出、备份恢复逻辑、构建与 CI 必须有通过证据；Windows 安装、默认
> opener 和真机体验必须如实保留为待验。每个未勾项目均附原因、阻塞环境和最小验证操作。

## 阶段 1：骨架与持久层

- [ ] 应用冷启动进入空 Dashboard，无控制台错误。原因：产品首次启动会有意写入示例数据，不能按“空 Dashboard”验收；阻塞环境：Windows 安装包；最小操作：干净安装后检查启动、示例项目和控制台。
- [ ] 数据库文件位于 Tauri app config 目录（设置页可显示并打开该目录），源码目录无任何 .db。原因：`app_config_dir` 和打开目录命令已静态审计，实际 Windows 路径/打开行为未验；阻塞环境：Windows 真机；最小操作：设置页显示并打开目录，确认源码树无数据库。
- [x] SQLite plugin 所用 SQLx 连接默认启用 `foreign_keys`，Rust `execute_batch` 也显式启用（静态审计：`src-tauri/src/atomic.rs`；`sqlx-sqlite 0.8.6` 默认配置）；真实迁移约束由 `tests/repositories/persistence.test.ts` 覆盖。
- [x] migration 0001 建成 8 张表、索引和触发器，0001–0006 按版本顺序加载且测试 harness 使用原始 SQL（证据：`src-tauri/src/migrations.rs`、`tests/repositories/persistence.test.ts`、`migration0002/0003/0004.test.ts`）。
- [x] `execute_batch` 的全回滚契约由事务实现静态审计并由 `tests/services/task.service.test.ts` 的 batch-failure 测试覆盖。
- [x] 页面、组件和 stores 不直接执行 SQL；SQL 位于 repositories、migration 与受限 Rust 原生命令（静态 `rg` 审计）。
- [x] `npm run typecheck`、`npm run lint` 通过；strict/no-explicit-any 配置和源码均已审计。
- [x] `npm run test` 通过（Vitest/RTL，57 files、616 tests）。

## 阶段 2：项目与任务

- [x] 项目创建、编辑和查看字段由 `tests/services/project.service.test.ts` 及 `tests/components/ProjectListPage.test.tsx` 覆盖。
- [x] 归档、活动筛选和恢复由 `tests/services/project.service.test.ts` 覆盖。
- [x] 永久删除前显示任务、会议、里程碑和文件/链接的真实数量，且级联后无关联行（证据：`tests/services/project.service.test.ts`、`tests/components/ProjectListPage.test.tsx`）。
- [x] 任务 CRUD、两层层级、UI 校验和 DB 触发器由 `tests/services/task.service.test.ts`、`tests/components/TaskForm.test.tsx` 和 `tests/repositories/persistence.test.ts` 覆盖。
- [x] done 进度与撤回编辑由 `tests/services/task.service.test.ts` 覆盖。
- [x] cancelled/archived 任务的完成率口径由 `tests/services/project.service.test.ts`、`tests/services/projectProgress.test.ts` 覆盖。
- [x] 筛选、搜索、排序和带确认的批量修改由 `tests/repositories/taskQuery.test.ts`、`tests/components/TaskFilters.test.tsx`、`tests/components/BulkEditDialog.test.tsx` 覆盖。
- [ ] 空项目已有自动化覆盖，但任务工作区的慢查询/坏库错误态未完整覆盖；阻塞环境：补充自动化场景；最小操作：为任务页注入 pending/rejecting executor 并断言空、加载、错误与重试。
- [ ] 清除示例数据保留真实数据已由 `tests/services/sampleData.test.ts` 覆盖，但“示例”徽标无直接断言；阻塞环境：补充 RTL 场景；最小操作：种入 sample 行并断言徽标，再清除并复查真实行。

## 阶段 3：依赖与 Gantt

- [x] FS 依赖、自环/成环中文错误由 `tests/services/dependency.service.test.ts`、`tests/components/DependencySection.test.tsx` 覆盖。
- [x] 跨项目依赖的 UI/service 拒绝和 migration 0003 触发器由 `dependency.service.test.ts`、`migration0003.test.ts` 覆盖。
- [x] 反向边触发器和长度 ≥3 的 service 防环由上述 dependency/migration 测试覆盖。
- [x] 归档任务拒绝建边且不改写任务状态由 `tests/services/dependency.service.test.ts` 覆盖。
- [x] 排期冲突显示、修复消失和缺失日期无伪冲突由 `dependency.service.test.ts`、`GanttSection.test.tsx` 覆盖。
- [x] 受阻风险为派生数据且不写 `tasks.status`，由 `tests/services/dependency.service.test.ts` 覆盖。
- [x] 删除依赖确认、取消无副作用与状态保持由 `tests/components/DependencySection.test.tsx` 覆盖。
- [x] 周/月/季度、跨年刻度与今日线由 `tests/features/ganttViewModel.test.ts` 覆盖。
- [x] 状态文字/图例与箭头端点由 `tests/components/GanttSection.test.tsx`、`ganttViewModel.test.ts` 覆盖。
- [x] milestone 菱形仍为后续阶段占位，由 `tests/components/GanttSection.test.tsx` 覆盖。
- [x] 无开始日期的说明和无截止日期的单日条由 `tests/features/ganttViewModel.test.ts` 覆盖。
- [ ] 横向滚动和窄屏原生布局未自动化；阻塞环境：Windows 真机；最小操作：960px 最小宽度及更窄窗口逐档滚动、空项目和错误态检查。
- [ ] 任务编辑后 Gantt 即时刷新的跨组件集成场景未直接覆盖；阻塞环境：补充 RTL 集成测试；最小操作：编辑日期/状态并断言风险与图模型刷新。
- [x] `dependencyGraph`/`GanttViewModel` 单测通过；1000 任务 benchmark（`tests/performance/releaseBenchmark.test.ts`）对图和 Gantt 均设 <100ms。

## 阶段 4：会议、行动项、Milestone、日历

- [x] 会议 CRUD、独立会议和 `start_time` 的 Zod/DB 双重拒绝由 `tests/services/meeting.service.test.ts`、`tests/components/MeetingsPage.test.tsx`、migration 0004 覆盖。
- [x] 删除会议的真实行动项数、级联、转换任务保留和取消无写入由 `meeting.service.test.ts`、`MeetingsPage.test.tsx` 覆盖。
- [x] 行动项 CRUD 与会议详情入口由 `tests/services/actionItem.service.test.ts`、`tests/components/ActionItemSection.test.tsx` 覆盖。
- [x] 转换字段映射、跳转和 `source_meeting_id` 反查由 `tests/services/actionItem.service.test.ts`、`MeetingDetailPage.test.tsx` 覆盖。
- [x] 独立会议必须选项目及取消无写入由 `tests/services/actionItem.service.test.ts` 覆盖。
- [x] 转换中禁用和快速重复点击仅生成一项由 `tests/services/actionItem.service.test.ts` 覆盖。
- [x] 防重复转换、删除目标后的终态显示由 `tests/services/actionItem.service.test.ts` 覆盖。
- [x] 失败回滚、无孤儿 task 及受影响行数不足回滚由 `tests/services/actionItem.service.test.ts` 覆盖。
- [x] 里程碑 CRUD 和归档项目禁写由 `tests/services/milestone.service.test.ts`、`tests/components/MilestoneSection.test.tsx` 覆盖。
- [x] Asia/Hong_Kong 倒计时/逾期显示由 `tests/services/milestoneStatus.test.ts` 覆盖。
- [x] 关联任务完成只提示、选择保持状态不写入由 `tests/services/milestone.service.test.ts` 覆盖。
- [x] 里程碑删除确认、关联任务保留和取消无副作用由 `tests/components/MilestoneSection.test.tsx` 覆盖。
- [x] 日历三类条目的中文标签由 `tests/features/calendarModel.test.ts`、`tests/components/CalendarPage.test.tsx` 覆盖。
- [x] 忙日折叠/展开与导航由 `tests/components/CalendarPage.test.tsx` 覆盖。
- [x] 跨年翻月与仅当前月今日标记由 `tests/features/calendarModel.test.ts` 覆盖。
- [x] 日历只读说明及无改期入口由 `tests/components/CalendarPage.test.tsx` 覆盖。
- [ ] 会议详情的数据库错误重试没有直接测试；阻塞环境：补充 RTL 场景；最小操作：为详情查询注入 reject 并断言中文错误与重试。其余三个区域的加载/空/错误状态已有对应组件测试。

## 阶段 5：Dashboard 与风险

- [x] Dashboard 只读、0/7 天边界、跨月/闰年和 terminal/archived 排除由 `tests/services/dashboard.service.test.ts` 覆盖。
- [x] 近期会议与一次有界行动项查询由 `tests/services/dashboard.service.test.ts` 覆盖。
- [x] milestone 当天/逾期/30 天边界及 terminal 排除由 `tests/services/dashboard.service.test.ts` 覆盖。
- [x] 进行中项目完成率口径由 `tests/services/dashboard.service.test.ts`、`tests/services/projectProgress.test.ts` 覆盖。
- [x] 四类派生风险由 `tests/services/dashboard.service.test.ts` 的构造数据覆盖。
- [x] Dashboard 导航和无写入控件由 `src/features/dashboard/pages/DashboardPage.tsx` 静态审计确认。
- [x] 风险筛选、搜索和排序由 `tests/repositories/riskQuery.test.ts`、`tests/services/risk.service.test.ts` 覆盖。
- [x] RiskForm 的字段、中文校验、等级预览和保存错误由 `tests/components/RiskForm.test.tsx` 覆盖。
- [x] `/risks` 与项目详情创建/编辑/删除入口经 `RisksPage.tsx`/`RiskSection.tsx` 静态审计；状态迁移和 `resolved_at` 由 `tests/services/risk.service.test.ts` 覆盖。

## 阶段 6：数据口与设置

- [x] JSON 导出、清库、等值导入（依赖/转换/设置）由 `tests/services/dataTransfer.integration.test.ts` 覆盖。
- [x] 非法 JSON/版本拒绝、零副作用、预览与二次确认由 `dataTransfer.rejection.test.ts`、`SettingsPage.dataTransfer.test.tsx` 覆盖。
- [ ] CSV 的 UTF-8 BOM、中文字段和公式保护由 `csvExport*.test.ts` 覆盖，但真实 Windows Excel 打开未验；阻塞环境：Windows+Excel；最小操作：导出单项目和全部项目 CSV 并用 Excel 打开核对字符与单元格公式。
- [ ] 备份/恢复逻辑、完整性检查和确认由前端测试与 Rust 源码审计覆盖，但 Rust 原生测试无法在本 Linux 缺少 `glib-2.0` 时编译；阻塞环境：Windows CI/真机；最小操作：执行 `cargo test --manifest-path src-tauri/Cargo.toml`，再备份、恢复并重启核对数据。
- [x] 五种主题即时切换及 `app_settings` 持久化由 `tests/lib/theme.test.ts`、`tests/services/settingsPreference.service.test.ts` 覆盖。
- [ ] Files & Links 的真实默认浏览器和 Windows opener 行为无法由 mock/单测替代；阻塞环境：Windows 真机；最小操作：分别验证 https、javascript/file/data/mailto、存在与不存在路径及复制提示。
- [ ] 设置页真实显示/打开 Windows 数据目录未验；阻塞环境：Windows 真机；最小操作：点击“打开数据目录”，核对路径和目录窗口。

## v1.1：人物、参与人、已推迟、并行甘特与文件

- [x] migration 0008 在含数据 0007 旧库上保持 projects/tasks 行数与关键字段，完整恢复索引和触发器；
      `postponed` CHECK 接受合法值并拒绝非法值（`tests/repositories/migration0008.test.ts`）。
- [x] `postponed` 自由切换、完成率分母、Dashboard 四类提醒排除、逾期排除和依赖传导语义由
      project/task/dashboard/progress/date/dependency 测试覆盖；项目/任务 service 未新增状态迁移校验。
- [x] 并行甘特的状态筛选、跨月跨年、缺日期兜底及项目跳转模型由
      `tests/features/parallelGanttViewModel.test.ts` 覆盖。
- [x] 人物搜索/CRUD/删除影响确认与项目→任务二级详情、多展开、三种来源和未归属分组由
      `PeoplePage.test.tsx`、`PersonDetailPage.test.tsx` 覆盖。
- [x] 任务参与不会写项目关系，项目移除不会删任务分配，非项目成员提示与显式加入由
      `people.service.test.ts`、`TaskForm.test.tsx`、`ProjectParticipantsSection.test.tsx`、
      `TaskDetailPage.test.tsx` 覆盖。
- [x] 项目/任务参与人 OR 筛选各自只读取对应关联表，且批量读取每类只执行一次查询，由
      `tests/repositories/participantFilters.test.ts` 覆盖。
- [x] `/files` 的聚合筛选、CRUD、项目跳转及既有 http/https/本地路径安全规则由
      `FilesPage.test.tsx`、`projectLink.service.test.ts` 覆盖；未修改 capability。
- [x] 10 项导航顺序、路由映射、嵌套详情高亮和“任务”文案由 `AppLayout.test.tsx` 覆盖。
- [x] JSON 旧文件兼容及人员三表往返、独立关系恢复、重复/缺失引用降级，以及项目/任务 CSV
      独立参与人列由 dataTransfer/csvExport 测试覆盖。
- [ ] Windows 默认程序打开、窄窗口视觉与备份恢复仍需真机确认。最小操作：在 Windows 10/11
      依次打开 http/https、复制非白名单协议、打开存在/不存在的盘符与 UNC 路径；将窗口缩窄并遍历
      10 项导航；备份后修改人员与两类参与关系，再恢复并重启核对。

## 全局质量（发布门槛）

- [ ] 全界面简体中文及日期格式尚无全局审计；阻塞环境：补充静态/RTL 审计；最小操作：遍历路由与日期格式快照，人工抽查设置、项目、任务、会议、风险页。
- [ ] 危险操作的代表性确认与取消无副作用已有 `ConfirmDialog.test.tsx`、`BulkEditDialog.test.tsx`、`SettingsPage.dataTransfer.test.tsx` 覆盖，但尚无穷尽审计；阻塞环境：补充矩阵测试；最小操作：逐项执行取消并回读数据库。
- [ ] 生产 UI 无 mock 数据残留尚无专门静态审计；阻塞环境：补充审计；最小操作：对 `src/` grep mock/fixture/placeholder 并人工确认命中均非生产数据。
- [ ] 各主要表单已有 Project/Task/Meeting/Risk 的 Zod 测试，但非全部表单的内联错误审计；阻塞环境：补充 RTL；最小操作：逐表单输入非法值并断言内联中文错误。
- [x] `npm run typecheck`、`npm run lint` 与 `npm run test` 通过（57 files、616 tests）；版本一致性由 `tests/lib/releaseMetadata.test.ts` 覆盖。
- [ ] 第二实例聚焦由 `src-tauri/src/lib.rs` 静态审计确认，但未在打包程序中运行；阻塞环境：Windows 真机；最小操作：双击启动两次并确认仅一实例且首窗口聚焦。
- [ ] 1000 任务的纯模型 benchmark 已通过（阈值 <100ms），但 ≤3 秒 Windows 冷启动和真实交互未验；阻塞环境：Windows 真机；最小操作：冷启动计时并执行列表/Gantt/日历操作。
- [ ] Windows 10/11（含无 WebView2）安装尚未真机验收；阻塞环境：两台目标机器；最小操作：安装、升级、卸载并核对离线 WebView2、SQLite 保留和启动。
