<template>
  <section ref="trajectoryElement" class="chatluna-studio-model-trajectory" :class="{ 'is-analysis': analysis }" aria-label="模型请求轨迹">
    <div v-if="loading && !trajectory" class="chatluna-studio-model-request-empty">正在组装轨迹…</div>
    <div v-else-if="!trajectory?.rows.length" class="chatluna-studio-model-request-empty">当前记录没有可投影的轨迹</div>
    <template v-else>
      <div ref="stickyHeaderElement" class="chatluna-studio-model-trajectory-header chatluna-studio-overlay-header">
        <header v-if="showModeSwitch || mode === 'conversation'" class="chatluna-studio-model-trajectory-scope">
      <div v-if="showModeSwitch" class="chatluna-studio-model-trajectory-mode" role="tablist" aria-label="轨迹范围">
        <Button
          size="sm"
          :variant="mode === 'request' ? 'secondary' : 'ghost'"
          role="tab"
          :aria-selected="mode === 'request'"
          @click="$emit('update:mode', 'request')"
        >
          单请求
        </Button>
        <Button
          size="sm"
          :variant="mode === 'conversation' ? 'secondary' : 'ghost'"
          role="tab"
          :aria-selected="mode === 'conversation'"
          :disabled="!conversationAvailable"
          @click="$emit('update:mode', 'conversation')"
        >
          完整会话
        </Button>
      </div>
      <div class="chatluna-studio-model-trajectory-summary">
        <span>{{ trajectory?.records.length ?? 0 }} 次请求</span>
        <span>{{ trajectory?.rows.length ?? 0 }} 条事件</span>
      </div>
        </header>

      <div class="chatluna-studio-model-trajectory-sticky-header">
        <div class="chatluna-studio-model-trajectory-controls" role="toolbar" aria-label="轨迹显示控制">
        <div class="chatluna-studio-model-trajectory-control-actions">
          <Button
            v-if="mode === 'conversation'"
            size="sm"
            :variant="actualDuration ? 'secondary' : 'ghost'"
            :aria-pressed="actualDuration"
            aria-label="按实际耗时显示请求跨度"
            @click="actualDuration = !actualDuration"
          >
            <IconClockHour4 data-icon="inline-start" aria-hidden="true" />
            耗时
          </Button>
          <Button
            v-if="mode === 'conversation' && !analysis"
            size="sm"
            variant="ghost"
            :aria-pressed="trajectorySortOrder === 'desc'"
            :aria-label="trajectorySortOrder === 'desc' ? '当前请求按倒序排列，点击改为正序' : '当前请求按正序排列，点击改为倒序'"
            @click="trajectorySortOrder = trajectorySortOrder === 'desc' ? 'asc' : 'desc'"
          >
            <IconSortDescending v-if="trajectorySortOrder === 'desc'" data-icon="inline-start" aria-hidden="true" />
            <IconSortAscending v-else data-icon="inline-start" aria-hidden="true" />
            {{ trajectorySortOrder === 'desc' ? '倒序' : '正序' }}
          </Button>
          <Button
            v-if="!analysis"
            size="sm"
            variant="ghost"
            :aria-pressed="requestsCollapsed"
            :aria-label="requestsCollapsed ? '展开请求内事件' : '折叠请求内事件'"
            @click="requestsCollapsed = !requestsCollapsed"
          >
            <IconSquarePlus v-if="requestsCollapsed" data-icon="inline-start" aria-hidden="true" />
            <IconSquareMinus v-else data-icon="inline-start" aria-hidden="true" />
            请求
          </Button>
          <Button
            v-for="option in pinnedKindOptions"
            :key="option.kind"
            size="sm"
            variant="ghost"
            :aria-pressed="hiddenKinds.has(option.kind)"
            :aria-label="`${hiddenKinds.has(option.kind) ? '显示' : '隐藏'} ${option.label} 证据`"
            @click="hiddenKinds = toggleFilterMember(hiddenKinds, option.kind)"
          >
            <IconSquarePlus v-if="hiddenKinds.has(option.kind)" data-icon="inline-start" aria-hidden="true" />
            <IconSquareMinus v-else data-icon="inline-start" aria-hidden="true" />
            {{ option.label }}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            :aria-expanded="filtersExpanded"
            :aria-controls="moreFiltersId"
            :aria-label="filtersExpanded ? '收起更多过滤选项' : '展开更多过滤选项'"
            @click="filtersExpanded = !filtersExpanded"
          >
            <IconChevronLeft v-if="filtersExpanded" data-icon="inline-start" aria-hidden="true" />
            <IconChevronRight v-else data-icon="inline-start" aria-hidden="true" />
            {{ filtersExpanded ? '收起' : '更多' }}
          </Button>
        </div>
        <div
          :id="moreFiltersId"
          class="chatluna-studio-model-trajectory-control-filters"
          :class="{ 'is-collapsed': !filtersExpanded }"
          role="group"
          aria-label="更多证据过滤"
        >
          <div class="chatluna-studio-model-trajectory-control-filters-inner">
            <Button
              v-for="option in collapsedKindOptions"
              :key="option.kind"
              size="sm"
              variant="ghost"
              :aria-pressed="hiddenKinds.has(option.kind)"
              :aria-label="`${hiddenKinds.has(option.kind) ? '显示' : '隐藏'} ${option.label} 证据`"
              @click="hiddenKinds = toggleFilterMember(hiddenKinds, option.kind)"
            >
              <IconSquarePlus v-if="hiddenKinds.has(option.kind)" data-icon="inline-start" aria-hidden="true" />
              <IconSquareMinus v-else data-icon="inline-start" aria-hidden="true" />
              {{ option.label }}
            </Button>
          </div>
        </div>
        <div class="chatluna-studio-model-trajectory-control-query">
          <div
            v-if="compositionTracks.length"
            class="chatluna-studio-model-trajectory-composition-zoom"
            role="group"
            aria-label="轨道缩放"
          >
            <template v-if="compositionZoom > COMPOSITION_ZOOM_MIN">
              <Button
                class="chatluna-studio-model-trajectory-composition-zoom-value"
                size="sm"
                variant="ghost"
                aria-label="重置轨道缩放"
                @click="setCompositionZoom(COMPOSITION_ZOOM_MIN)"
              >
                {{ Math.round(compositionZoom * 100) }}%
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="缩小轨道"
                @click="setCompositionZoom(compositionZoom - COMPOSITION_ZOOM_STEP)"
              >
                <IconZoomOut aria-hidden="true" />
              </Button>
            </template>
            <Button
              size="icon-sm"
              variant="ghost"
              :disabled="compositionZoom >= COMPOSITION_ZOOM_MAX"
              aria-label="放大轨道"
              @click="setCompositionZoom(compositionZoom + COMPOSITION_ZOOM_STEP)"
            >
              <IconZoomIn aria-hidden="true" />
            </Button>
          </div>
          <label class="chatluna-studio-model-trajectory-search">
            <IconSearch aria-hidden="true" />
            <Input v-model="searchQuery" type="search" aria-label="搜索轨迹事件" placeholder="搜索" />
          </label>
        </div>
      </div>

      <TooltipProvider :delay-duration="500">
        <div v-if="compositionTracks.length" class="chatluna-studio-model-trajectory-composition-shell">
          <section
            class="chatluna-studio-model-trajectory-composition"
            :style="{ minHeight: `${Math.max(50, compositionTracks.length * 14 + 8)}px` }"
            aria-label="请求体提示词内容占比"
          >
            <div class="chatluna-studio-model-trajectory-composition-labels" aria-hidden="true">
              <span v-for="track in compositionTracks" :key="track.kind">{{ evidenceTitleLabel(track.kind) }}</span>
            </div>
            <div
              ref="compositionViewport"
              class="chatluna-studio-model-trajectory-composition-viewport"
              :class="{ 'is-dragging': compositionDragging }"
              @wheel="handleCompositionWheel"
              @pointerdown="handleCompositionPointerDown"
              @pointermove="handleCompositionPointerMove"
              @pointerup="finishCompositionDrag"
              @pointercancel="finishCompositionDrag"
              @click.capture="handleCompositionClickCapture"
            >
              <div
                class="chatluna-studio-model-trajectory-composition-tracks"
                :style="{ width: `${compositionZoom * 100}%` }"
              >
                <span
                  v-for="boundary in compositionBoundaries"
                  :key="boundary.id"
                  class="chatluna-studio-model-trajectory-boundary"
                  :style="{ left: `${boundary.left}%` }"
                  aria-hidden="true"
                />
                <div v-for="track in compositionTracks" :key="track.kind" class="chatluna-studio-model-trajectory-composition-track">
                  <Tooltip v-for="segment in track.segments" :key="segment.id">
                    <TooltipTrigger as-child>
                      <button
                        type="button"
                        class="chatluna-studio-model-trajectory-composition-bar"
                        :class="[
                          `is-${segment.kind}`,
                          { 'is-variable': segment.variableId, 'is-selected': isCompositionSegmentSelected(segment) },
                        ]"
                        :style="{ left: `${segment.left}%`, width: `${segment.width}%` }"
                        :aria-label="segment.variableName
                          ? `变量 ${segment.variableName} 占请求体提示内容的 ${formatPercentage(segment.percentage)}`
                          : `${evidenceTitleLabel(segment.kind)} 占请求体提示内容的 ${formatPercentage(segment.percentage)}`"
                        @click="selectPromptSegment(segment)"
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <strong>{{ segment.variableName ? `${evidenceTitleLabel('variable')} · ${segment.variableName}` : evidenceTitleLabel(segment.kind) }} · {{ formatPercentage(segment.percentage) }}</strong>
                      <span>{{ segment.characters.toLocaleString('zh-CN') }} 个字符</span>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          </section>
        </div>
        <div v-else class="chatluna-studio-model-trajectory-composition-empty">
          {{ mode === 'conversation' ? '当前会话没有可投影的请求组成' : '当前请求体没有可统计的提示词内容' }}
        </div>
        </TooltipProvider>
      </div>
        <p v-if="mode === 'conversation' && hasUnknownTiming" class="chatluna-studio-model-trajectory-timing-note">
          进行中的请求仅标记开始位置；TTFT 与解码阶段尚无独立时间证据
        </p>
      </div>

      <ModelRequestConversationAnalysis
        v-if="analysis && detail"
        :detail="detail"
        :trajectory="trajectory"
        :search-query="searchQuery"
        :locate-request="analysisLocateRequest"
        :filter="evidenceFilter"
        @locate-result="emit('locate-result', $event)"
      />
      <div v-else class="chatluna-studio-model-trajectory-ledger" :class="{ 'has-inspector': selectedRow }">
        <div ref="ledgerElement" v-chatluna-studio-scrollbar="{ showOverlay: false }" class="chatluna-studio-model-trajectory-table" role="table" aria-label="轨迹事件账本">
          <div v-if="!ledgerRows.length" class="chatluna-studio-model-trajectory-filter-empty">当前过滤条件下没有事件</div>
          <template v-for="row in orderedLedgerRows" :key="row.id">
            <button
              v-if="row.kind === 'request'"
              type="button"
              class="chatluna-studio-model-trajectory-request-boundary"
              :aria-expanded="!collapsedRequestIds.has(row.requestId ?? '')"
              :aria-label="collapsedRequestIds.has(row.requestId ?? '') ? `展开${requestLabel(row.requestId)}` : `折叠${requestLabel(row.requestId)}`"
              role="row"
              @click="toggleRequestCollapsed(row)"
            >
              <span class="chatluna-studio-model-trajectory-request-title">
                <IconChevronDown class="chatluna-studio-model-trajectory-request-chevron" :class="{ 'is-collapsed': collapsedRequestIds.has(row.requestId ?? '') }" :size="14" aria-hidden="true" />
                <span class="chatluna-studio-model-trajectory-request-dot" :class="statusClass(row.status)" aria-hidden="true" />
                <span>{{ requestOrdinal(row.requestId) }}</span>
              </span>
              <span>{{ requestLabel(row.requestId) }}</span>
              <time>{{ row.durationMs === undefined ? '—' : formatDuration(row.durationMs) }}</time>
            </button>
            <button
              v-else-if="!isRequestRowCollapsed(row)"
              type="button"
              class="chatluna-studio-model-trajectory-row"
              :class="[
                `is-${row.kind}`,
                row.source === 'response' ? 'is-response' : '',
                {
                  'is-selected': row.id === selectedRowId,
                  'is-search-muted': isRowSearchMuted(row),
                },
              ]"
              role="row"
              @click="selectedRowId = row.id"
            >
              <span role="cell" class="chatluna-studio-model-trajectory-kind">{{ kindLabel(row.kind) }}</span>
              <span role="cell" class="chatluna-studio-model-trajectory-preview">{{ row.preview }}</span>
            </button>
          </template>
        </div>

        <aside v-if="selectedRow" class="chatluna-studio-model-trajectory-inspector" aria-label="轨迹请求分析">
          <header>
            <div>
              <span v-if="selectedRequest" class="chatluna-studio-model-trajectory-inspector-title">{{ requestLabel(selectedRow.requestId) }}</span>
            </div>
            <div class="chatluna-studio-model-trajectory-inspector-actions">
              <Button v-if="selectedRequest" variant="outline" size="sm" @click="openSelectedRequest">
                <IconExternalLink data-icon="inline-start" aria-hidden="true" />
                打开原始请求
              </Button>
              <Button class="chatluna-studio-model-trajectory-inspector-close" variant="ghost" size="icon-sm" aria-label="关闭检查器" @click="selectedRowId = ''">
                <IconX aria-hidden="true" />
              </Button>
            </div>
          </header>
          <div v-chatluna-studio-scrollbar="{ showOverlay: false }" class="chatluna-studio-model-trajectory-inspector-body">
            <ModelRequestConversationAnalysis
              v-if="inspectorDetail"
              layout="inspector"
              :detail="inspectorDetail"
              :search-query="searchQuery"
              :locate-request="inspectorLocateRequest"
              :filter="evidenceFilter"
            />
            <div v-else class="chatluna-studio-model-request-empty">正在加载分析…</div>
          </div>
        </aside>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClockHour4,
  IconExternalLink,
  IconSearch,
  IconSortAscending,
  IconSortDescending,
  IconSquareMinus,
  IconSquarePlus,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-vue'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { Button } from '#client/components/ui/button'
