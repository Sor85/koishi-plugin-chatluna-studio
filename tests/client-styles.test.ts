import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { listClientStylesheets } from './helpers/client-stylesheets'

/**
 * 客户端样式的加载结构。
 *
 * 三条不变量都属于「不会报错、只会静默变样」那一类：加载顺序就是级联顺序；工作区层一旦声明
 * backdrop-filter，覆盖在它上面的浮层毛玻璃会全部退化成纯半透明（ADR-0060）；入口文件一旦
 * 夹带规则，样式归属就不再看得出来。
 */

const ENTRY = 'client/style.css'

function readEntry() {
  return readFileSync(resolve(ENTRY), 'utf8')
}

function entryImports() {
  return [...readEntry().matchAll(/@import "\.\/([^"]+)"/g)].map((match) => `client/${match[1]}`)
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

  it('工作区层不声明 backdrop-filter，毛玻璃只出现在浮层与控件层', () => {
    const workspace = readFileSync(resolve('client/workspace/workspace.css'), 'utf8')
    const declarations = [...workspace.matchAll(/^\s*backdrop-filter:/gm)]
    expect(declarations, '工作区层出现 backdrop-filter 会让浮层毛玻璃整体失效').toEqual([])
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
    expect(workspace).toContain('body[data-studio-color-scheme="dark"]')
  })
})
