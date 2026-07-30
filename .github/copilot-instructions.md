# ProjectPilot 开发约定

## 项目性质

完全离线的 Windows 桌面应用。Tauri v2 + React + TypeScript + SQLite。中文 UI。

## 提交纪律（最重要）

- 每完成一个子任务立即 commit 并 push，绝不积压到最后一次性推送
- commit 信息需清晰标明完成了哪一项
- 若某项失败，先提交已完成部分，再报告失败项，不要回滚已完成工作
- 交付以「提交已推送到远端」为准

## 架构红线

- 页面、组件、store 中不得出现 SQL；数据访问必须走 repository/service
- 不修改已有 migration，只新增
- 不扩展 Tauri capability
- 不新增 any / @ts-ignore / @ts-nocheck / eslint-disable
- 不删除、跳过或弱化现有测试
- 保持完全离线，不引入联网、遥测、推送

## 状态语义

- 项目状态：active / on_hold / postponed / completed / archived
- 任务状态：todo / in_progress / blocked / postponed / done / cancelled
- 不引入项目/任务状态机，状态可自由切换
- 状态不得仅靠颜色表达，必须同时有文字或图标

## 参与人规则

- 任务参与人与项目参与人完全独立
- 分配任务参与人时绝不自动写入 project_participants
- 任务筛选只依据 task_participants，项目筛选只依据 project_participants

## 安全规则

- 链接仅 http/https 可打开，其他协议只能复制
- 本地路径必须为 Windows 绝对路径且存在后才调用 opener

## 执行纪律

- 质量门逐条执行：npm ci / format:check / lint / typecheck / test / build / git diff --check
- 单条命令超过 5 分钟未结束则停止、记录并继续
- 同一失败命令重试不超过 2 次
- 性能基准只运行一次
- 不运行长耗时 E2E
