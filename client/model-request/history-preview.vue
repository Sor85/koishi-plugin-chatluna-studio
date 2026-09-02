<template>
  <section
    ref="previewElement"
    class="chatluna-studio-model-history-preview-wrap"
    :class="{ 'is-collapsed': collapsible && !expanded }"
    :style="{ '--chatluna-studio-model-history-collapse-height': collapsedHeight }"
  >
    <div class="chatluna-studio-model-history-preview" role="list" aria-label="历史消息预览">
      <!-- 一个 Provider 覆盖整段历史：每条消息各自挂一个 Provider 会让组件实例随消息数线性增长。 -->
      <TooltipProvider :delay-duration="500">
        <article
          v-for="entry in displayMessages"
          :key="entry.key"
          class="chatluna-studio-model-history-message"
          :class="{ 'is-bot': entry.isBot }"
          role="listitem"
        >
          <HistoryQuote v-if="entry.message.quote" :message="entry.message.quote" />
          <div class="chatluna-studio-model-history-line">
            <div v-if="entry.metadata.length" class="chatluna-studio-model-history-meta" aria-label="消息元数据">
              <Tooltip v-for="item in entry.metadata" :key="item.key">
                <TooltipTrigger as-child>
                  <Badge
                    variant="secondary"
                    :class="metadataClass(entry, item)"
                    tabindex="0"
                  >{{ item.value }}</Badge>
                </TooltipTrigger>
                <TooltipContent>{{ item.label }}：{{ item.value }}</TooltipContent>
              </Tooltip>
            </div>
            <span class="chatluna-studio-model-history-content">
              <span
                v-for="(line, lineIndex) in entry.lines"
                :key="lineIndex"
                class="chatluna-studio-model-history-content-line"
                :class="{ 'is-single-visual-line': singleVisualLines.has(entry.lineKeys[lineIndex]!) }"
                :data-history-content-line="entry.lineKeys[lineIndex]"
              >{{ line }}</span>
            </span>
          </div>
        </article>
      </TooltipProvider>
    </div>
    <button
      v-if="collapsible"
      type="button"
      class="chatluna-studio-model-analysis-expand chatluna-studio-model-history-expand"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收起' : `展开全部（${characters} 字符）` }}
      <IconChevronDown :size="12" aria-hidden="true" />
    </button>
  </section>
</template>

<script setup lang="ts">
import { IconChevronDown } from '@tabler/icons-vue'
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch, type PropType, type VNode } from 'vue'
import { Badge } from '#client/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '#client/components/ui/tooltip'
import type { ModelRequestHistoryMessage } from './history'

const props = withDefaults(defineProps<{
  messages: readonly ModelRequestHistoryMessage[]
  botId?: string
  characters?: number
  maxHeight?: number
}>(), {
  maxHeight: 420,
})

const expanded = ref(false)
const collapsible = ref(false)
const collapsedHeight = computed(() => `${props.maxHeight}px`)
const previewElement = ref<HTMLElement>()
const characters = computed(() => props.characters ?? props.messages.reduce((total, message) => total + historyMessageCharacters(message), 0))
const singleVisualLines = ref(new Set<string>())
let resizeObserver: ResizeObserver | undefined
let measureFrame = 0

interface MetadataItem {
  key: 'name' | 'id' | 'timestamp'
  label: string
  value: string
}

interface HistoryDisplayMessage {
  key: string
  message: ModelRequestHistoryMessage
  metadata: MetadataItem[]
  lines: string[]
  lineKeys: string[]
  isBot: boolean
}

/**
 * 逐条消息的渲染事实预先算好。
 *
 * 元数据数组、内容分行和行标识原先都是模板里的函数调用：元数据一条消息算两次，
 * 分行与行标识每次重渲染都重算一遍，长 history 变量下这些分配比渲染本身还贵。
 */
const displayMessages = computed<HistoryDisplayMessage[]>(() => props.messages.map((message, index) => {
  const isBot = Boolean(props.botId && message.id === props.botId)
  const items = [
    message.name ? { key: 'name', label: '名称', value: message.name } : undefined,
    message.id ? { key: 'id', label: 'ID', value: message.id } : undefined,
    message.timestamp ? { key: 'timestamp', label: '时间', value: message.timestamp } : undefined,
  ].filter((item): item is MetadataItem => item !== undefined)
  const identity = message.messageId || message.id || message.name || 'message'
  const lines = (message.content || '（空消息）').split(/\r\n|\r|\n/)
  return {
    key: `${identity}:${index}`,
    message,
    metadata: isBot ? items.reverse() : items,
    lines,
    lineKeys: lines.map((_line, lineIndex) => `${identity}:${index}:${lineIndex}`),
    isBot,
  }
}))

function historyMessageCharacters(message: ModelRequestHistoryMessage): number {
  return (message.name?.length ?? 0)
    + (message.id?.length ?? 0)
    + (message.timestamp?.length ?? 0)
    + message.content.length
    + (message.quote ? historyMessageCharacters(message.quote) : 0)
}

