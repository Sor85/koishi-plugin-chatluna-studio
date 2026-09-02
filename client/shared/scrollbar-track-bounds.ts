/**
 * 自定义滚动条轨道的可见区域计算。
 *
 * 提出来的是判定，不是 DOM 机械动作（ADR 0075）：「轨道从哪里开始」这件事由毛玻璃表头的
 * 存在与否决定，改坏了不会报错，只会表现为轨道压在表头上或者整条轨道缺一截。轨道元素的
 * 创建、样式写入与事件绑定仍然留在指令里。
 *
 * 注入的是最小结构接口而不是 DOM 类型：只需要沿祖先链上行、按选择器认出兄弟节点、以及读
 * 一个矩形，`HTMLElement` 天然满足这三项，测试写一个内存替身即可。
 */

export interface ScrollbarBoundsRect {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export interface ScrollbarBoundsNode {
  readonly parentElement: ScrollbarBoundsNode | null
  readonly children: ArrayLike<ScrollbarBoundsNode>
  matches(selector: string): boolean
  getBoundingClientRect(): ScrollbarBoundsRect
}

/**
 * 页内表头的选择器。ADR 0071 要求毛玻璃表头背后必须有真实滚动内容可采样，因此滚动内容会用
 * 负 margin 延伸到表头背后——原生内容需要延伸，滚动条轨道不应该跟着延伸。
 */
export const SCROLLBAR_HEADER_SELECTOR = 'header, .chatluna-studio-overlay-header'

/**
 * 沿祖先链寻找当前滚动区域**前面**的页内表头，返回它的底缘。
 *
 * 找前面的兄弟而不是任意后代：表头一定排在滚动区域之前，往后找会把内容区里的次级标题
 * 也当成表头，轨道会被无端截掉一大截。所有列表页（聊天、调试、MCP、预设、环境管理）
 * 共用这一条裁剪规则，因此判定按结构而不是按页面列举。
 *
 * 一个表头都没有时退回外壳顶缘；连外壳都没有时退回负无穷，即不裁剪。
 */
export function findScrollbarHeaderBottom(
  element: ScrollbarBoundsNode,
  shell: ScrollbarBoundsNode | undefined,
): number {
  let branch: ScrollbarBoundsNode | null = element
  while (branch && branch !== shell) {
    const parent: ScrollbarBoundsNode | null = branch.parentElement
    if (!parent) break
    const branchIndex = Array.prototype.indexOf.call(parent.children, branch)
    for (let index = branchIndex - 1; index >= 0; index -= 1) {
      const sibling = parent.children[index]
      if (sibling && sibling.matches(SCROLLBAR_HEADER_SELECTOR)) {
        return sibling.getBoundingClientRect().bottom
      }
    }
    branch = parent
  }
  return shell?.getBoundingClientRect().top ?? Number.NEGATIVE_INFINITY
}

export interface VisibleScrollbarRect extends ScrollbarBoundsRect {
  readonly width: number
  readonly height: number
}

/**
 * 轨道实际可以占用的矩形：滚动区域自身的矩形，先被表头底缘截顶，再被工作台外壳夹住四边。
 * 没有外壳时（Portal 浮层里的滚动区域）只截顶。
 */
export function computeVisibleScrollbarRect(
  element: ScrollbarBoundsNode,
  shellElement: ScrollbarBoundsNode | undefined,
): VisibleScrollbarRect {
  const rect = element.getBoundingClientRect()
  const shell = shellElement?.getBoundingClientRect()
  const topBoundary = findScrollbarHeaderBottom(element, shellElement)

  if (!shell) {
    const top = Math.max(rect.top, topBoundary)
    return {
      top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: Math.max(0, rect.right - rect.left),
      height: Math.max(0, rect.bottom - top),
    }
  }

  const top = Math.max(rect.top, shell.top, topBoundary)
  const right = Math.min(rect.right, shell.right)
  const left = Math.max(rect.left, shell.left)
  const bottom = Math.min(rect.bottom, shell.bottom)
  return {
    top,
    right,
    bottom,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}