import { Input } from '#client/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '#client/components/ui/tooltip'
import ModelRequestConversationAnalysis from './analysis-view.vue'
import type { EvidenceNavigation, EvidenceViewRestore } from '#client/shared/evidence-navigation'
import type { LocateRequest } from '#client/shared/evidence-locator'
import {
  buildModelRequestTrajectorySearchMutes,
  buildModelRequestTrajectorySearchTexts,
  filterModelRequestTrajectoryRows,
  isModelRequestTrajectoryRowCollapsed,
  orderModelRequestTrajectoryRows,
  toggleModelRequestTrajectoryCollapse,
  type ModelRequestTrajectorySortOrder,
} from './trajectory-display'
import {
  COMPOSITION_ZOOM_MAX,
  COMPOSITION_ZOOM_MIN,
  COMPOSITION_ZOOM_STEP,
  createCompositionZoomPan,
} from './composition-zoom-pan'
import {
  formatModelRequestLabel,
  formatModelRequestOrdinal,
} from './overview'
import { createScrollRestore } from '#client/shared/scroll-restore'
import { formatDuration } from '#client/shared/format-duration'
import {
  MODEL_EVIDENCE_FILTER_KINDS,
  toggleFilterMember,
} from './filter'
import { studioEvidenceLabels, type StudioEvidenceKind } from '../../src/evidence-kind'
import { vStudioScrollbar } from '#client/shared/scrollbar'
import type {
  StudioModelRequestDetail,
  StudioModelRequestPromptKind,
  StudioModelRequestStatus,
  StudioModelRequestTrajectory,
  StudioModelRequestTrajectoryKind,
  StudioModelRequestTrajectoryRow,
} from '../../src/types'

