import postcss from 'postcss'

import { STUDIO_STYLE_ROOTS } from './studio-style-roots.mjs'

/* Tailwind preflight（@layer base）整块都是无作用域的类型选择器：`*`、`h1`~`h6`、`a`、
   `ol, ul, menu`、`img, svg, video...`、`button, input, select, textarea`、`small` 等。
   Koishi 控制台把所有插件的样式表加载到同一个文档里，这些规则会重置整个控制台和其他
   插件的 UI——把标题字号压平、去掉列表符号、把行内 SVG 变成块级、清掉按钮背景。

   Tailwind v4 没有"给 preflight 加作用域"的配置项，所以在 CLI 产物上做一次改写：
   把每条选择器限制到本插件的渲染根内。用 :where() 包裹作用域，保证特异性维持原样
   （preflight 必须留在特异性最低层，否则会压过组件自身的样式）。 */

const PSEUDO_ELEMENT_PREFIX = '::'

/** 拆分逗号分隔的选择器列表，跳过括号、方括号与字符串里的逗号。 */
function splitSelectorList(selector) {
  const parts = []
  let depth = 0
  let quote = ''
  let current = ''
  for (const char of selector) {
    if (quote) {
      current += char
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === '\'') {
      quote = char
      current += char
      continue
    }
    if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function scopeSelectorPart(part, scope) {
  // html / :host 只承载继承属性，而其中的 font-family 会把工作区从控制台主题字体
  // （--font-family，用户可在控制台设置里改）换成 Tailwind 的 --font-sans。整条丢弃，
  // 需要保留的 line-height / tab-size / tap-highlight 由 client/workspace/workspace.css 与
  // client/styles/chatluna-studio-primitives.css 显式声明，见 docs/adr/0068。
  if (part === 'html' || part === ':host') return []
  // ::backdrop 只作用于 top layer 元素；本插件的浮层都是普通元素，无法也无需限定作用域。
  if (part === '::backdrop') return []
  // `*` 既要覆盖后代，也要覆盖渲染根自身。
  if (part === '*') return [scope, `${scope} *`]
  if (part.startsWith(PSEUDO_ELEMENT_PREFIX)) return [`${scope}${part}`, `${scope} *${part}`]
  return [`${scope} ${part}`]
}

export function scopePreflight(css, roots = STUDIO_STYLE_ROOTS) {
  const scope = `:where(${roots.join(', ')})`
  const ast = postcss.parse(css)
  let scopedRules = 0
  let droppedRules = 0

  ast.walkAtRules('layer', (layer) => {
    if (layer.params !== 'base' || !layer.nodes) return
    layer.walkRules((rule) => {
      // 原生嵌套里的子规则由父选择器带上作用域，不能重复前缀。
      if (rule.parent.type === 'rule') return
      const scoped = splitSelectorList(rule.selector).flatMap((part) => scopeSelectorPart(part, scope))
      if (!scoped.length) {
        rule.remove()
        droppedRules++
        return
      }
      rule.selectors = scoped
      scopedRules++
    })
  })

  if (!scopedRules) {
    throw new Error('未在 Tailwind 产物中找到 @layer base 规则；preflight 作用域改写没有生效，请检查 tailwind.source.css 的导入方式。')
  }
  return { css: ast.toString(), scopedRules, droppedRules }
}
