# 归属由 ChatLuna 的对话生命周期事件判定，并发时宁可记成未归属

模型请求在 ChatLuna 的公共 fetch 边界上被采集（[ADR-0005](./0005-wrap-chatluna-fetch-for-model-request-records.md)），那一层看不到任何会话信息。归属因此来自另一个来源：ChatLuna 与 chatluna-character 自己发出的对话生命周期事件（`chatluna/before-chat`、`after-chat`、`after-chat-error`、`chatluna_character/before-chat`、`after-chat`），它们带着触发这轮对话的 Koishi session，而一轮对话里的全部模型请求都发生在开始与结束之间。

**恰好一轮在跑时才归属。** 群聊高峰期多轮并发时，fetch 边界上无法分辨这次请求属于哪一轮，此时记成未归属。错误的归属比明确的未归属贵得多：它会同时让预设证据定位（[ADR-0011](./0011-edit-upstream-presets-and-link-runtime-evidence.md)）、同会话轨迹聚合（[ADR-0007](./0007-derive-model-request-trajectories-on-read.md)）与会话筛选一起说谎，而用户没有任何手段发现这条记录挂错了会话。

**一轮对话共享一个交互标识。** 工具调用循环里一轮对话会发出多次模型请求，交互标识让它们在轨迹里聚成一组；chatluna-character 与核心链路可能为同一轮各报一次开始事件，后一次只刷新会话实体，不换标识。

代价是并发场景下的记录会落进「未归属」，需要用户自己按时间与模型对照。换来的是每条带归属的记录都可以被当作事实使用——包括被预设页面用来证明某个表达式在真实请求里展开成了什么。

上游错误只出现在对话链路的错误事件里，而 fetch 层只看得到 HTTP 失败，因此错误回填也由跟踪器发出（[ADR-0010](./0010-attach-chatluna-errors-to-model-requests.md)）：错误事件只带 ChatLuna 内部会话标识，把它还原成（机器人，会话）的映射住在跟踪器里，而收尾会紧接着删掉那份映射。两个监听器的执行顺序不受控，所以「先解析再收尾」必须在同一处完成。
