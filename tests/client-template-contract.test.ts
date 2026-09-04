import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { readClientStylesheets } from './helpers/client-stylesheets'

/**
 * 模板与脚本里写下的名字必须真的能解析到实现。
 *
 * 这几条都属于「不报错、只是某处交互或外观静默失效」的形态，而且都会在批量重命名后复发，因此值得守：
 *
 * - 自定义指令：`<script setup>` 按 `v-foo-bar` → `vFooBar` 反查局部标识符。改了导出名而没改模板
 *   （或反过来）时 Vue 只在控制台留一条 warn，指令整条被跳过。
 * - Select 选项值：reka-ui 把空串保留给「清空选择」，`SelectItem` 拿到空串会 throw。异常发生在
 *   浮层挂载途中，浮层会停在定位前的 `translate(0, -200%)`，看起来就是点开筛选没有任何反应。
 * - body 状态位：dataset 键名与样式源里的属性选择器必须逐字对应，否则整块规则永不命中。
 * - 浮层配色令牌：Portal 到 body 的面板不在工作区继承树里，令牌镜像缺失时引用它们的声明会被
 *   整条丢弃，面板变成完全透明。
 * - 第三方组件自建的滚动容器：模板里没有节点可挂指令，只能命令式挂载；漏掉挂载或漏掉卸载都不会
 *   报错，只会留下原生轨道或一个孤儿轨道元素。
 */

const CLIENT_ROOT = resolve(__dirname, '../client')

/** Vue 内置指令不需要局部标识符。 */
const BUILTIN_DIRECTIVES = new Set([
  'if', 'else', 'else-if', 'for', 'show', 'model', 'bind', 'on',
  'slot', 'pre', 'once', 'memo', 'cloak', 'html', 'text', 'is',
])

function listVueFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listVueFiles(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

const files = listVueFiles(CLIENT_ROOT).map((path) => ({
  path: path.slice(CLIENT_ROOT.length + 1),
  source: readFileSync(path, 'utf8'),
}))

function toCamelDirective(name: string): string {
  return 'v' + name.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('')
}

describe('客户端模板契约', () => {
  it('至少扫到了两个工作台组件', () => {
    expect(files.length).toBeGreaterThan(10)
    expect(files.map(({ path }) => path)).toContain('model-request/workspace.vue')
    expect(files.map(({ path }) => path)).toContain('preset/workspace.vue')
  })

  it('模板里用到的自定义指令都有同名局部标识符', () => {
    const unresolved: string[] = []
    for (const { path, source } of files) {
      const used = new Set<string>()
      for (const match of source.matchAll(/[\s<]v-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/g)) {
        if (!BUILTIN_DIRECTIVES.has(match[1])) used.add(match[1])
      }
      for (const name of used) {
        const identifier = toCamelDirective(name)
        if (!new RegExp(`\\b${identifier}\\b`).test(source)) {
          unresolved.push(`${path}: v-${name} 需要标识符 ${identifier}`)
        }
      }
    }
    expect(unresolved).toEqual([])
  })

  it('没有值为空串的 SelectItem', () => {
    const offenders = files
      .filter(({ source }) => /<SelectItem[^>]*\s:?value="(''|"")?"/.test(source)
        || /<SelectItem[^>]*\svalue=""/.test(source)
        || /<SelectItem[^>]*\s:value="''"/.test(source))
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })

  it('「不限」筛选项用非空哨兵值', () => {
    const source = files.find(({ path }) => path === 'model-request/workspace.vue')!.source
    expect(source).toContain("const ANY_FILTER_VALUE = '__any__'")
    expect(source).toContain('<SelectItem :value="ANY_FILTER_VALUE">全部机器人</SelectItem>')
    expect(source).toContain('<SelectItem :value="ANY_FILTER_VALUE">全部会话</SelectItem>')
    // 哨兵只活在下拉层：筛选状态本身仍以空串表示「不限」，请求里则整项省略。
    expect(source).toContain('botId: botId.value || undefined')
    expect(source).toContain('conversationId: conversationId.value || undefined')
  })

  it('body 状态位的 dataset 键名与样式选择器一致', () => {
    const colorScheme = readFileSync(join(CLIENT_ROOT, 'workspace/color-scheme.ts'), 'utf8')
    const styles = readClientStylesheets().join('\n')

    // dataset.fooBar → data-foo-bar。样式源里出现的每个 body 状态属性都必须有人写。
    const written = new Set(
      [...colorScheme.matchAll(/document\.body\.dataset\.(\w+)/g)]
        .map(([, key]) => 'data-' + key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())),
    )
    expect([...written].sort()).toEqual(['data-chatluna-studio-color-scheme', 'data-chatluna-studio-frosted'])

    const used = new Set([...styles.matchAll(/body(?::not\()?\[(data-[\w-]+)/g)].map(([, name]) => name))
    for (const name of used) {
      expect(written, `样式里用到 body[${name}]，但没有任何地方写这个属性`).toContain(name)
    }
  })

  it('Portal 浮层镜像了一份配色令牌', () => {
    const tokens = readFileSync(join(CLIENT_ROOT, 'styles/chatluna-studio-tokens.css'), 'utf8')
    const mirror = tokens.slice(tokens.indexOf('.studio-dialog-content,'))
    expect(mirror).toBeTruthy()
    // 面板本体与雾化态引用的令牌都必须在镜像里，缺一个就会让那条声明被整条丢弃。
    for (const token of [
      '--chatluna-studio-bg',
      '--chatluna-studio-text',
      '--chatluna-studio-panel',
      '--chatluna-studio-secondary-outline',
      '--chatluna-studio-secondary-shadow',
    ]) {
      expect(mirror, `浮层令牌镜像缺 ${token}`).toContain(`${token}:`)
    }
    expect(mirror).toContain('body[data-chatluna-studio-color-scheme="dark"]')
  })

  it('CodeMirror 的滚动容器命令式挂上自定义轨道，并且不留原生轨道的位置', () => {
    const editor = files.find(({ path }) => path === 'preset/source-editor.vue')!.source
    // `.cm-scroller` 由 CodeMirror 自己创建，模板里没有这个节点，v- 指令无处可挂。漏掉这一句
    // 不会报错，只会让原生轨道从滚动容器顶缘起画——而那个顶缘在覆盖层顶栏背后。
    expect(editor).toContain('attachStudioScrollbar(view.scrollDOM)')
    // 轨道元素挂在 body 上，销毁编辑器不会带走它。
    expect(editor).toContain('scrollbar?.detach()')

    // 原生轨道无法裁剪，滚动容器不得重新预留或恢复它的宽度。
    const presetStyles = readFileSync(join(CLIENT_ROOT, 'preset/styles.css'), 'utf8')
    const block = presetStyles.slice(presetStyles.indexOf('.chatluna-studio-preset-source-editor .cm-scroller'))
    expect(block.slice(0, block.indexOf('}'))).not.toMatch(/scrollbar-gutter|scrollbar-width|::-webkit-scrollbar/)
  })
})