const props = withDefaults(defineProps<{
  trajectory?: StudioModelRequestTrajectory
  detail?: StudioModelRequestDetail
  mode: 'request' | 'conversation'
  loading: boolean
  conversationAvailable: boolean
  navigation: EvidenceNavigation
  showModeSwitch?: boolean
  analysis?: boolean
  externalLocate?: LocateRequest
  /** 工作台内视图快照；seq 触发一次位置恢复，与定位信号使用同一种词汇。 */
  restoreState?: EvidenceViewRestore
}>(), {
  showModeSwitch: true,
  analysis: false,
})

const emit = defineEmits<{
  'update:mode': [mode: 'request' | 'conversation']
  'open-request': [payload: {
    recordId: string
    returnState: {
      rowId: string
      scrollTop: number
    }
  }]
  'inspect-request': [payload: { recordId: string }]
  'locate-result': [result: { seq: number, located: boolean }]
}>()

const trajectoryElement = ref<HTMLElement>()
const stickyHeaderElement = ref<HTMLElement>()
let stickyHeaderResizeObserver: ResizeObserver | undefined
const ledgerElement = ref<HTMLElement>()
const ledgerScrollRestore = createScrollRestore({
  measure: () => {
    const element = ledgerElement.value
    if (!element) return undefined
    return { scrollTop: element.scrollTop, maxScrollTop: element.scrollHeight - element.clientHeight }
  },
  scrollTo: (top) => {
    if (ledgerElement.value) ledgerElement.value.scrollTop = top
  },
  nextTick,
  frame: () => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve())
  }),
})

