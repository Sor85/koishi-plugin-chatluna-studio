## Agent skills

### Issue tracker

Issue 使用仓库内的本地 Markdown 文件管理，存放在 `.scratch/<feature>/`。参见 `docs/agents/issue-tracker.md`。

### Triage labels

使用默认的五类 Triage 标签。参见 `docs/agents/triage-labels.md`。

### Domain docs

本仓库采用单上下文领域文档布局，领域词汇位于根目录 `CONTEXT.md`，架构决策位于 `docs/adr/`。参见 `docs/agents/domain.md`。

### 与 chatluna-sandbox 的关系

本插件的界面与领域实现从 `koishi-plugin-chatluna-sandbox` 抽离而来，两个仓库各自独立演进。从那边搬运代码时必须同时完成三件事，否则两个插件装在同一个 Koishi 控制台里会互相影响：

- CSS 类名一律改成 `chatluna-studio-` 前缀（参见 `docs/adr/0021-use-one-css-namespace.md`，有守卫测试）。
- Console 端点名一律改成 `chatluna-studio/` 前缀。
- 去掉记录域、AI 测试空间、场景、参与者这些沙盒概念：本插件只有一个记录库，会话来自真实 OneBot（参见 `docs/adr/0001-keep-all-model-requests-in-one-library.md`）。

### 未发布阶段兼容策略（首次公开发布后删除本节）

本插件尚未公开发布。在首次公开版本发布前，修改领域模型、内部接口、Console RPC 或 WebUI 状态时，不需要为仓库中尚未发布的旧实现保留兼容层。

- 直接删除已废弃的字段、类型、fallback、迁移逻辑和别名。
- 同步更新所有调用方、测试、领域文档和架构决策。
- 不得以「可能存在旧数据」为理由保留双状态、双字段或新旧协议并行实现。
- 仅当用户明确要求兼容某个已经投入使用的外部数据或接口时，才允许增加迁移逻辑。
- npm 首次公开发布成功后，应删除本节；从该版本开始再按正式版本兼容策略处理变更。本地构建、Git 提交、GitHub Release、预览环境和测试安装均不视为首次公开发布。
