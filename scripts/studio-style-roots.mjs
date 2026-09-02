// 本插件所有渲染根：页面容器，以及全部 teleport / Portal 到 body 的浮层根。
//
// 两处消费这份清单：
//   1. client/styles/chatluna-studio-tokens.css 在这些选择器上定义排版标度令牌；
//   2. scripts/scope-preflight.mjs 把 Tailwind preflight 限制在这些子树内。
// 两者的失效形态都是"静默退回浏览器默认值"，不会报错，所以
// tests/studio-style-roots.test.ts 断言模板里每个 Portal 根都在这份清单里，
// 且 chatluna-studio-tokens.css 的令牌规则选择器列表与本清单逐项一致。
//
// 新增 teleport / Portal 浮层时必须同时补进这里和 chatluna-studio-tokens.css。
export const STUDIO_STYLE_ROOTS = [
  // Koishi k-layout 的 main 容器，覆盖 .chatluna-studio-workspace 及其全部后代。
  '.chatluna-studio-page',
  // reka-ui Portal 内容根（类名与 data-slot 由 client/components/ui 下的封装写死）。
  '.studio-dialog-content',
  '[data-slot="dialog-overlay"]',
  '.studio-popover-content',
  '.studio-select-content',
  '[data-slot="tooltip-content"]',
]
