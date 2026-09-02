# 在 ChatLuna 公共 fetch 边界捕获模型请求

ChatLuna 没有统一的模型请求体事件，且不同适配器可能绕过 `ModelRequester.post`。模型请求采集在本插件内包装 ChatLuna 公共 HTTP fetch 边界，按已知聊天模型路径过滤并在插件销毁时恢复，不修改 `chatluna` 或 `chatluna-character`；这样可以覆盖不同适配器，同时避免依赖私有 requester 字段。