const selectedRowId = ref('')
const actualDuration = ref(true)
const compositionViewport = ref<HTMLElement>()
const {
  zoom: compositionZoom,
  dragging: compositionDragging,
  setZoom: setCompositionZoom,
  handleWheel: handleCompositionWheel,
  handlePointerDown: handleCompositionPointerDown,
  handlePointerMove: handleCompositionPointerMove,
  finishDrag: finishCompositionDrag,
  consumeSuppressedClick: consumeSuppressedCompositionClick,
} = createCompositionZoomPan({
  viewport: () => compositionViewport.value,
  // 轨道宽度是倍率的函数，必须等它按新倍率重排完再写滚动量。
  afterZoom: (apply) => { void nextTick(apply) },
})
const requestsCollapsed = ref(false)
const trajectorySortOrder = ref<ModelRequestTrajectorySortOrder>('desc')
const collapsedRequestIds = ref<ReadonlySet<string>>(new Set())
const hiddenKinds = ref<ReadonlySet<StudioEvidenceKind>>(new Set())
const filtersExpanded = ref(false)
// 常用证据种类和「耗时」「请求」一起留在工具栏外层；VARIABLE 紧邻 TOOL DEFS 左侧。
const PINNED_FILTER_KINDS: readonly StudioEvidenceKind[] = ['system', 'user', 'variable', 'tool-definition']
const pinnedKindOptions = MODEL_EVIDENCE_FILTER_KINDS.filter(({ kind }) => PINNED_FILTER_KINDS.includes(kind))
const collapsedKindOptions = MODEL_EVIDENCE_FILTER_KINDS.filter(({ kind }) => !PINNED_FILTER_KINDS.includes(kind))
const moreFiltersId = useId()
const searchQuery = ref('')
// 详情内定位的三个来源从证据导航 module 的同一个发号源取号；轨迹视图不再持有本地计数器。
const internalAnalysisLocateRequest = ref<LocateRequest>()
const inspectorLocateSignal = ref<LocateRequest>()
const analysisLocateRequest = computed(() => props.externalLocate ?? internalAnalysisLocateRequest.value)
const inspectorLocateRequest = computed(() => inspectorLocateSignal.value)
// 请求身份表。账本每一行、每一条时间分段都要问「这是第几次请求、叫什么」；
// 逐行 find/findIndex 会让轨迹随会话请求数变成平方级，而这张表每份轨迹只建一次。
const requestOrderById = computed(() => new Map(
  (props.trajectory?.records ?? []).map((record, index) => [record.id, index]),
))
const requestLabelById = computed(() => new Map(
  (props.trajectory?.records ?? []).map(record => [record.id, formatModelRequestLabel(record)]),
))
const rowById = computed(() => new Map((props.trajectory?.rows ?? []).map(row => [row.id, row])))
const selectedRow = computed(() => rowById.value.get(selectedRowId.value))
const selectedRequest = computed(() => props.trajectory?.records.find(({ id }) => id === selectedRow.value?.requestId))
const inspectorDetail = computed(() => {
  const requestId = selectedRow.value?.requestId
  if (!requestId || props.detail?.id !== requestId) return undefined
  return props.detail
})
const promptComposition = computed(() => {
  const items = props.trajectory?.promptComposition ?? []
  const total = items.reduce((sum, item) => sum + item.characters, 0)
  if (!total) return []
  return items.map((item) => ({
    ...item,
    percentage: (item.characters / total) * 100,
  }))
})
const REQUEST_COMPOSITION_KINDS = ['system', 'user', 'assistant', 'tool-definition', 'tool-interaction'] as const
const CONVERSATION_COMPOSITION_KINDS = ['system', 'user', 'tool-definition'] as const

