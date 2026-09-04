import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { readClientStylesheets } from './helpers/client-stylesheets'

/**
 * 悬浮导航栏（原顶栏），位于页面右侧。
 *
 * 这几条都属于「不报错、只是布局或交互静默变样」的形态，而且都会在改动侧栏几何时复发：
 *
 * - 展开必须由绝对定位卡片盖住内容。一旦改成加宽网格列，左侧列表与详情面板会跟着重排，
 *   鼠标扫过侧栏整页抖一次。
 * - 卡片必须靠 `right` 定位、行必须 `row-reverse`。否则展开时图标整列平移 144px，
 *   看起来像整条侧栏在跳。
 * - 标签宽度必须写死。按 `1fr` 分剩余空间时，文字会在整个宽度过渡过程里反复重排断行。
 * - `:hover` 与 `:has(:focus-visible)` 必须成对。只写 hover 时键盘 Tab 进侧栏既不展开也看不到落点；
 *   写成 `:focus-within` 则鼠标点完按钮仍留着焦点，卡片会一直展开盖住内容。
 * - 焦点环必须内缩。卡片 `overflow: hidden` 会把外扩描边整圈裁掉。
 * - 标签必须留在 DOM 里靠裁切隐藏。改成 `v-if`/`v-show` 后折叠态读屏软件读不到任何页面名。
 */

const page = readFileSync(resolve('client/workspace/page.vue'), 'utf8')
const styles = readFileSync(resolve('client/workspace/workspace.css'), 'utf8')

/** 取某条规则的声明块；选择器按「选择器 + 空格 + `{`」精确定位，不会误命中同前缀的块。 */
function rule(selector: string): string {
  const start = styles.indexOf(`${selector} {`)
  expect(start, `样式里没有 ${selector} 这条规则`).toBeGreaterThan(-1)
  return styles.slice(start).split('}')[0]!
}

function countOf(needle: string): number {
  return styles.split(needle).length - 1
}

