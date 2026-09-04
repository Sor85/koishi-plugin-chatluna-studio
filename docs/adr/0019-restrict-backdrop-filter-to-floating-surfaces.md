# 工作区层禁用 backdrop-filter，毛玻璃只出现在浮层

CSS 规范（Filter Effects Level 2）规定带 `backdrop-filter` 的元素形成 Backdrop Root 边界：其内部后代的 `backdrop-filter` 采样不到边界外的内容，覆盖其上的兄弟浮层在重叠区域同样采样不到它的输出。Chromium 与 Firefox 均按此实现。最小复现验证：嵌套在 `backdrop-filter` 祖先内的面板模糊完全失效；覆盖在 `backdrop-filter` 兄弟区域上的面板在重叠区完全不模糊；纯半透明（无 filter）容器则两种场景均正常。

此前工作区本体 `.chatluna-studio-workspace.is-frosted` 与四个一级区域（rail、会话列表、聊天区、详情栏）都声明了 `backdrop-filter`，导致：一级区域的模糊嵌套在工作区内本来就不生效；工作区内部的毛玻璃控件（消息发送控件、消息多选栏、消息搜索面板）全部静默退化为纯半透明；teleport 到 body 的浮层（通知面板、查看资料、贴表情、Dialog/Popover/Select/右键菜单）覆盖在这些区域上时模糊同样失效。开启毛玻璃开关反而杀死了所有浮层毛玻璃，且工作区自身的模糊在控制台纯色背景上没有可见收益。

因此约定：**工作区本体与一级区域只允许半透明背景叠层，禁止声明 `backdrop-filter`；模糊只出现在浮层与控件层**（二级面、右键菜单、发送控件、多选栏等）。新增一级布局区域或全屏容器时不得引入 `backdrop-filter`，否则会静默破坏其上所有浮层的毛玻璃。全屏遮罩同理：雾化对话框由面板自身模糊背景，遮罩在毛玻璃外观下必须关闭 `backdrop-filter`（保留暗化），否则遮罩会成为面板与工作区内容之间的 Backdrop Root 边界。Popover/Dialog 等可能再嵌套 Select 的容器，必须把 `backdrop-filter` 放到 `::before` 上，让容器本身不成为 Backdrop Root，嵌套下拉才能继续雾化；不得把嵌套下拉改成不透明实心来“绕过”失效的模糊。

毛玻璃开关（`enableStudioFrostedGlass`）统一由 `useFrostedSurfaceFlag` 写入 `body[data-studio-frosted]`，teleport 到 body 的面板据此在实体态与雾化态之间切换，不再为每个浮层组件传递 frosted prop；工作区内元素仍可使用 `.chatluna-studio-workspace.is-frosted` 后代选择器。通知面板沿用组件内 `is-frosted`/`is-plain` 状态类，两种标记的语义一致。

约束的边界是「区域元素自身」而不是「工作区这个文件」：工作区内小面积的浮起表面（覆盖式表头、悬浮导航栏卡片）可以雾化，条件是把 `backdrop-filter` 放在无后代的 `::before` 上、宿主元素自己让出实心底色。这样宿主不成为 Backdrop Root，其内部控件的模糊不受影响；表面本身面积小，覆盖其上的浮层即使在重叠区少掉一层采样也看不出差别。实测（Chromium 与 Firefox，在高对比条纹背景上测量卡片内亮度标准差）：卡片 `::before` 的模糊在两个引擎都生效，`position: fixed` 浮层压在卡片上时自身模糊没有退化。禁令仍然完整适用于工作区本体与四个一级区域——它们铺满视口，一旦成为边界就会拖垮其上所有浮层。
