import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { STUDIO_STYLE_ROOTS } from '../scripts/studio-style-roots.mjs'
import { scopePreflight } from '../scripts/scope-preflight.mjs'

/** 每个 teleport / Portal 浮层落在哪个渲染根上。新增浮层必须同时补进这里和 STUDIO_STYLE_ROOTS。 */
const PORTAL_INVENTORY: Array<[string, string]> = [
  ['client/components/ui/dialog/DialogContent.vue', '[data-slot="dialog-overlay"]'],
  ['client/components/ui/dialog/DialogContent.vue', '.studio-dialog-content'],
  ['client/components/ui/popover/PopoverContent.vue', '.studio-popover-content'],
  ['client/components/ui/select/SelectContent.vue', '.studio-select-content'],
  ['client/components/ui/tooltip/TooltipContent.vue', '[data-slot="tooltip-content"]'],
]

function vueFiles(dir = 'client', found: string[] = []) {
  for (const entry of readdirSync(resolve(dir), { withFileTypes: true })) {
    if (entry.isDirectory()) vueFiles(`${dir}/${entry.name}`, found)
    else if (entry.name.endsWith('.vue')) found.push(`${dir}/${entry.name}`)
  }
  return found
}

/** 从包含某条声明的 CSS 规则里取出它逗号分隔的选择器列表。 */
function selectorList(source: string, declaration: string) {
  const declarationIndex = source.indexOf(declaration)
  expect(declarationIndex, `样式源里找不到声明 ${declaration}`).toBeGreaterThan(-1)
  const braceIndex = source.lastIndexOf('{', declarationIndex)
  const before = source.slice(0, braceIndex)
  // 选择器列表从上一条规则的 `}` 或上一段注释的 `*/` 之后开始（`*/` 占两个字符）。
  const afterRule = before.lastIndexOf('}') + 1
  const afterComment = before.lastIndexOf('*/') + 2
  return before
    .slice(Math.max(afterRule, afterComment))
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

describe('渲染根清单', () => {
  it('排版令牌与浮层基准都写在同一份渲染根清单上', () => {
    const tokens = readFileSync(resolve('client/styles/chatluna-studio-tokens.css'), 'utf8')
    const primitives = readFileSync(resolve('client/styles/chatluna-studio-primitives.css'), 'utf8')

    // 令牌规则：chatluna-studio-tokens.css 里第一条声明 --chatluna-studio-font-3xs 的规则。
    expect(selectorList(tokens, '--chatluna-studio-font-3xs')).toEqual(STUDIO_STYLE_ROOTS)
    // 浮层基准规则：chatluna-studio-primitives.css 里声明 tab-size 的那条。
    expect(selectorList(primitives, 'tab-size: 4')).toEqual(STUDIO_STYLE_ROOTS)
  })

  it('每个 teleport / Portal 浮层的渲染根都在清单里', () => {
    for (const [file, root] of PORTAL_INVENTORY) {
      expect(STUDIO_STYLE_ROOTS, `${file} 的浮层根 ${root} 不在 STUDIO_STYLE_ROOTS 里`).toContain(root)
      const source = readFileSync(resolve(file), 'utf8')
      const token = root.startsWith('[') ? root.slice(1, -1).replace(/"/g, '') : root.slice(1)
      expect(source, `${file} 里找不到 ${root}`).toContain(token.includes('=') ? token.split('=')[1] : token)
    }
  })

  it('新增 teleport / Portal 时必须同步清单', () => {
    // 计数守卫：这两个数字变化说明有人加了浮层，必须同时补 PORTAL_INVENTORY 与 STUDIO_STYLE_ROOTS，
    // 否则那棵子树会静默失去 preflight 与排版令牌。
    const sources = vueFiles().map((file) => readFileSync(resolve(file), 'utf8'))
    const teleports = sources.reduce((total, source) => total + (source.match(/<Teleport to="body">/g)?.length ?? 0), 0)
    const portals = sources.reduce((total, source) => total + (source.match(/<\w+Portal[\s>]/g)?.length ?? 0), 0)
    // 本插件自己不写 teleport：全部浮层都由 client/components/ui 下的 shadcn-vue 封装经 reka-ui
    // Portal 挂到 body。这两个数字变化说明有人加了浮层，必须同时补 PORTAL_INVENTORY 与
    // STUDIO_STYLE_ROOTS，否则那棵子树会静默失去 preflight 与排版令牌。
    expect(teleports).toBe(0)
    expect(portals).toBe(4)
  })
})

describe('Tailwind preflight 作用域改写', () => {
  const sample = `@layer base {
  *, ::after, ::before, ::backdrop, ::file-selector-button { box-sizing: border-box; }
  html, :host { line-height: 1.5; font-family: sans-serif; }
  h1, h2 { font-size: inherit; }
  small { font-size: 80%; }
  :where(select:is([multiple], [size])) optgroup { font-weight: bolder; }
  @supports (color: red) {
    ::placeholder { color: red; }
  }
}
@layer utilities {
  .text-sm { font-size: 0.875rem; }
}`

  it('把类型选择器限制到渲染根内，并保持特异性不变', () => {
    const { css } = scopePreflight(sample, ['.a', '[data-b]'])
    const scope = ':where(.a, [data-b])'

    // 元素选择器变成后代选择器：特异性与原来一致（:where() 不贡献特异性）。
    expect(css).toContain(`${scope} small`)
    expect(css).toContain(`${scope} h1`)
    expect(css).toContain(`${scope} :where(select:is([multiple], [size])) optgroup`)
    // `*` 与伪元素既要覆盖后代，也要覆盖渲染根自身。
    expect(css).toContain(`${scope} *`)
    expect(css).toContain(`${scope}::after`)
    expect(css).toContain(`${scope} *::after`)
    // @supports 内部同样要改写。
    expect(css).toContain(`${scope}::placeholder`)
    // utilities 层是类选择器，不参与改写。
    expect(css).toContain('.text-sm')
    expect(css).not.toMatch(new RegExp(`${scope.replace(/[[\]()*.]/g, '\\$&')} \\.text-sm`))
  })

  it('丢弃 html/:host 与 ::backdrop', () => {
    const { css, droppedRules } = scopePreflight(sample, ['.a'])
    // html 那条同时会把字体族换成 Tailwind 的 --font-sans，整条丢弃；
    // 需要保留的 line-height / tab-size 由 client/workspace/workspace.css 显式声明。
    expect(css).not.toContain('font-family: sans-serif')
    expect(css).not.toContain(':host')
    expect(css).not.toContain('::backdrop')
    expect(droppedRules).toBe(1)
  })

  it('产物里找不到 @layer base 时直接失败，不静默放过', () => {
    expect(() => scopePreflight('@layer utilities { .a { color: red } }')).toThrow(/@layer base/)
  })
})

describe('Tailwind 预编译链路', () => {
  it('构建与开发监听都经过限定作用域的入口', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
    const watcher = readFileSync(resolve('scripts/watch-server.mjs'), 'utf8')

    expect(packageJson.scripts['build:css']).toBe('node scripts/build-css.mjs')
    // Tailwind --watch 会绕过后处理，所以不保留 watch:css；开发期重建由 watch:server 负责。
    expect(packageJson.scripts['watch:css']).toBeUndefined()
    expect(watcher).toContain('scripts/build-css.mjs')
    expect(watcher).not.toContain('@tailwindcss/cli/dist/index.mjs')
  })
})
