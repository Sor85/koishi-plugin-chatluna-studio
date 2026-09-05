import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { listClientStylesheets, readClientStyleBlocks } from './helpers/client-stylesheets'

/**
 * 客户端样式的加载结构与表面边界。
 *
 * 这些不变量都属于「不会报错、只会静默变样」那一类：加载顺序就是级联顺序；工作区层一旦把
 * backdrop-filter 写到区域元素自己身上，其中的控件与覆盖其上的浮层毛玻璃会全部退化成纯
 * 半透明（ADR-0019）；入口文件一旦夹带规则，样式归属就不再看得出来；声明一旦落到宿主的根节点上，
 * 坏的是同一个控制台里别人的页面，本插件自查反而看不出问题（ADR-0026）。
 */

const ENTRY = 'client/style.css'

/** 宿主根节点：这三个不属于本插件的表面，控制台和其余插件的页面都站在它们上面。 */
const HOST_ROOTS = ['html', 'body', '#app']

function readEntry() {
  return readFileSync(resolve(ENTRY), 'utf8')
}

function entryImports() {
  return [...readEntry().matchAll(/@import "\.\/([^"]+)"/g)].map((match) => `client/${match[1]}`)
}

/** 全部样式源码：独立样式表 + 单文件组件里的 style 块。产物表不是源码，排除。 */
function styleSources(): { path: string, source: string }[] {
  return [
    ...listClientStylesheets()
      .filter((path) => !path.includes('generated'))
      .map((path) => ({ path, source: readFileSync(resolve(path), 'utf8') })),
    ...readClientStyleBlocks(),
  ]
}

/** 按顶层分隔符切开，括号里的逗号与空格属于 `:is()`/`:has()` 的内部结构，不参与切分。 */
function splitTopLevel(text: string, separators: RegExp): string[] {
  const parts: string[] = ['']
  let depth = 0
  for (const char of text) {
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1
    else if (depth === 0 && separators.test(char)) {
      parts.push('')
      continue
    }
    parts[parts.length - 1] += char
  }
  return parts.map((part) => part.trim()).filter(Boolean)
}

/**
 * 选择器的主体，也就是声明真正落在谁身上：最后一个复合选择器。
 *
 * 判定必须落在主体而不是「出现过 body 吗」：`body[data-…] .chatluna-studio-page` 只是拿 body 当
 * 限定条件，声明落在本插件的页面根上，是允许的形态；`body { … }` 才是往宿主身上写。
 */
function subjectOf(selector: string): string {
  return splitTopLevel(selector, /[\s>+~]/).pop() ?? ''
}

/** 剥掉属性与伪类，只留元素名或 id：`body[data-x]:has(.y)` 与 `body` 一样都是往 body 上写。 */
function bareSubject(selector: string): string {
  return subjectOf(selector)
    .replace(/\[[^\]]*\]/g, '')
    .replace(/::?[a-z-]+(\([^)]*\))?/g, '')
}

/** 源码里的全部选择器。at-rule 的前奏与声明块内容都不是选择器，按 `@` 和 `;` 排除。 */
function selectorsOf(source: string): string[] {
  return [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|[{}])([^{}]*)\{/g)]
    .flatMap((match) => splitTopLevel(match[1]!.trim(), /,/))
    .filter((selector) => selector && !selector.startsWith('@') && !selector.includes(';'))
}