// 量测会写回 CSS 变量，而写回本身可能再次触发 ResizeObserver；合并到一帧执行，
// 并在结果没有变化时不写响应式状态，让这个回路自然收敛。
function scheduleMeasure() {
  if (measureFrame) return
  measureFrame = requestAnimationFrame(() => {
    measureFrame = 0
    measurePreview()
  })
}

function measurePreview() {
  const preview = previewElement.value?.querySelector<HTMLElement>('.chatluna-studio-model-history-preview')
  if (!preview) return
  measureContentWidths(preview)
  collapsible.value = preview.scrollHeight > props.maxHeight + 1
}

interface MeasuredMessage {
  message: HTMLElement
  line: HTMLElement
  content: HTMLElement
}

function measureContentWidths(preview: HTMLElement) {
  const parts: MeasuredMessage[] = []
  for (const message of preview.querySelectorAll<HTMLElement>('.chatluna-studio-model-history-message')) {
    const line = message.querySelector<HTMLElement>('.chatluna-studio-model-history-line')
    const content = message.querySelector<HTMLElement>('.chatluna-studio-model-history-content')
    if (line && content) parts.push({ message, line, content })
  }

  // 清除、读取、写回分成三趟。读写交替时每条消息都会强制一次重排，长 history 下这正是卡顿来源。
  for (const { content } of parts) content.style.removeProperty('--chatluna-studio-model-history-content-max-width')
  const previewRect = preview.getBoundingClientRect()
  const cardCenter = previewRect.left + previewRect.width / 2
  const widths = parts.map(({ message, line }) => {
    const lineRect = line.getBoundingClientRect()
    const width = message.classList.contains('is-bot')
      ? lineRect.right - cardCenter
      : cardCenter - lineRect.left
    return Math.max(0, Math.min(lineRect.width, width))
  })
  parts.forEach(({ content }, index) => {
    content.style.setProperty('--chatluna-studio-model-history-content-max-width', `${widths[index]}px`)
  })

  const nextSingleVisualLines = measureSingleVisualLines(parts)
  if (!sameSet(singleVisualLines.value, nextSingleVisualLines)) {
    singleVisualLines.value = nextSingleVisualLines
  }
}

function measureSingleVisualLines(parts: readonly MeasuredMessage[]): Set<string> {
  const contentLines = parts.flatMap(({ content }) => [...content.querySelectorAll<HTMLElement>('[data-history-content-line]')])
  const single = new Set<string>()
  if (!contentLines.length) return single
  // 内容行是等行高的块级纯文本，用高度判断折行；逐行建 Range 再取 getClientRects
  // 会随行数线性增加强制重排，长 history 变量下是最贵的一段量测。
  const lineHeight = Number.parseFloat(getComputedStyle(contentLines[0]!).lineHeight)
  const measurable = Number.isFinite(lineHeight) && lineHeight > 0
  for (const contentLine of contentLines) {
    const key = contentLine.dataset.historyContentLine
    if (!key) continue
    const wrapped = measurable
      ? contentLine.getBoundingClientRect().height > lineHeight * 1.5
      : visualLineCount(contentLine) > 1
    if (!wrapped) single.add(key)
  }
  return single
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && Array.from(left).every(value => right.has(value))
}

function visualLineCount(element: HTMLElement): number {
  const range = document.createRange()
  range.selectNodeContents(element)
  return new Set(Array.from(range.getClientRects(), rect => Math.round(rect.top * 100) / 100)).size
}

watch(
  [() => props.messages, () => props.maxHeight],
  async () => {
    await nextTick()
    measurePreview()
  },
)

onMounted(async () => {
  await nextTick()
  measurePreview()
  const preview = previewElement.value?.querySelector<HTMLElement>('.chatluna-studio-model-history-preview')
  if (typeof ResizeObserver === 'undefined' || !preview) return
  resizeObserver = new ResizeObserver(scheduleMeasure)
  resizeObserver.observe(preview)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (measureFrame) cancelAnimationFrame(measureFrame)
  measureFrame = 0
})

function metadataClass(entry: HistoryDisplayMessage, item: MetadataItem): string | undefined {
  if (item.key === 'id') return 'is-id'
  if (item.key !== 'name' || !props.botId) return undefined
  return entry.isBot ? 'is-name is-bot' : 'is-name is-user'
}

const HistoryQuote = defineComponent({
  name: 'HistoryQuote',
  props: {
    message: { type: Object as PropType<ModelRequestHistoryMessage>, required: true },
  },
  setup(quoteProps) {
    return () => renderHistoryQuote(quoteProps.message)
  },
})

function renderHistoryQuote(message: ModelRequestHistoryMessage): VNode {
  return h('blockquote', { class: 'chatluna-studio-message-quote chatluna-studio-model-history-quote' }, [
    h('strong', { class: 'chatluna-studio-message-quote-title' }, [
      message.name || '引用消息',
      message.id ? h('span', { class: 'chatluna-studio-model-history-quote-id' }, ` · ${message.id}`) : undefined,
    ]),
    message.quote ? renderHistoryQuote(message.quote) : undefined,
    h('span', message.content || '（空消息）'),
  ])
}
</script>