interface CompositionSegment {
  id: string
  evidenceId: string
  kind: StudioModelRequestPromptKind
  characters: number
  percentage: number
  left: number
  width: number
  variableId?: string
  variableName?: string
  requestId?: string
}

function isConversationCompositionKind(kind: StudioModelRequestPromptKind): kind is typeof CONVERSATION_COMPOSITION_KINDS[number] {
  return (CONVERSATION_COMPOSITION_KINDS as readonly StudioModelRequestPromptKind[]).includes(kind)
}

const compositionTracks = computed(() => (
  props.mode === 'conversation' ? conversationCompositionTracks.value : requestCompositionTracks.value
))
const requestCompositionTracks = computed(() => {
  let offset = 0
  const segments = promptComposition.value.map((item, index): CompositionSegment => {
    const left = offset
    offset += item.percentage
    const gap = index < promptComposition.value.length - 1 ? 0.35 : 0
    return {
      id: item.evidenceId,
      evidenceId: item.evidenceId,
      kind: item.kind,
      characters: item.characters,
      percentage: item.percentage,
      ...(item.variableId ? { variableId: item.variableId } : {}),
      ...(item.variableName ? { variableName: item.variableName } : {}),
      left,
      width: Math.min(Math.max(item.percentage - gap, 0.35), Math.max(100 - left, 0.35)),
    }
  })
  return groupCompositionTracks(REQUEST_COMPOSITION_KINDS, segments)
})