describe('客户端样式加载', () => {
  it('入口按级联顺序加载全部样式表，不多也不少', () => {
    // 顺序是级联的一部分：跨能力令牌与原语在前，能力目录下的区域表居中，跨区域断点收尾。
    expect(entryImports()).toEqual([
      'client/styles/tailwind.generated.css',
      'client/styles/shadcn-theme.css',
      'client/styles/chatluna-studio-tokens.css',
      'client/workspace/workspace.css',
      'client/styles/chatluna-studio-primitives.css',
      'client/workspace/overlays.css',
      'client/model-request/styles.css',
      'client/preset/styles.css',
      'client/styles/chatluna-studio-responsive.css',
    ])
    // 磁盘上多出一张没被入口引用的样式表时，它不会生效也不会报错；这条断言拦住那种情况。
    // `tailwind.source.css` 是预编译的输入而不是被加载的表，入口引用的是它的产物。
    const loaded = entryImports().filter((path) => !path.endsWith('.generated.css'))
    expect(listClientStylesheets().filter((path) => path !== ENTRY))
      .toEqual([...loaded, 'client/styles/tailwind.source.css'].sort())
  })

  it('入口只做加载，不夹带规则', () => {
    const withoutComments = readEntry().replace(/\/\*[\s\S]*?\*\//g, '')
    expect(withoutComments).not.toMatch(/\{/)
  })

  it('工作区层的模糊只落在无后代的 ::before 上，区域元素自身不声明 backdrop-filter', () => {
    // 区域元素自己带 backdrop-filter 时会成为 Backdrop Root 边界：其中的控件与覆盖其上的
    // 浮层都采样不到内容，毛玻璃静默退化成纯半透明（ADR-0019）。模糊挂在无后代的 ::before 上
    // 时元素本身不成为边界，卡片这类小面积浮起表面才能安全雾化。
    const workspace = readFileSync(resolve('client/workspace/workspace.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const offenders: string[] = []
    for (const match of workspace.matchAll(/(?<selector>[^{}]+)\{(?<body>[^{}]*)\}/g)) {
      if (!/backdrop-filter:\s*(?!none)/.test(match.groups?.body ?? '')) continue
      const selector = (match.groups?.selector ?? '').trim()
      const onPseudo = selector.split(',').every((one) => one.trim().endsWith('::before'))
      if (!onPseudo) offenders.push(selector)
    }
    expect(offenders, '工作区层的 backdrop-filter 必须写在 ::before 上，否则区域自身成为 Backdrop Root').toEqual([])
  })

  it('毛玻璃双态由 body 属性统一驱动，不给每个浮层穿 prop', () => {
    const primitives = readFileSync(resolve('client/styles/chatluna-studio-primitives.css'), 'utf8')
    const preset = readFileSync(resolve('client/preset/styles.css'), 'utf8')
    for (const [name, source] of [['原语层', primitives], ['预设区域', preset]] as const) {
      const frosted = [...source.matchAll(/^[^{}]*backdrop-filter:/gm)]
      expect(frosted.length, `${name}应当声明毛玻璃`).toBeGreaterThan(0)
      expect(source).toContain('body[data-chatluna-studio-frosted]')
    }
  })

  it('渐变只用于遮罩裁切，不做区域背景', () => {
    const offenders: string[] = []
    for (const path of listClientStylesheets()) {
      if (path.includes('generated')) continue
      const source = readFileSync(resolve(path), 'utf8')
      for (const match of source.matchAll(/^\s*(?<property>[a-z-]*)\s*:\s*[^;]*gradient\(/gm)) {
        const property = match.groups?.property ?? ''
        if (property.endsWith('mask-image')) continue
        offenders.push(`${path}: ${property}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('暗色模式由工作区容器上的解析结果驱动，浮层跟随 body 属性', () => {
    const workspace = readFileSync(resolve('client/workspace/workspace.css'), 'utf8')
    expect(workspace).toContain('.chatluna-studio-workspace[data-color-mode="dark"]')
    expect(workspace).toContain('body[data-chatluna-studio-color-scheme="dark"]')
  })

  /**
   * 控制台自己的 `body { min-height: 100vh }` 是同一个控制台里所有插件页面共用的高度地基。插件写一条
   * 同名声明就会盖掉它（同特异性，后加载者胜），而 `min-height: 100%` 的百分比要拿 auto 高度的 html
   * 求值、退化成 auto，body 与 #app 一起塌成 0 高度。本插件页面取 100vh 察觉不到，但别人页面凡是靠
   * `position: absolute; inset: 0` 或百分比高度撑开根容器，就会拿到 0 高度并被 overflow: hidden 裁空
   * ——表现是「另一个插件的页面打开是一片白」，不报错也没有任何线索指回这里。
   */
  it('不往宿主根节点写声明，body 只当限定条件用', () => {
    const offenders: string[] = []
    for (const { path, source } of styleSources()) {
      for (const selector of selectorsOf(source)) {
        if (HOST_ROOTS.includes(bareSubject(selector))) offenders.push(`${path}: ${selector}`)
      }
    }
    expect(offenders, 'html / body / #app 属于宿主表面，本插件的尺寸与外观只能写在自己的根节点上').toEqual([])
  })

  /**
   * `:global()` 在 scoped 块里只能整条用。@vue/compiler-sfc 命中它时会把整条选择器替换成括号里的
   * 第一段，`:global(.dark) .studio-badge` 编译出来是裸的 `.dark { … }`：一边漏成全局规则去染控制台里
   * 任何带该类名的元素，一边把真正想选中的那一段整段丢掉，于是「样式没生效」和「污染了别人」同时发生。
   * 本仓库不需要这个能力——Portal 浮层的样式走 `client/workspace/overlays.css` 这类无作用域表。
   */
  it('组件的 scoped 块不用 :global()', () => {
    // 注释先去掉：这条规则的由来就写在 Badge.vue 的注释里，扫原文会把说明本身当成违规。
    const offenders = readClientStyleBlocks()
      .filter(({ source }) => source.replace(/\/\*[\s\S]*?\*\//g, '').includes(':global('))
      .map(({ path }) => path)
    expect(offenders, ':global() 会被整条替换成括号内的第一段；暗色钩子请写 [data-color-mode] 或 body 属性').toEqual([])
  })
})
