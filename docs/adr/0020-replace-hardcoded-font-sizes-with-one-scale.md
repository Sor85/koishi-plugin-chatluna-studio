# 用一份九档字号标度取代逐处硬编码的字号

WebUI 的字号统一从 `client/styles/chatluna-studio-tokens.css` 的九档标度取值：`--chatluna-studio-font-3xs` 9px、`2xs` 10px、`xs` 11px、`sm` 12px、`md` 13px、`lg` 14px、`xl` 16px、`2xl` 18px、`3xl` 24px。等宽字体栈同样收敛成单个 `--chatluna-studio-font-mono`。工作区根节点与每个 teleport 浮层各自显式落一个 `font-size: var(--chatluna-studio-font-md)` 基准。

改造前的问题不是"值太多"，而是**根节点没有基准字号**。Koishi 控制台只在 `body` 上设过 `font-family`，从未设过 `font-size`，浏览器默认的 16px 会一路继承进 `.chatluna-studio-workspace`。于是任何漏写 `font-size` 的节点都渲染成 16px，而它周围的兄弟节点是作者手写的 11~13px。实测单个模型请求页上有 141 个文本节点落在这条 16px 继承链上：页面副标题、请求列表项的机器人名、详情概览的元信息键值，以及工具定义行。Tailwind preflight 的 `small { font-size: 80% }` 又在这条链上派生出 12.8px 这样不属于任何档位的值。

工具定义行是这套失效最刺眼的一处：工具名、描述、属性统计三段文本都没写字号，前两段一起继承成 16px，第三段被 `small` 变成 12.8px。等宽 Latin 在 16px 下 x 高度只有约 8.7px（JetBrains Mono 通常没有安装，实际命中 Menlo），而同字号的 CJK 字面高度接近 16px 满格，所以"描述看起来比工具名大得多"是光学事实而不是错觉——两者字号其实完全相同。单纯把整行降到 13px 不能消除这种光学差，必须让三段各占一档：名称 `md` > 描述 `sm` > 统计 `xs`，字号层级才和颜色层级说同一件事。

头像首字母刻意留在标度之外。它是几何量而不是排版档位，字号必须跟着圆形直径走，因此改为 `clamp(9px, calc(var(--chatluna-studio-avatar-size) / 3), 32px)` 在使用点求值。这个公式不能提取成令牌：自定义属性的 `var()` 在**声明它的元素**上就完成替换，把公式写进 `chatluna-studio-tokens.css` 会让 `var(--chatluna-studio-avatar-size)` 永远解析成工作区上的缺省 38px。下限 9px 保证 18px 的表态头像和 20px 的调试头像仍能认出字母，上限 32px 防止资料页 96px 头像的字母顶到圆边。改造前这 8 处头像各写一遍，写出了 9/10/10.667/12.667/24/25.333/28/32px 八个互不相干的值，其中三个分数值恰好就是直径的三分之一——公式本来就存在，只是被展开成了魔数。

标度定义必须列出全部渲染根：`.chatluna-studio-page`，以及 Dialog / Popover / Select / Tooltip / 右键菜单 / 浮动二级页 / 合并转发弹层 / 图片预览这些 teleport 到 `body` 的浮层。它们不在工作区的继承树里，漏掉任何一个，那棵子树里的 `var(--chatluna-studio-font-*)` 会解析失败并静默退回继承字号——失败形态和改造前一模一样。清单存放在 `scripts/studio-style-roots.mjs`（同一份清单还决定 Tailwind preflight 的作用域，见 ADR 0068），`tests/studio-style-roots.test.ts` 断言 CSS 里的选择器列表与它逐项一致。这条纪律是补上的：本决策初版只列了八个根，漏掉了 `dialog-overlay`、`tooltip-content`、合并转发弹层与图片预览，合并转发弹层里的 `--chatluna-studio-font-lg` 与 `--chatluna-studio-font-md` 因此解析失败并退回 16px。

shadcn 组件保留自己的 `text-sm`（14px）默认值，不做覆盖。它们是标准控件，覆盖尺寸会破坏 registry 组件 1:1 还原；14px 也已经在标度上（`lg`），只是密度比本插件的 13px 正文略松。

`tailwind.generated.css` 的 preflight 曾把 `line-height: 1.5` 和 `font-family` 写在未作用域限定的 `html` 选择器上，这是本插件对整个控制台的全局副作用。工作区因此不再依赖它：`.chatluna-studio-workspace` 自己写死 `line-height: 1.5`。preflight 的作用域问题本身由 ADR 0068 处理。