const conversationCompositionTracks = computed(() => {
  const itemsByRequest = new Map<string, typeof promptComposition.value>()
  for (const item of promptComposition.value) {
    if (!item.requestId || !isConversationCompositionKind(item.kind)) continue
    const items = itemsByRequest.get(item.requestId) ?? []
    items.push(item)
    itemsByRequest.set(item.requestId, items)
  }
  const segments: CompositionSegment[] = []
  for (const slot of timingSegments.value) {
    const items = itemsByRequest.get(slot.id) ?? []
    const total = items.reduce((sum, item) => sum + item.characters, 0)
    if (!total) continue
    let used = 0
    items.forEach((item, index) => {
      const percentage = (item.characters / total) * 100
      const left = slot.left + (used / 100) * slot.width
      const rawWidth = (percentage / 100) * slot.width
      const gap = index < items.length - 1 ? Math.min(0.25, rawWidth / 4) : 0
      used += percentage
      segments.push({
        id: `${slot.id}:${item.evidenceId}`,
        evidenceId: item.evidenceId,
        kind: item.kind,
        characters: item.characters,
        percentage,
        ...(item.variableId ? { variableId: item.variableId } : {}),
        ...(item.variableName ? { variableName: item.variableName } : {}),
        left,
        width: Math.min(Math.max(rawWidth - gap, 0.35), Math.max(slot.left + slot.width - left, 0.35)),
        requestId: slot.id,
      })
    })
  }
  return groupCompositionTracks(CONVERSATION_COMPOSITION_KINDS, segments)
})

