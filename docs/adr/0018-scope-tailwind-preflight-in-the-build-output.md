# 在构建产物上给 Tailwind preflight 加作用域

`client/styles/tailwind.generated.css` 由 `scripts/build-css.mjs` 生成：先跑 `@tailwindcss/cli`，再用 `scripts/scope-preflight.mjs` 把 `@layer base`（preflight）里的每条选择器限制到本插件的渲染根内。`package.json` 的 `build:css` 与 `scripts/watch-server.mjs` 都必须走这个入口；直接调用 CLI 会让产物回到无作用域状态。

Tailwind preflight 整块都是无作用域的类型选择器：`*`、`html`、`h1`~`h6`、`a`、`ol, ul, menu`、`img, svg, video, canvas...`、`button, input, select, textarea`、`small`、`table`。Koishi 控制台把所有插件的样式表加载进同一个文档，因此这些规则会重置整个控制台和同页其他插件的 UI——把标题字号压平成继承值、去掉列表符号、把行内 SVG 变成块级、清掉按钮的背景与圆角。这不是理论风险：探针在控制台活动栏的 88 个元素上确认过，改造前它们全部拿到了本插件的 preflight，改造后是 0 个。

改造前这条泄漏在当前环境里看不出症状，因为同一个控制台里还有另外两个插件也注入了各自的无标准作用域 preflight（22071 与 20305 字符两份），它们互相掩盖：单独停用本插件的 preflight 时，控制台页面 1491 个节点一个都不变。决定修的理由不是当下的可见收益，而是本插件不应该是三个污染源之一——另外两个不在本仓库的控制范围内，它们一旦修好或被卸载，本插件就会成为唯一的可见污染源。

Tailwind v4 没有"给 preflight 加作用域"的配置项，社区做法是把 `@import "tailwindcss"` 展开后省掉 preflight，再手抄一份带作用域的副本。这里不采用手抄：副本会随 Tailwind 升级静默漂移。改成在 CLI 产物上做一次机械改写，preflight 因此始终与已安装的 Tailwind 版本同步。

作用域用 `:where(...)` 包裹，这一点是必需的而不是风格选择：preflight 必须停留在特异性最低层，否则会压过组件自身的样式。`:where()` 不贡献特异性，所以 `:where(根列表) small` 与原来的 `small` 都是 0-0-1。`*` 与伪元素要各生成两条（`:where(根) *` 与 `:where(根)`），因为渲染根自身也需要 `box-sizing` 与 `border-style` 重置。

`html, :host` 那条整条丢弃，不做改写。它把 `font-family` 设成 Tailwind 的 `--font-sans`（-apple-system 栈）；改造前这条声明落在 `html` 上，被 Koishi 的 `:root { font-family: var(--font-family) }` 以更高特异性压住，所以插件 UI 实际用的是控制台主题字体。一旦把它改写到渲染根上，特异性比较不再发生（两条规则匹配的是不同元素），插件 UI 会从 PingFang SC 跳到 -apple-system。它剩下的可用部分很少：`-webkit-text-size-adjust` 只对页面生效，`font-feature-settings`/`font-variation-settings` 解析结果就是初始值 `normal`。真正需要保留的 `line-height: 1.5`、`tab-size: 4`、`-webkit-tap-highlight-color: transparent` 改为在 `client/workspace/workspace.css` 与 `client/styles/chatluna-studio-primitives.css` 里显式声明。`::backdrop` 同样丢弃：它只作用于 top layer 元素，而本插件的浮层都是普通元素。

渲染根清单存放在 `scripts/studio-style-roots.mjs`，被三处消费：preflight 作用域改写、`chatluna-studio-tokens.css` 的排版标度令牌、`chatluna-studio-primitives.css` 的浮层基准字号。清单里除了 Koishi k-layout 的主容器 `.chatluna-studio-page`，还有十个 teleport / Portal 到 `body` 的浮层根——它们不在页面容器的继承树里。这个清单会腐化，而且两种失效形态都是静默的（`var(--chatluna-studio-font-*)` 解析失败退回 16px，或子树整体失去 preflight），所以 `tests/studio-style-roots.test.ts` 同时断言两份 CSS 的选择器列表与清单逐项一致、每个浮层的根标识都在清单里，并用计数守卫兜住新增浮层。上一版排版改造就漏掉了四个根（`dialog-overlay`、`tooltip-content`、合并转发弹层、图片预览），合并转发弹层里的 `--chatluna-studio-font-lg` 与 `--chatluna-studio-font-md` 因此解析失败并退回 16px。

代价是产物里作用域列表被重复很多次：未作用域 41,558 字符，改写后 80,034 字符。这份文件被 gitignore，没人直接阅读，而重复内容压缩率极高——最终 bundle 的 gzip 体积从 34.76 KB 增到 35.64 KB。为省这 0.9 KB 而改成给每个浮层加一个统一的标记属性（把作用域缩短成单个选择器）会把成本转移到十来处模板上，并不划算。

`@layer theme` 仍然把 `--font-sans`、`--spacing`、`--text-*`、`--color-*` 定义在 `:root, :host` 上，这一层没有限定作用域。自定义属性本身不会重置任何东西，只对读取它们的一方有意义，因此不构成可见污染；但如果同页其他插件也在 `:root` 上定义同名 Tailwind 主题变量且取值不同，后加载的一方会同时影响双方的工具类。真要处理需要把 `[data-slot="dialog-overlay"]` 这类只带工具类的浮层一并纳入作用域，否则 `bg-slate-950/35` 会因为取不到 `--color-slate-950` 而失效。这一项留在范围之外。

`watch:css` 脚本删除。Tailwind 的 `--watch` 会绕过后处理，留一个名字带 watch 却只能跑一次的脚本更容易误用；开发期的持续重建本来就由 `watch:server` 负责（见 `scripts/watch-server.mjs` 顶部注释）。
