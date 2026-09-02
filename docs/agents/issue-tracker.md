# Issue Tracker：本地 Markdown

本仓库的 Issue 和需求规格文档存放在 `.scratch/` 中。

## 约定

- 每个功能使用独立目录：`.scratch/<feature-slug>/`
- 规格文档为：`.scratch/<feature-slug>/spec.md`
- 每个实现任务使用独立文件：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`
- Issue 从 `01` 开始编号，不得合并成一个统一的任务列表文件
- Triage 状态记录在 Issue 文件顶部附近的 `Status:` 字段中
- 评论和讨论历史追加到文件底部的 `## Comments` 标题下

## 发布到 Issue Tracker

当 Skill 要求“发布到 Issue Tracker”时，在 `.scratch/<feature-slug>/` 下创建对应文件；目录不存在时一并创建。

## 获取相关 Issue

读取用户指定的文件路径或 Issue 编号对应的文件。

## Wayfinding 操作

`/wayfinder` 使用一个 Map 文件和多个子任务文件：

- Map：`.scratch/<effort>/map.md`
- 子任务：`.scratch/<effort>/issues/NN-<slug>.md`
- `Type:` 可使用 `research`、`prototype`、`grilling` 或 `task`
- `Status:` 可使用 `claimed` 或 `resolved`
- `Blocked by: NN, NN` 表示任务依赖
- 依赖的所有任务均为 `resolved` 后，当前任务才解除阻塞
- 从编号最小的未阻塞、未领取任务开始处理
- 开始工作前，将 `Status:` 修改为 `claimed`
- 完成后在 `## Answer` 下追加结果，将状态修改为 `resolved`
- 最后把结果摘要和文件链接追加到 `map.md` 的 Decisions-so-far
