# 插件样式不落在宿主根节点上

客户端样式的声明只能落在本插件自己的根节点上。`html`、`body`、`#app` 属于宿主表面，只能当限定条件用（`body[data-chatluna-studio-color-scheme="dark"] .chatluna-studio-page` 这种形态），不能当选择器主体。需要满视口时取 `100vh`，不要去改地基。`tests/client-styles.test.ts` 按选择器主体判定，判定面包含 `.vue` 里的 scoped 块。

**为什么这条要靠守卫而不是文档。** 越界的代价不由本插件承担。控制台把所有插件的客户端样式打进同一张表，写到宿主根节点上的声明会同时作用在别人的页面上，而本插件页面照样正常——自查看不出任何异常。真实形态是这样一条规则：

```css
html, body, #app { min-height: 100%; }
```

控制台自己给地基写的是 `body { min-height: 100vh }`。插件这条同特异性、后加载的声明把它盖掉了；而百分比 `min-height` 要拿 `html` 的高度求值，`html` 是 `auto`，百分比在 auto 高度的包含块上退化成 `auto`——`body` 于是彻底失去高度下限塌成 0，`#app` 跟着塌。同一个控制台里另一个插件的页面根容器是 `position: absolute` + `overflow: hidden`，包含块 0 高度让它自己也变成 0 高度，整页内容被裁掉：DOM 完整、控制台零报错、页面一片白。本插件页面取 `100vh` 不受影响，所以这条规则在仓库里活了很久。

**`:global()` 是同一类越界，形态更隐蔽。** scoped 块里 `@vue/compiler-sfc` 命中 `:global()` 会把整条选择器替换成括号里的第一段，`:global(.dark) .studio-badge[data-variant='secondary']` 编译出来是裸的 `.dark { … }`：一边漏成全局规则去染控制台里任何带该类名的元素，一边把真正想选中的那一段整段丢掉，「样式没生效」和「污染了别人」同时发生。因此 scoped 块一律不用 `:global()`，暗色钩子写 `[data-color-mode="dark"]` 或 `body[data-chatluna-studio-color-scheme="dark"]`；Portal 浮层的样式走 `client/workspace/overlays.css` 这类无作用域表。

代价是本插件失去了「借地基撑高度」这条捷径：满视口高度必须由 `.chatluna-studio-page` 自己用 `100vh` 声明，`--footer-height` 这类宿主变量也只能在本插件的容器上清零而不能在 `body` 上改。与 [ADR-0018](./0018-scope-tailwind-preflight-in-the-build-output.md) 限定 preflight 作用域、[ADR-0021](./0021-use-one-css-namespace.md) 收敛命名空间是同一件事的三个面：本插件与 chatluna-sandbox 可能同时装进同一个控制台，凡是「不报错、只让别人静默变样」的越界都必须由守卫拦住。
