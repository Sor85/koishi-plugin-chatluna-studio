import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { readClientStylesheets } from './helpers/client-stylesheets'

/**
 * 本仓库只有一套业务 CSS 命名空间：`chatluna-studio-`。
 *
 * 这条规则值得守而不只是写在文档里，因为两个插件可能同时装进同一个 Koishi 控制台：一旦某个顶层块
 * 用了别的前缀（尤其是从 chatluna-sandbox 搬运代码时残留的 `webqq-`），冲突的表现是「另一个插件的
 * 页面某处颜色或间距静默变样」，既不报错也难以定位。
 *
 * `studio-` 是唯一的第二套，且只属于 `client/components/ui/` 里 shadcn-vue 封装写死的类名——
 * 其中四个还是 Portal 内容根（见 `scripts/studio-style-roots.mjs`）。
 */

/**
 * 允许出现在样式表里的非业务前缀。
 *
 * 状态类（`is-`/`has-`）永远跟在业务块后面用，不构成命名空间；其余四项是别人的类名，本插件只是
 * 在自己的作用域内覆盖它们的表现。Tailwind 工具类不在这里：它们只出现在构建产物里，而产物已被
 * 观察面排除。
 */
const ALLOWED_FOREIGN_PREFIXES = [
  'is', // 状态类
  'has', // 状态类
  'cm', // CodeMirror
  'k', // Koishi 控制台
  'el', // Element Plus（Koishi 控制台内置）
  'layout', // Koishi 控制台布局
  'sr', // sr-only 无障碍工具类
  'dark', // Tailwind 暗色变体
  'rounded', // shadcn 主题映射的 Tailwind 工具类
  'shadow', // 同上
]

function listFiles(directory: string, test: RegExp): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? listFiles(path, test) : test.test(entry.name) ? [path] : []
  })
}

/**
 * 判定面是样式表里的规则，不是模板里的书写：模板里写了但没有任何规则选中的类名不产生视觉，
 * 也就不构成命名空间。注释先去掉——注释里的文件名（`chatluna-studio-tokens.css`）会被类名
 * 正则当成选择器。
 */
function readRules(): string[] {
  return readClientStylesheets().map((source) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // @import 的文件名里带扩展名，会被类名正则当成选择器。
    .replace(/^\s*@import[^;]*;/gm, ''))
}

function collectClassNames(): string[] {
  const names = new Set<string>()
  for (const source of readRules()) {
    for (const match of source.matchAll(/\.(-?[a-zA-Z][a-zA-Z0-9_-]*)/g)) names.add(match[1]!)
  }
  return [...names].sort()
}

describe('CSS 命名空间', () => {
  it('业务顶层块一律写 chatluna-studio-', () => {
    const foreign = collectClassNames()
      .filter((name) => !name.startsWith('chatluna-studio-'))
      .filter((name) => !name.startsWith('studio-'))
      .filter((name) => !ALLOWED_FOREIGN_PREFIXES.includes(name.split('-')[0]!))
      .sort()

    expect(foreign, '出现了第三套命名空间；新增顶层块必须写 chatluna-studio-').toEqual([])
  })

  it('chatluna-studio- 是页面根与浮层根所用的那一套', () => {
    const blocks = new Set(collectClassNames()
      .filter((name) => name.startsWith('chatluna-studio-'))
      .map((name) => name.slice('chatluna-studio-'.length).split('-')[0]!))

    expect(blocks).toContain('page')
    expect(blocks).toContain('layout')
    expect(blocks).toContain('workspace')
    expect(blocks.size).toBeGreaterThan(10)
  })

  /**
   * 判定面同样是样式表里的声明：`studio-` 这一套的意义在于「它属于 shadcn-vue 封装」，
   * 而封装的类名写死在组件里。改成扫模板会把 `closest('.studio-select-content')` 这类
   * 对封装类名的读取误判成违规。
   */
  it('studio- 只用于 shadcn-vue 封装写死的类名', () => {
    const wrapperSource = listFiles(resolve('client/components/ui'), /\.(vue|ts)$/)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')

    const orphans = collectClassNames()
      .filter((name) => name.startsWith('studio-'))
      .filter((name) => !wrapperSource.includes(name))
      .sort()

    expect(orphans).toEqual([])
  })
})