function groupCompositionTracks(
  kinds: readonly StudioModelRequestPromptKind[],
  segments: readonly CompositionSegment[],
) {
  return kinds.flatMap((kind) => {
    const kindSegments = segments.filter(segment => segment.kind === kind)
    return kindSegments.length ? [{ kind, segments: kindSegments }] : []
  })
}
const evidenceFilter = computed(() => ({
  hiddenKinds: hiddenKinds.value,
}))
const ledgerRows = computed(() => filterModelRequestTrajectoryRows({
  rows: props.trajectory?.rows ?? [],
  requestsCollapsed: requestsCollapsed.value,
  hiddenKinds: hiddenKinds.value,
}))
const orderedLedgerRows = computed(() => orderModelRequestTrajectoryRows(ledgerRows.value, trajectorySortOrder.value))
// 可搜索文本只随轨迹变化，静音只随查询变化；两段分开才不会让每次按键重扫整份账本。
const rowSearchTexts = computed(() => buildModelRequestTrajectorySearchTexts(
  props.trajectory?.rows ?? [],
  row => [row.preview, kindLabel(row.kind), row.toolName, row.callId, requestLabel(row.requestId)],
))
const searchMutedRowIds = computed(() => buildModelRequestTrajectorySearchMutes(
  props.trajectory?.rows ?? [],
  searchQuery.value,
  rowSearchTexts.value,
))
watch(() => props.trajectory, (trajectory) => {
  // 轨迹行 id 由 evidenceId 派生，刷新后同一条证据仍是同一个 id，因此仍然存在的选中行要保留；
  // 只有证据真的消失才清空。否则 pending 请求自动刷新每轮都会把用户正在看的行和检查器一起丢掉。
  if (!trajectory?.rows.some(({ id }) => id === selectedRowId.value)) selectedRowId.value = ''
  restoreTrajectoryPosition()
})

watch(selectedRowId, () => {
  const row = selectedRow.value
  // 请求边界行没有模型证据；用空身份让分析视图回落到第一条卡片。
  inspectorLocateSignal.value = row ? props.navigation.locateEvidence(row.evidenceId ?? '') : undefined
})

watch(() => selectedRow.value?.requestId, (requestId) => {
  // 会话轨迹可能点到另一条请求；检查器要完整详情才能渲染分析卡片。
  if (!requestId || props.detail?.id === requestId) return
  emit('inspect-request', { recordId: requestId })
})

watch(() => props.restoreState?.seq, restoreTrajectoryPosition, { immediate: true })

watch(stickyHeaderElement, (header) => {
  stickyHeaderResizeObserver?.disconnect()
  stickyHeaderResizeObserver = undefined
  if (!header) {
    trajectoryElement.value?.style.removeProperty('--chatluna-studio-model-trajectory-sticky-height')
    return
  }
  const updateStickyHeight = () => {
    trajectoryElement.value?.style.setProperty('--chatluna-studio-model-trajectory-sticky-height', `${header.offsetHeight}px`)
  }
  updateStickyHeight()
  if (typeof ResizeObserver === 'undefined') return
  stickyHeaderResizeObserver = new ResizeObserver(updateStickyHeight)
  stickyHeaderResizeObserver.observe(header)
}, { flush: 'post' })

onBeforeUnmount(() => stickyHeaderResizeObserver?.disconnect())

function restoreTrajectoryPosition() {
  const state = props.restoreState
  if (!state) return
  selectedRowId.value = state.trajectory.rowId
  // 轨迹组件在打开原始字段时会被卸载；恢复必须同时还原账本滚动量和选中行。
  // 帧时序与「内容长高后继续逼近」由 scroll-restore 负责；这里只给目标偏移量。
  void ledgerScrollRestore.restore(state.trajectory.scrollTop)
}

