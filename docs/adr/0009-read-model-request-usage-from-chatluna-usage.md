# 模型请求用量优先读取 chatluna-usage

模型请求详情的输入、输出、推理、缓存、TTFT、TPS 和总耗时优先从 `chatluna-usage` 读取。ChatLuna 已在 `chatluna/model-usage` 中规范化这些字段；继续从 HTTP 响应体猜测会把推理误扣成 0 输出，也拿不到 TTFT/TPS。未安装该插件或匹配不到记录时，才回退到响应体解析。

`chatluna_usage` 不进 `inject`，也不写入 `koishi.service.optional`。该用量服务是 Console `DataService`，Cordis 里的真实服务名是 `console.services.chatluna_usage`，根上下文永远没有 `chatluna_usage`；把它当根服务声明只会让插件配置页固定显示「可选服务: chatluna_usage (未加载)」，而用量其实读得到。用量一律按服务名现取，并在自己的上下文取不到时遍历插件注册表用提供方的上下文再取一次（服务映射被 loader group 隔离）。
