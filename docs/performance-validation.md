# 性能诊断与验收

## 本轮 Linux 基线

环境：Linux 6.17.0 Azure x86_64、AMD EPYC 9V74、15.6 GiB、Node 24.18.0。以下仅是
in-memory SQLite/Node 基线，不代表 Windows WebView2。

| 路径与规模 | 修改前 | 修改后 |
| --- | --- | --- |
| 任务详情关联区，1000 会议/500 关联，派生列表 | p50 2.208 ms，p95 2.442 ms | p50 0.040 ms，p95 0.090 ms |
| 打开任务关联区 | 3 次查询 | 2 次查询 |
| 新增任务—会议关联 | 7 次查询/写入（含全量 reload） | 3 次查询/写入，本地可靠更新 |
| 移除任务—会议关联 | 4 次查询/写入（含全量 reload） | 1 次写入，本地可靠更新 |
| 会议系列异常加载，R 个规则 | 2R 次查询 | 1 次批量查询 |
| 导出快照 18 张表 | 18 次串行等待 | 18 次并发只读；延迟 executor 峰值并发 18 |
| `task_meetings`，1000 任务/1000 会议/20000 关联 | 未提供双向实体查询 | 按任务 p50 0.370 ms；按会议 p50 0.423 ms |
| 候选任务搜索 | 无会议侧入口 | 100/500/1000 条 p50 0.470/2.474/4.718 ms，最多渲染 100 条 |

`EXPLAIN QUERY PLAN`：

- 按任务：`SEARCH tm USING INDEX idx_task_meetings_task (task_id=?)`。
- 按会议：`SEARCH tm USING INDEX idx_task_meetings_meeting (meeting_id=?)`。
- 两侧实体表均通过主键索引 `SEARCH`；排序使用临时 B-tree。每个关联集合仅约 20 行，实测未证明需增加排序索引，因此没有新增性能索引。

关联候选一次批量读取，不会逐任务或逐会议查询。pointermove 仅在命中行改变时更新 React
状态，不写 SQLite；pointerup/drop 仍只提交一次。开发态事件缓冲上限为 5000，避免诊断自身导致
内存持续增长。

## 开发态诊断

诊断仅在 Vite development 构建启用。Windows Tauri 调试窗口的 Console 中执行：

```text
window.projectPilotPerformance.start("任务详情-关联会议")
// 执行待测操作
window.projectPilotPerformance.stop()
```

结果按 React commit、SQLite 语句和 Rust IPC 命令汇总次数、总耗时和最大耗时；支持时同时返回
`usedJsHeapBytes`。SQL 只记录语句，不记录绑定值。事件超过 5000 条会丢弃最早记录并增加
`droppedEventCount`。

## Windows/Tauri 人工验收

本轮 Linux 沙箱不能运行 Windows WebView2，**Windows/Tauri 性能尚未验证**。PR 必须保持
Draft，直至完成以下步骤：

1. 在 Windows 用 `npm run tauri dev` 启动，使用固定数据集：1000 个任务、1000 个会议、20000
   个 `task_meetings`。
2. WebView2 DevTools Performance 各录制一次首次打开、重复打开、tab 切换、搜索、范围筛选、
   动态/自定义排序、拖拽、弹窗打开关闭和保存；保存 trace 与诊断快照。
3. 覆盖项目列表/详情/归档恢复，任务活动/归档/全部与详情各区块，会议列表/普通会议/周期系列/
   单次 occurrence，Calendar、提醒、导入/导出/merge/replace。
4. 对任务详情关联会议、会议新建关联任务、会议编辑关联任务分别确认：候选加载为两次查询以内；
   单次增加为一次写入；移除为一次写入；无逐候选请求。
5. 拖拽时持续移动 10 秒，确认 pointermove 为零 SQLite 写入，pointerup 仅一次
   `execute_batch`/保存写入；取消拖拽为零写入。
6. Browser Task Manager 与 Windows Task Manager 记录空闲、操作后、返回空闲 5 分钟的内存；
   连续执行页面切换和弹窗开关 20 次，确认监听器、timer 和 heap 不持续单调增长。
7. 导入、导出和 replace-import 用相同大数据集操作；确认 UI 仍可响应、关系完整、失败时无半成功。
8. 必要时用 WPR/ETW 录制 CPU、UI delay、Disk I/O；报告硬件、Windows/WebView2 版本、数据规模、
   主线程长任务、React commit、IPC/查询次数、SQLite 耗时和内存前后值。

## 已审计但未在 Linux 发现新增瓶颈的路径

- 项目归档/恢复和任务批量修改继续使用 Rust `execute_batch`，没有循环 IPC。
- Calendar、Dashboard、提醒按日期范围读取；系列主会议实体被日期查询显式排除，不会产生重复事件。
- 自定义排序只在提交移动后持久化；listener 在完成、取消、禁用及组件卸载时清理。
- 任务进展、待办和资源未改变数据流；固定六色进展调色板未修改。
- 导入/导出、merge 和 replace 仍以 `task_meetings` 为唯一关系来源，并保持外键过滤和事务语义。

这些项目仍需按上述 Windows 步骤做真实交互验证，不能以 Vitest 结果代替。
