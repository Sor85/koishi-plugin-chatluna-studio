# CSS 命名空间只有一套：`chatluna-studio-`

全部业务类名写 `chatluna-studio-` 前缀。第二套 `studio-` 只属于 `client/components/ui/` 里 shadcn-vue 封装写死的类名（其中四个还是 Portal 内容根，见 `scripts/studio-style-roots.mjs`）。状态类 `is-` / `has-` 跟在业务块后面用，不构成命名空间。

**为什么这条要靠守卫而不是文档。** 本插件与 chatluna-sandbox 可能同时装进同一个 Koishi 控制台，而两者的界面代码同源：从那边搬运一段样式时，`webqq-` 前缀会跟着过来，冲突的表现是「另一个插件的页面某处颜色或间距静默变样」，既不报错也难以定位。`tests/css-namespace.test.ts` 的判定面是样式表里的规则（不是模板里的书写——模板里写了但没有任何规则选中的类名不产生视觉），出现第三套前缀立刻红灯。

**页面根与全部浮层根都在这一套里。** 排版基准字号令牌（[ADR-0020](./0020-replace-hardcoded-font-sizes-with-one-scale.md)）与 Tailwind preflight 的作用域（[ADR-0018](./0018-scope-tailwind-preflight-in-the-build-output.md)）都挂在这些选择器上，两者的失效形态都是静默退回浏览器默认值，因此渲染根清单只有一份（`scripts/studio-style-roots.mjs`），新增浮层必须同时补清单与令牌规则。

代价是类名较长（`.chatluna-studio-model-request-list-toolbar`）。相比同页共存时的静默冲突，这个代价可以接受；这也是从 chatluna-sandbox 抽离时唯一必须一次做完的重命名——留下任何一处旧前缀，两个插件就都失去了「样式互不影响」这个前提。
