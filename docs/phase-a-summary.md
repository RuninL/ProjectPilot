# 阶段 A 正式总结

## 范围与基线

- 分支：`copilot/v1-2-schedule-and-color-bar`
- 阶段 A 基线：`90b44c467fce7f76c5f50a721d521c71e5ed9b8e`（`Initial plan`；父提交为 `32d3b1bc347eecff58282558348442f1244fd7b1`）
- 总结时最新实现提交：`8aba2b839893af208597498b74a5e2c01171607e`（`fix: preserve recurrence source fields in data transfer inserts`）
- 阶段实现范围（基线至上述实现提交）：39 个文件，1,861 行新增、35 行删除。

本总结提交只记录阶段 A 结论；不包含阶段 B 实现。

## A2–A6 交付

| 章节 | 交付                                                                                                                            | 涉及文件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 新增测试                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A2   | migration `0009`、周期规则/例外两表、任务和会议的来源字段、Rust migration 注册、行 schema、repository/type 基础。               | `src-tauri/migrations/0009_recurrence_rules.sql`、`src-tauri/src/migrations.rs`、`src/db/schemas.ts`、`src/repositories/index.ts`、`src/repositories/recurrence.repo.ts`、`src/types/index.ts`、`tests/helpers/testDb.ts`、`tests/repositories/migration0009.test.ts`                                                                                                                                                                                                                                                                                                     | 初始 1 项 migration 测试；后续扩展为 6 项（详见 migration 小节）。                             |
| A3   | 有界周周期展开（必须有结束日期、500 项上限）、例外应用、周起点与星期编号转换；同时修复 pre-0009 行 schema 兼容与周锚点缺陷。    | `src/services/recurrence.service.ts`、`src/lib/date.ts`、`src/db/schemas.ts`、`tests/services/recurrence.service.test.ts`、`tests/lib/date.test.ts`、`tests/repositories/rowNormalization.test.ts`                                                                                                                                                                                                                                                                                                                                                                        | 3 个展开场景、1 个星期转换场景、1 个周编号场景、2 个 schema 兼容场景。                         |
| A4   | 周期规则创建/读取/删除、例外、任务和会议物化、撤销物化；写入走原子 batch，并把来源字段贯通到任务、会议和行动项服务。            | `src/services/recurrence.service.ts`、`src/services/schemas.ts`、`src/repositories/recurrence.repo.ts`、`src/repositories/task.repo.ts`、`src/repositories/meeting.repo.ts`、`src/services/task.service.ts`、`src/services/meeting.service.ts`、`src/services/actionItem.service.ts`、`src/services/sampleData.service.ts`、`tests/services/recurrence.service.test.ts`                                                                                                                                                                                                   | 5 个输入校验参数化场景，以及物化、撤销、skip、失败回滚 4 项场景。                              |
| A5   | 日历服务合并已物化和预期周期项；日历模型提供来源/预期/已物化文字标记；页面显示 500 项截断提示。                                 | `src/services/calendar.service.ts`、`src/features/calendar/calendarModel.ts`、`src/features/calendar/pages/CalendarPage.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                              | 未新增独立测试；由 A3 展开测试和 A4 物化/例外测试覆盖数据来源与状态。                          |
| A6   | JSON 全量导入导出、replace/merge、CSV 快照、备份恢复校验、示例数据清理全部纳入 recurrence 两表；修复导入遗漏任务/会议来源字段。 | `src/repositories/dataTransfer.repo.ts`、`src/features/settings/data/dataTransfer.schema.ts`、`src/features/settings/services/dataTransfer.service.ts`、`src/features/settings/pages/SettingsPage.tsx`、`src-tauri/src/backup.rs`、`src-tauri/src/backup_tests.rs`、`src/repositories/sample.repo.ts`、`tests/helpers/dataTransferFixture.ts`、`tests/services/dataTransfer.integration.test.ts`、`tests/services/dataTransfer.service.test.ts`、`tests/services/dataTransfer.rejection.test.ts`、`tests/services/csvExport.test.ts`、`tests/services/sampleData.test.ts` | 旧 JSON 兼容 1 项；并扩展全量 replace 往返、merge、清理顺序、CSV、示例清理和备份表白名单断言。 |

测试计数从 675 增至 693（+18）。增量由 migration 0009 六项覆盖、周期展开/星期与 schema 兼容覆盖、规则服务的参数化校验和物化事务覆盖，以及数据交换旧文件兼容与 recurrence 往返覆盖组成；参数化规则校验按独立数据集计入 Vitest 总数。

## 质量门

Node 22 下最终结果：

| 质量门                      | 结果                             |
| --------------------------- | -------------------------------- |
| `npm ci`                    | 通过                             |
| `npm run format:check`      | 通过                             |
| `npm run lint`              | 通过                             |
| `npm run typecheck`         | 通过                             |
| `npm test`                  | 693/693 通过（阶段前为 675/675） |
| `npm run build`             | 通过                             |
| `git diff --check`          | 通过                             |
| CodeQL（JavaScript / Rust） | 0 alerts                         |

## migration 0009：从 1 项到 6 项的验证

1. **升级元数据与旧数据**：在填充完整旧库后运行 migration，验证所有旧表行和既有列保持不变，并验证任务/会议仅追加两个来源列。
2. **继承的 CHECK、触发器、外键和既有索引**：验证任务状态、优先级、进度、日期、工时、示例标志及会议字段约束；验证两层任务触发器、删除项目级联和任务/会议索引。
3. **`recurrence_rules` 约束和索引**：验证类型、星期、间隔、结束日期 CHECK，以及活跃和项目索引。
4. **`recurrence_exceptions` 约束和索引**：验证动作 CHECK、每规则/日期唯一性和查询索引。
5. **级联外键**：验证删除规则会删除例外，删除项目会删除规则。
6. **Rust 注册**：验证 version 9 仅注册一次，且指向 `0009_recurrence_rules.sql`。

## 两个缺陷的根因、修复和覆盖

### Zod schema 缺陷

迁移前的查询结果不含 `source_rule_id` 与 `source_occurrence_date`；新增字段使用仅接受显式 `null` 的 schema，导致 pre-0009 行在 repository 解析时失败。两个字段改为 `nullable().default(null)`，保留显式 `null` 并把缺失字段归一化为 `null`。`rowNormalization.test.ts` 同时覆盖显式 `NULL` 和缺列的任务、会议行。

### 周展开缺陷

初版把 JavaScript 的 Sunday-first 星期编号与应用的 Monday-first 约定混用，且周差计算多算一天，造成非周一规则和隔周锚点偏移。修复为显式转换 helper、以 `mondayWeekdayOf` 计算偏移，并用 `(inclusiveDays - 1) / 7` 计算整周差。测试覆盖全部星期转换、跨年起点、隔周锚点、Wednesday/Sunday 展开、skip/materialized 例外、无结束日期拒绝和 500 项截断。

## 数据交换、CSV、备份和示例数据

- **JSON 导出/导入/replace**：`recurrence_rules` 与 `recurrence_exceptions` 是完整快照的一部分。真实 SQLite 集成测试按表、按字段验证包含示例数据的 replace 无损往返；来源规则和来源日期也被保留。merge 会按 ID 跳过已有行或插入完整新图，replace 按外键反向顺序清库后按拓扑顺序写入。
- **CSV**：CSV 继续只导出项目、任务、里程碑和风险四类平面视图；其输入快照已带有两张 recurrence 表，因此不会破坏快照读取或现有 CSV 导出。
- **备份恢复白名单**：`projects`、`tasks`、`task_dependencies`、`milestones`、`meetings`、`action_items`、`project_links`、`app_settings`、`risks`、`people`、`project_participants`、`task_participants`、`recurrence_rules`、`recurrence_exceptions`。
- **示例数据**：当前示例种子不创建 recurrence rule。清除示例数据会删除 `is_sample = 1` 的规则，依靠外键级联删除其例外；用户规则（`is_sample = 0`）保留，且 `sample_seeded` 标志仍保留，清除的数据不会再次自动出现。

## npm audit：后续技术债

`npm audit --omit=dev` 当前仅有 2 个 moderate：`react-router` 与直接依赖 `react-router-dom@6.30.4`。可用修复是升级到 `react-router-dom@7.18.2`，属于 major/breaking change；涉及应用路由定义、所有 `react-router-dom` 导入和路由/导航组件测试。当前仓库有约 20 个生产文件和约 20 个组件测试文件引用该包，预计需检查约 40 个路由相关文件并重跑完整 UI 测试。该升级明确列为后续技术债，本阶段不处理。

## 用户可见状态

当前已可见：

- 日历会显示周期产生的条目，并以文字显示其来源规则、预期或已物化状态；
- 日历在展开达到 500 项时显示明确的上限提示；
- 已物化的任务或会议可保留来源规则和发生日期，日历可将它们与预期项区分。

当前尚不可见：

- 周期规则创建、编辑、例外维护的用户界面；
- 自动物化的操作入口或周期会议自动排期；
- 计划中的完整日历色条呈现。

这些项目留待阶段 B，经确认后再开始实现。
