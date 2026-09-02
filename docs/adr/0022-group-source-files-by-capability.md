# 源码与样式按能力分目录，不按文件类型

`src/` 与 `client/` 都按能力分目录：`model-request/`（记录采集、投影与页面）、`preset/`（预设仓库、服务与页面）、`chatluna/`（与 ChatLuna 运行时打交道的那几处）、`model-evidence/`（共享证据投影）、`workspace/`（页面 shell 与跨区域规则）、`shared/`（跨能力的视图工具）。区域样式表跟着能力走：`client/model-request/styles.css`、`client/preset/styles.css`，只有跨能力的令牌、原语、浮层与断点留在 `client/styles/` 与 `client/workspace/`。

归属按引用关系判定，不按名字。被多个能力引用的视图工具（头像、滚动条、时间格式化、证据定位与导航）进 `shared/`；只有一个能力消费的模块进那个能力的目录，即使它的名字里带别的词。

**样式表跟着能力走的代价是加载顺序不再从路径看出来。** 顺序本身是级联的一部分，因此入口 `client/style.css` 的 `@import` 列表就是唯一的顺序声明，`tests/client-styles.test.ts` 断言它与磁盘上的样式表一一对应——磁盘上多出一张没被引用的表时，它不会生效也不会报错。

换来的是「改一个能力只动一个目录」：抽离、删除或替换某个能力时，它的服务端模块、客户端模块、样式表与端口三件套在同一处，不需要跨五个按类型划分的目录去找。