const requestRows = computed(() => props.trajectory?.rows.filter((row) => row.kind === 'request') ?? [])
const timingBounds = computed(() => {
  const starts = requestRows.value.flatMap(({ startedAt }) => startedAt ? [Date.parse(startedAt)] : [])
  if (!starts.length) return { start: 0, end: 1 }
  const start = Math.min(...starts)
  const end = Math.max(...requestRows.value.map((row) => {
    const rowStart = row.startedAt ? Date.parse(row.startedAt) : start
    return rowStart + Math.max(row.durationMs ?? 0, 1)
  }))
  return { start, end: Math.max(end, start + 1) }
})
const totalDuration = computed(() => timingBounds.value.end - timingBounds.value.start)
const timingSegments = computed(() => requestRows.value.map((row, rowIndex) => {
  const start = row.startedAt ? Date.parse(row.startedAt) : timingBounds.value.start
  const durationMs = Math.max(row.durationMs ?? 0, row.status === 'pending' ? 0 : 1)
  const left = ((start - timingBounds.value.start) / totalDuration.value) * 100
  const width = durationMs > 0
    ? actualDuration.value
      ? Math.max((durationMs / totalDuration.value) * 100, 0.75)
      : Math.max(100 / Math.max(requestRows.value.length, 1), 2)
    : 0
  const normalizedLeft = actualDuration.value
    ? Math.min(left, 99.25)
    : (rowIndex / Math.max(requestRows.value.length, 1)) * 100
  return {
    id: row.requestId ?? row.id,
    label: `${requestOrdinal(row.requestId)} · ${requestLabel(row.requestId)}`,
    durationMs: row.durationMs ?? 0,
    startedAt: row.startedAt,
    status: row.status,
    left: normalizedLeft,
    width: Math.min(width, 100 - normalizedLeft),
  }
}))
const requestBoundaries = computed(() => timingSegments.value.slice(1).map(({ id, left }) => ({ id, left })))
const compositionBoundaries = computed(() => props.mode === 'conversation' ? requestBoundaries.value : [])
const hasUnknownTiming = computed(() => requestRows.value.some(({ status, durationMs }) => status === 'pending' || durationMs === undefined))

function isRowSearchMuted(row: StudioModelRequestTrajectoryRow) {
  return Boolean(searchMutedRowIds.value?.has(row.id))
}

function isRequestRowCollapsed(row: StudioModelRequestTrajectoryRow) {
  return isModelRequestTrajectoryRowCollapsed(row, collapsedRequestIds.value)
}

function toggleRequestCollapsed(row: StudioModelRequestTrajectoryRow) {
  collapsedRequestIds.value = toggleModelRequestTrajectoryCollapse(collapsedRequestIds.value, row.requestId)
}

function handleCompositionClickCapture(event: MouseEvent) {
  if (!consumeSuppressedCompositionClick()) return
  event.preventDefault()
  event.stopPropagation()
}

function selectPromptSegment(segment: CompositionSegment) {
  if (props.analysis) {
    internalAnalysisLocateRequest.value = props.navigation.locateEvidence(segment.evidenceId)
    return
  }
  // 组成分段与账本行共享模型证据身份；同一条证据在两个入口一定选中同一行。
  const row = (props.trajectory?.rows ?? []).find(candidate => (
    candidate.evidenceId === segment.evidenceId
    && (!segment.requestId || candidate.requestId === segment.requestId)
  ))
  if (row) selectedRowId.value = row.id
}

function isCompositionSegmentSelected(segment: CompositionSegment) {
  if (props.analysis) return analysisLocateRequest.value?.evidenceId === segment.evidenceId
  const selected = selectedRow.value
  if (!selected) return false
  return selected.evidenceId === segment.evidenceId
    && (!segment.requestId || selected.requestId === segment.requestId)
}

function openSelectedRequest() {
  const request = selectedRequest.value
  const row = selectedRow.value
  if (!request || !row) return
  emit('open-request', {
    recordId: request.id,
    returnState: {
      rowId: row.id,
      scrollTop: ledgerElement.value?.scrollTop ?? 0,
    },
  })
}

function evidenceTitleLabel(kind: StudioModelRequestPromptKind | StudioEvidenceKind) {
  // 标题与图例语境统一取词首大写变体；工具交互是聚合，它的标签同样来自证据种类 module。
  return studioEvidenceLabels(kind).title
}

function formatPercentage(value: number) {
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}%`
}

function requestOrdinal(requestId: string | undefined) {
  return formatModelRequestOrdinal(requestId === undefined ? undefined : requestOrderById.value.get(requestId))
}

function requestLabel(requestId: string | undefined) {
  return (requestId === undefined ? undefined : requestLabelById.value.get(requestId)) ?? formatModelRequestLabel(undefined)
}

function kindLabel(kind: StudioModelRequestTrajectoryKind) {
  // 请求边界行是账本特有的行类型而不是证据种类，因此它的标签留在视图这一侧。
  return kind === 'request' ? 'REQUEST' : studioEvidenceLabels(kind).badge
}

function statusClass(status: StudioModelRequestStatus | undefined) {
  if (status === 'pending') return 'is-pending'
  if (status === 'error') return 'is-error'
  return 'is-success'
}

</script>
