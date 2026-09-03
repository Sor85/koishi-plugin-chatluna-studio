# koishi-plugin-chatluna-studio

在 Koishi 控制台里查看 ChatLuna 的真实模型请求，并直接编辑 ChatLuna 与 chatluna-character 的预设文件。

侧栏入口「ChatLuna Studio」下有两个页面：**模型请求**与**预设**。页面内左侧是一条悬浮导航栏，平时只显示图标，鼠标悬停或键盘聚焦时向右展开出文字。

## 模型请求

每次真实对话触发的模型调用都会留下一条记录：请求地址与请求头、完整请求体、原样保存的响应原文（JSON / 文本 / SSE 都保留）、HTTP 状态、耗时、Token 用量与错误。

- **归属**：记录会关联到触发它的真实 OneBot 会话——机器人、群或好友、发言者，名称随请求一起快照。多轮对话同时在跑时无法判定归属，这些记录进「未归属」，不会挂到错误的会话上。
- **筛选**：按范围（全部 / 已归属 / 未归属）、机器人、会话、模型名与「仅错误」筛选；可选值来自记录库自身的聚合。
- **分析与轨迹**：请求体按共享的模型证据投影拆成请求消息、工具定义、工具调用与响应，可按单次请求或同一会话的多次请求查看轨迹账本与请求组成。
- **错误**：ChatLuna 的规范错误码会回填到本轮最近一条失败记录上，详情页给出错误码与可能原因。
- **用量**：装了 chatluna-usage 时优先读它的标准化用量，否则从响应体里取。

记录默认存在服务端内存里，重启清空；插件配置可改为 Koishi Database 持久化。条数上限默认 500，超出后从最旧记录开始丢弃。

## 预设

直接读写 `data/chathub/presets` 与 `data/chathub/character/presets` 下的 YAML 文件，保存后由 ChatLuna 自己热重载。

- 编辑器基于 CodeMirror，模板里的表达式（`{name}`）带装饰，可以点开看它在真实请求里展开成了什么。
- 新建、重命名与删除都要显式确认；保存使用修订号做乐观并发，文件在别处被改动时不会被覆盖。
- 有未保存修改时切换页面会先问一句。

## 灵感来源

- 轨迹功能的设计灵感来源于 [DeepSeek Harness（dsh）](https://github.com/deepseek-ai/deepseek-harness)。
- 请求体与响应体的样式来源于 [Axonhub](https://github.com/looplj/axonhub)。
- 界面与领域实现从 [koishi-plugin-chatluna-sandbox](https://github.com/Sor85/koishi-plugin-chatluna-sandbox) 抽离而来；那个插件在模拟 QQ 环境里做同一件事，本插件面向真实 OneBot。

## 安装要求

模型请求采集在 ChatLuna 的 fetch 边界完成，因此需要与 ChatLuna 装在同一个 Koishi 实例里。控制台页面需要 `@koishijs/plugin-console`；持久化模式额外需要 database 服务。

> 两个插件同时安装时，同一次模型请求会被各自记录一份（各自的记录库互不影响）。

## 开发

```bash
yarn install
yarn test
yarn typecheck
yarn build
```