describe('工作室悬浮导航栏', () => {
  it('工作区是「内容列 + 右侧导航列」两列网格，内容落在第一列', () => {
    const workspace = rule('.chatluna-studio-workspace')
    expect(workspace).toContain('grid-template-columns: minmax(0, 1fr) var(--chatluna-studio-sidebar-column)')
    expect(workspace).toContain('grid-template-rows: minmax(0, 1fr)')
    // 列宽由折叠宽度推出，改图标尺寸时不需要同时改字面列宽；折叠宽度里的 2px 是卡片自己的
    // 左右边框（border-box），漏算时卡片内容宽比图标盒窄 2px，折叠态图标被裁掉一条边。
    expect(workspace).toContain('--chatluna-studio-sidebar-rail: calc(var(--chatluna-studio-sidebar-icon) + var(--chatluna-studio-sidebar-pad) * 2 + 2px)')
    // 列宽只算「卡片 + 一份外侧留白」：那份留白落在卡片右边，左边那段由内容区自己的 padding 提供。
    // 写成 `* 2` 会让左边多出一份留白，卡片看着偏右贴边。
    expect(workspace).toContain('--chatluna-studio-sidebar-column: calc(var(--chatluna-studio-sidebar-rail) + var(--chatluna-studio-sidebar-inset))')

    expect(rule('.chatluna-studio-sidebar')).toContain('grid-column: 2')
    const chat = rule('.chatluna-studio-chat')
    expect(chat).toContain('grid-column: 1')
    expect(chat).toContain('grid-row: 1')
  })

  it('卡片两侧留白同源：外侧留白与内容区 padding 取同一个令牌', () => {
    // 左边那段距离由内容区自己的右 padding 提供，右边那段是卡片的外侧留白。两者必须取同一个值，
    // 否则卡片在内容卡片与窗口边缘之间不居中；各写一份字面 24px 时，改一处不会报错，只会悄悄偏心。
    expect(rule('.chatluna-studio-workspace')).toContain('--chatluna-studio-region-padding: 24px')
    expect(rule('.chatluna-studio-workspace')).toContain('--chatluna-studio-sidebar-inset: var(--chatluna-studio-region-padding)')
    for (const path of ['client/model-request/styles.css', 'client/preset/styles.css']) {
      const source = readFileSync(resolve(path), 'utf8')
      expect(source, `${path} 的内容区 padding 必须取令牌`).toContain('padding: var(--chatluna-studio-region-padding)')
      expect(source, `${path} 不应再出现字面 24px 的区域 padding`).not.toMatch(/^\s*padding: 24px;$/m)
    }
  })

  it('展开只改卡片宽度，不动网格列宽；卡片贴右边缘并垂直居中', () => {
    const sidebar = rule('.chatluna-studio-sidebar')
    expect(sidebar).toContain('position: relative')
    // 展开后的卡片盖在内容之上；不给层级时内容里带定位的面板会盖住它，文字只露一半。
    expect(sidebar).toMatch(/z-index: \d+/)

    const rail = rule('.chatluna-studio-sidebar-rail')
    expect(rail).toContain('position: absolute')
    expect(rail).toContain('width: var(--chatluna-studio-sidebar-rail)')
    expect(rail).toContain('overflow: hidden')
    expect(rail).toContain('transition: width 0.18s ease')
    // 靠 right 定位：右边缘固定，宽度增长自然向左展开，图标那一列不会平移。
    expect(rail).toContain('right: var(--chatluna-studio-sidebar-inset)')
    expect(rail).not.toContain('left:')
    // 垂直居中三件套。少了 height: max-content，绝对定位盒会被上下定位值拉满整列高度，
    // margin: auto 没有剩余空间可分，卡片静默变成一条通高白板。
    expect(rail).toContain('inset-block: var(--chatluna-studio-sidebar-inset)')
    expect(rail).toContain('height: max-content')
    expect(rail).toContain('margin-block: auto')

    const open = styles
      .match(/\.chatluna-studio-sidebar-rail:hover,\s*\n\.chatluna-studio-sidebar-rail:has\(:focus-visible\) \{([^}]*)\}/)?.[1] ?? ''
    expect(open.split(';').map((line) => line.trim()).filter(Boolean))
      .toEqual(['width: var(--chatluna-studio-sidebar-rail-open)'])
  })

  it('行按 row-reverse 排，图标钉在右端', () => {
    const row = rule('.chatluna-studio-sidebar-item')
    expect(row).toContain('flex-direction: row-reverse')
    expect(row).toContain('text-align: right')
  })

  it('悬停与键盘聚焦两种展开途径成对存在，且不误认鼠标点击留下的焦点', () => {
    // 两处：展开卡片、显示标签。
    expect(countOf('.chatluna-studio-sidebar-rail:has(:focus-visible)')).toBe(2)
    expect(countOf('.chatluna-studio-sidebar-rail:hover')).toBe(countOf('.chatluna-studio-sidebar-rail:has(:focus-visible)'))
    expect(styles).not.toContain('.chatluna-studio-sidebar-rail:focus-within')
  })

  it('标签宽度写死成展开后的可用宽度，不按剩余空间分配', () => {
    const label = rule('.chatluna-studio-sidebar-label')
    expect(label).toContain('width: calc(var(--chatluna-studio-sidebar-rail-open) - var(--chatluna-studio-sidebar-rail) - var(--chatluna-studio-sidebar-gap))')
    expect(label).toContain('flex: none')
    expect(label).toContain('white-space: nowrap')
    expect(label).toContain('overflow: hidden')
    expect(label).not.toContain('1fr')
  })

  it('激活项取强调色，焦点环内缩到卡片裁切范围内', () => {
    expect(rule('.chatluna-studio-sidebar-item.is-active')).toContain('color: var(--chatluna-studio-accent)')
    expect(rule('.chatluna-studio-sidebar-item:focus-visible')).toContain('outline-offset: -2px')
  })

  it('阴影是轻微抬起，实体态底色实心、雾化态换成毛玻璃，且亮暗两套成对', () => {
    // secondary-shadow 是给 Portal 浮层用的重投影，落在这张小卡片上会比周围只有 1px 边框的面板
    // 重一个量级；暗色那一份也不能漏，rgb(15 23 42) 在暗底上几乎看不出来，卡片会失去边界。
    const rail = rule('.chatluna-studio-sidebar-rail')
    expect(rail).not.toContain('var(--chatluna-studio-secondary-shadow)')
    expect(rail).toMatch(/box-shadow: 0 4px 12px rgb\(15 23 42 \/ \d+%\)/)
    expect(rule('.chatluna-studio-workspace[data-color-mode="dark"] .chatluna-studio-sidebar-rail'))
      .toMatch(/box-shadow: 0 4px 12px rgb\(9 9 11 \/ \d+%\)/)

    // 实体外观下底色必须实心：卡片展开时盖在滚动内容之上，半透明而没有模糊兜底时
    // 底下的列表文字会直接透过图标。
    expect(rail).toContain('background: var(--chatluna-studio-bg)')
    expect(rail).not.toMatch(/background:[^;]*(?:color-mix|transparent|rgb\([^)]*\/)/)

    // 雾化外观下改成半透明 + 模糊。模糊必须落在无后代的 ::before 上（写在卡片本体会让卡片
    // 成为 Backdrop Root，卡片内控件的模糊全部失效，ADR-0019），卡片本体则必须让出实心底色，
    // 否则那层实心背景整片盖住模糊层，看起来像毛玻璃没生效。
    const frosted = rule('.chatluna-studio-workspace.is-frosted .chatluna-studio-sidebar-rail')
    expect(frosted).toContain('background: transparent')
    expect(frosted).not.toContain('backdrop-filter')
    const frostedSurface = rule('.chatluna-studio-workspace.is-frosted .chatluna-studio-sidebar-rail::before')
    expect(frostedSurface).toContain('backdrop-filter: saturate(180%) blur(20px)')
    expect(frostedSurface).toContain('background: color-mix(in srgb, var(--chatluna-studio-bg) 72%, transparent)')
    // 绝对定位的 ::before 取默认层级会盖在图标之上，把图标和标签一起吸进模糊层。
    expect(frostedSurface).toContain('z-index: -1')
    expect(frostedSurface).toContain('content: ""')
  })

  it('页面结构：卡片本身就是 nav，只有两个视图入口，标签常驻 DOM', () => {
    expect(page).toContain('<nav class="chatluna-studio-sidebar-rail" aria-label="工作室页面">')
    expect(page).toContain("shell.selectView('model-requests')")
    expect(page).toContain("shell.selectView('presets')")
    expect(page).toContain(`:aria-current="currentView === 'model-requests' ? 'page' : undefined"`)
    expect(page).toContain(`:aria-current="currentView === 'presets' ? 'page' : undefined"`)
    expect(page).toContain('<span class="chatluna-studio-sidebar-label">模型请求</span>')
    expect(page).toContain('<span class="chatluna-studio-sidebar-label">预设</span>')
    // 折叠靠裁切而不是卸载：标签一旦上 v-if/v-show，折叠态读屏软件读不到任何页面名。
    expect(page).not.toMatch(/chatluna-studio-sidebar-label"[^>]*v-(?:if|show)/)
  })

  it('品牌行与持久化状态行连带样式、取词、图标导入一起摘干净', () => {
    // 只删模板不删取词与导入时，它们会变成没人用的死代码，构建不报错也不会有任何提示。
    for (const gone of [
      'chatluna-studio-sidebar-brand',
      'chatluna-studio-sidebar-nav',
      'chatluna-studio-sidebar-status',
      'IconSparkles',
      'IconDatabase',
      'persistenceLabel',
      'shell.persistence',
      'ChatLuna 工作室',
    ]) {
      expect(page, `page.vue 仍留着 ${gone}`).not.toContain(gone)
    }
    for (const source of readClientStylesheets()) {
      for (const gone of [
        'chatluna-studio-sidebar-brand',
        'chatluna-studio-sidebar-nav',
        'chatluna-studio-sidebar-status',
      ]) {
        expect(source, `样式表仍留着 ${gone}`).not.toContain(gone)
      }
    }
  })

  it('顶栏在模板与全部样式表里都不再留下类名', () => {
    expect(page).not.toContain('chatluna-studio-topbar')
    for (const source of readClientStylesheets()) {
      expect(source).not.toContain('chatluna-studio-topbar')
    }
  })
})
