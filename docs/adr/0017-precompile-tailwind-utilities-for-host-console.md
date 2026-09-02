# 预编译 Tailwind 工具类以脱离宿主编译能力

Koishi 控制台 devMode 会用宿主自身的 vite 直接加载本插件的 `client/` 源码，而宿主 vite 没有也不应要求安装 Tailwind 插件。若样式入口写 `@import "tailwindcss"`，devMode 下只会注入未编译的原始包 CSS，本插件的工具类永远不会生成；页面上偶尔"生效"的 `size-8`、`p-0` 等实际来自宿主里其他插件打包的同名类，缺一个类就烂一块，且随宿主插件组合变化而不可复现。

因此 Tailwind 工具类必须预编译：`client/styles/tailwind.source.css` 是唯一的 Tailwind 编译入口（含 `@theme inline` 的 shadcn 语义映射与 `dark` 自定义变体），由 `yarn build:css` 通过 `@tailwindcss/cli` 输出 `client/styles/tailwind.generated.css`（已 gitignore）；`client/style.css` 只以普通 CSS 方式引入该产物。devMode（宿主 vite）与产物构建（本仓库 vite lib 构建）消费同一份静态文件，观感一致。`vite.config.ts` 不使用 `@tailwindcss/vite`，样式入口不得直接 `@import "tailwindcss"`。修改组件类名或语义映射后必须重新运行 `yarn build:css`（或挂 `yarn watch:css`），`build:client` 已内置该步骤。

shadcn 语义变量默认值与宿主兼容规则放在 `client/styles/shadcn-theme.css`，以普通 CSS 生效。宿主控制台的全局样式不在任何 cascade layer 内，而 Tailwind 工具类位于 `@layer utilities`，按级联规则无 layer 永远优先于有 layer，因此宿主对 `table`/`tr`/`td, th` 的全局分隔线与内边距必须在日历范围内用同样无 layer 的规则归零，其中 `tr:last-child` 需要单独一条更高特异度的规则。宿主里其他插件可能携带无 layer 的 Tailwind v3 产物（如静态值的 `.rounded-md`），会压过本插件同名工具类，radius 标度需在本插件表面范围内用无 layer 规则显式恢复。

控制台 devMode 的 vite 以 `?v=hash` immutable 缓存头下发模块，动态 import 的模块不受普通刷新影响；验证样式改动前除了重启宿主进程，还必须清空浏览器缓存（或硬性绕过），否则旧样式模块会被误判为代码缺陷。
