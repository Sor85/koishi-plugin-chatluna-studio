import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { listClientStylesheets } from './helpers/client-stylesheets'

const SCALE = {
  '--chatluna-studio-font-3xs': '9px',
  '--chatluna-studio-font-2xs': '10px',
  '--chatluna-studio-font-xs': '11px',
  '--chatluna-studio-font-sm': '12px',
  '--chatluna-studio-font-md': '13px',
  '--chatluna-studio-font-lg': '14px',
  '--chatluna-studio-font-xl': '16px',
  '--chatluna-studio-font-2xl': '18px',
  '--chatluna-studio-font-3xl': '24px',
}

/** 头像首字母按圆形直径派生，是几何量而不是排版档位，允许保留字面 px。 */
const AVATAR_DERIVED = 'clamp(9px, calc(var(--chatluna-studio-avatar-size, 38px) / 3), 32px)'

/**
 * 判定面是客户端全部样式源码加全部 `.vue`。样式表这一半必须走 `listClientStylesheets()`：
 * 区域表已按能力归属散进 `client/<能力>/`（ADR-0092），照旧只扫 `client/styles/chatluna-studio-*.css`
 * 会让这条守卫静默缩到剩下的三张跨能力表，而漏掉的表里再出现标度外的字面字号不会报错。
 */
function collectStyleSources() {
  const files: Array<[string, string]> = listClientStylesheets()
    .map((path) => [path, readFileSync(resolve(path), 'utf8')])
  const walk = (dir: string) => {
    for (const entry of readdirSync(resolve(dir), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(`${dir}/${entry.name}`)
      } else if (entry.name.endsWith('.vue')) {
        files.push([`${dir}/${entry.name}`, readFileSync(resolve(dir, entry.name), 'utf8')])
      }
    }
  }
  walk('client')
  return files
}

describe('排版标度', () => {
  it('把整套字号标度和等宽栈定义在渲染根上', () => {
    const tokens = readFileSync(resolve('client/styles/chatluna-studio-tokens.css'), 'utf8')
    const scaleRule = tokens.slice(0, tokens.indexOf('}'))

    // 令牌规则的选择器列表必须覆盖全部渲染根，这一项由 tests/studio-style-roots.test.ts
    // 与 STUDIO_STYLE_ROOTS 逐项比对；这里只校验标度本身。
    for (const [token, value] of Object.entries(SCALE)) {
      expect(scaleRule).toContain(`${token}: ${value};`)
    }
    expect(scaleRule).toContain('--chatluna-studio-font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;')
  })

  it('工作区与浮层各自落一个基准字号，不继承宿主的 16px', () => {
    const workspace = readFileSync(resolve('client/workspace/workspace.css'), 'utf8')
    const primitives = readFileSync(resolve('client/styles/chatluna-studio-primitives.css'), 'utf8')

    const workspaceRule = workspace.slice(workspace.indexOf('.chatluna-studio-workspace {')).split('}')[0]
    expect(workspaceRule).toContain('font-size: var(--chatluna-studio-font-md)')
    expect(workspaceRule).toContain('line-height: 1.5')

    // 浮层基准写在原语层：Dialog/Popover/Select/右键菜单/二级页/自建 teleport 浮层
    // 各自是独立的继承树。这条规则同时补上 preflight 限定作用域后丢掉的 tab-size。
    const overlayBaseRule = primitives.slice(0, primitives.indexOf('tab-size: 4'))
    const overlayRuleBody = primitives
      .slice(primitives.indexOf('tab-size: 4'))
      .split('}')[0]
    expect(overlayBaseRule).toContain('.studio-dialog-content')
    expect(overlayBaseRule.slice(overlayBaseRule.lastIndexOf('{'))).toContain('font-size: var(--chatluna-studio-font-md)')
    expect(overlayRuleBody).toContain('-webkit-tap-highlight-color: transparent')
  })

  it('头像首字母按直径派生，不逐处硬编码', () => {
    const read = (path: string) => readFileSync(resolve('client', path), 'utf8')

    // 派生公式必须写在使用点上：自定义属性的 var() 在声明它的元素上就完成替换，
    // 提成令牌会让内层的 --chatluna-studio-avatar-size 永远解析成根容器上的缺省值。
    expect(read('styles/chatluna-studio-primitives.css')).toContain(AVATAR_DERIVED)

    for (const path of ['styles/chatluna-studio-primitives.css', 'model-request/styles.css', 'workspace/overlays.css']) {
      for (const stale of ['10.667px', '12.667px', '25.333px']) {
        expect(read(path), `${path} 不应再出现派生前的字面字号 ${stale}`).not.toContain(stale)
      }
    }
  })

  it('样式源里不再出现标度之外的字面字号或等宽栈', () => {
    const offenders: string[] = []
    for (const [file, source] of collectStyleSources()) {
      for (const match of source.matchAll(/font-size:\s*([^;{}]+)/g)) {
        const value = match[1].trim()
        if (value.startsWith('var(--chatluna-studio-font-')) continue
        if (value === AVATAR_DERIVED) continue
        offenders.push(`${file}: font-size: ${value}`)
      }
      // 收敛前这套等宽栈在 14 处重复，还分裂成三种不同排列。
      if (/font-family:\s*[^;{}]*(JetBrains Mono|SFMono-Regular|Cascadia Code|Menlo)/.test(source)) {
        offenders.push(`${file}: 硬编码等宽字体栈`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('工具定义摘要三段文本各占一档字号', () => {
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')
    const rule = (selector: string) => styles.slice(styles.indexOf(selector)).split('}')[0]

    // 三者原先都没写 font-size：工具名和描述一起继承成 16px，属性统计被
    // Tailwind preflight 的 small{80%} 变成 12.8px，看起来就是"描述比工具名大一号"。
    expect(rule('.chatluna-studio-model-analysis-tool-copy > strong {')).toContain('font-size: var(--chatluna-studio-font-md)')
    expect(rule('.chatluna-studio-model-analysis-tool-copy > strong {')).toContain('font-family: var(--chatluna-studio-font-mono)')
    expect(rule('.chatluna-studio-model-analysis-tool-desc > span {')).toContain('font-size: var(--chatluna-studio-font-sm)')
    expect(rule('.chatluna-studio-model-analysis-tool-copy > small {')).toContain('font-size: var(--chatluna-studio-font-xs)')
  })
})
