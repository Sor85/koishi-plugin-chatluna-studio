import {
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type VNode,
} from 'vue'
import { IconChevronDown } from '@tabler/icons-vue'
import {
  exceedsAnalysisLineLimit,
  shouldExpandAnalysisText,
} from './analysis'
import type { ModelRequestOccurrence } from './occurrence'
import { renderModelRequestOccurrence } from './occurrence'

/**
 * 分析卡的正文折叠块：正文 pre 与工具 JSON 结构树共用同一套折叠壳。
 *
 * from analysis-view.vue 抽离出来，单独成模块。
 */

export const AnalysisHighlightedText = defineComponent({
  props: {
    value: { type: String, default: '' },
    query: { type: String, default: '' },
  },
  setup(highlightProps) {
    return () => h('span', highlightText(highlightProps.value, highlightProps.query))
  },
})

export function highlightText(value: string, query: string): Array<string | VNode> {
  if (!query) return [value]
  const lower = value.toLocaleLowerCase('zh-CN')
  const nodes: Array<string | VNode> = []
  let offset = 0
  while (offset < value.length) {
    const index = lower.indexOf(query, offset)
    if (index < 0) {
      nodes.push(value.slice(offset))
      break
    }
    if (index > offset) nodes.push(value.slice(offset, index))
    nodes.push(h('mark', value.slice(index, index + query.length)))
    offset = index + query.length
  }
  return nodes
}

const AnalysisContentBlock = defineComponent({
  props: {
    label: String,
    value: { type: String, default: '' },
    searchQuery: { type: String, default: '' },
    maxLines: { type: Number, default: 12 },
    forceExpanded: Boolean,
    occurrence: Object as () => ModelRequestOccurrence | undefined,
    compact: Boolean,
  },
  setup(blockProps, { slots }) {
    const expanded = ref(false)
    const collapsible = ref(false)
    const collapsedHeight = ref('')
    const textWrap = ref<HTMLElement>()
    let resizeObserver: ResizeObserver | undefined

    // 正文行高可能随传入内容变化（文本走 pre，JSON 走树），但两者都是 text-wrap 的第一个
    // 子元素；量它而不是 text-wrap，既拿得到自己的行高，也避开展开按钮的高度。
    function measuredContent() {
      return textWrap.value?.firstElementChild as HTMLElement | undefined
    }

    function measureLines() {
      const element = measuredContent()
      if (!element) return
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight)
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
        collapsible.value = false
        return
      }
      collapsedHeight.value = `${lineHeight * blockProps.maxLines}px`
      collapsible.value = exceedsAnalysisLineLimit(element.scrollHeight, lineHeight, blockProps.maxLines)
    }

    watch(
      [() => blockProps.value, () => blockProps.maxLines],
      async () => {
        await nextTick()
        measureLines()
      },
    )
    watch(
      [() => blockProps.searchQuery, () => blockProps.forceExpanded],
      ([query, forceExpanded]) => {
        if (shouldExpandAnalysisText(expanded.value, forceExpanded, query, blockProps.value)) expanded.value = true
      },
      { immediate: true },
    )
    onMounted(async () => {
      await nextTick()
      measureLines()
      const element = measuredContent()
      if (typeof ResizeObserver === 'undefined' || !element) return
      // 观察内容节点，不是 text-wrap：折叠态下 text-wrap 被 max-height 裁住，JSON 树内部
      // 再展开或收起都不会改变它的盒子，展开按钮会卡在该出现时不出现、该消失时不消失。
      resizeObserver = new ResizeObserver(measureLines)
      resizeObserver.observe(element)
    })
    onBeforeUnmount(() => resizeObserver?.disconnect())

    // 载荷插槽与正文共用一套折叠壳：两者都挂在 text-wrap 上，测量与渐隐遮罩因此只有一份实现。
    const renderContent = () => {
      const wrapStyle = { '--chatluna-studio-model-analysis-collapse-height': collapsedHeight.value }
      if (slots.default) {
        return h('div', {
          ref: textWrap,
          style: wrapStyle,
          class: 'chatluna-studio-model-analysis-text-wrap is-payload',
        }, slots.default())
      }
      return h('div', { ref: textWrap, style: wrapStyle, class: 'chatluna-studio-model-analysis-text-wrap' }, [
        h('pre', {}, blockProps.occurrence
          ? renderModelRequestOccurrence(blockProps.value, blockProps.occurrence)
          : highlightText(blockProps.value, blockProps.searchQuery)),
      ])
    }

    return () => h('section', {
      class: ['chatluna-studio-model-analysis-section', { 'is-collapsed': collapsible.value && !expanded.value, 'is-compact': blockProps.compact }],
    }, [
      blockProps.label && h('strong', blockProps.label),
      renderContent(),
      collapsible.value && h('button', {
        type: 'button',
        class: 'chatluna-studio-model-analysis-expand',
        onClick: () => { expanded.value = !expanded.value },
      }, [
        expanded.value ? '收起' : `展开全部（${blockProps.value.length} 字符）`,
        h(IconChevronDown, { size: 12, 'aria-hidden': 'true' }),
      ]),
    ])
  },
})

export { AnalysisContentBlock }
