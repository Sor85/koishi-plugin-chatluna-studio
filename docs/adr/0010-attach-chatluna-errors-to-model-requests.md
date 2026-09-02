# 将 ChatLuna 规范错误附加到模型请求记录

模型请求 HTTP 采集边界只能直接证明 HTTP 状态、响应原文和传输异常；ChatLuna 的规范错误码、面向用户的错误消息与 `originError` 要到 `chatluna/after-chat-error` 才产生。每个工作室控制服务使用 ChatLuna 内部会话 ID 关联自身的活动工作室会话，并且只在该 ID 唯一对应一个活动机器人/逻辑会话时，把安全提取后的错误码、消息、原始原因和 timeout 标记附加到同一逻辑会话最近的失败模型请求；无法唯一归属时不猜测。WebUI 的可能原因只按 ChatLuna 官方错误码文档映射，裸 HTTP 状态和供应商响应继续作为原始证据展示，不被提升为 ChatLuna 诊断结论。
