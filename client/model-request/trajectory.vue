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
        <span>{{ trajectory?.eventTotal ?? 0 }} 条事件</span>
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
          <!-- 会话模式的事件行按请求向服务端取，「全部展开」等于把整段会话重新拉回来；
               默认全折叠之后这个总开关不再成立，展开与折叠一律走每条请求自己的箭头。 -->
          <Button
            v-if="!analysis && mode !== 'conversation'"
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

      <div v-if="compositionTracks.length" ref="compositionShell" class="chatluna-studio-model-trajectory-composition-shell">
          <section
            class="chatluna-studio-model-trajectory-composition"
            :style="{ minHeight: `${Math.max(50, compositionTracks.length * 14 + 8)}px` }"
            :aria-label="compositionScopeLabel"
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
              @scroll="hideCompositionTooltip"
            >
              <div
                class="chatluna-studio-model-trajectory-composition-tracks"
                :style="{ width: `${compositionZoom * 100}%` }"
              >
                <!-- 焦点层：横轴只铺展开中的那几条请求，窗口切换时整层做一次合成变换。
                     几何在切换那一拍就是新窗口的，动画只把它摆回旧窗口再放回原位，
                     否则每一帧都要按新占比重排上千条绝对定位分段。 -->
                <div ref="compositionFocusLayer" class="chatluna-studio-model-trajectory-composition-focus">
                  <span
                    v-for="boundary in compositionBoundaries"
                    :key="boundary.id"
                    class="chatluna-studio-model-trajectory-boundary"
                    :style="{ left: `${boundary.left}%` }"
                    aria-hidden="true"
                  />
                  <div v-for="track in drawnCompositionTracks" :key="track.kind" class="chatluna-studio-model-trajectory-composition-track">
                    <!-- 整条轨道共用一个浮层：每段各挂一个 Tooltip 组件时，一次会话的上千条分段
                         会让每次重新取回轨迹都重渲染上千个组件，点击展开的延迟绝大部分花在那里。 -->
                    <button
                      v-for="segment in track.segments"
                      :key="segment.id"
                      type="button"
                      class="chatluna-studio-model-trajectory-composition-bar"
                      :class="[
                        `is-${segment.kind}`,
                        { 'is-variable': segment.variableId, 'is-selected': isCompositionSegmentSelected(segment) },
                      ]"
                      :style="{ left: `${segment.left}%`, width: `${segment.width}%` }"
                      :aria-label="compositionSegmentLabel(segment)"
                      :aria-describedby="hoveredSegment?.id === segment.id ? compositionTooltipId : undefined"
                      @click="selectPromptSegment(segment)"
                      @pointerenter="enterCompositionSegment(segment, $event)"
                      @pointerleave="hideCompositionTooltip"
                      @focus="enterCompositionSegment(segment, $event)"
                      @blur="hideCompositionTooltip"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>
          <div
            v-if="hoveredSegment"
            :id="compositionTooltipId"
            ref="compositionTooltip"
            class="chatluna-studio-model-trajectory-composition-tip"
            role="tooltip"
            :style="{ left: `${compositionTooltipPosition.left}px`, top: `${compositionTooltipPosition.top}px` }"
          >
            <strong>{{ compositionSegmentTitle(hoveredSegment) }} · {{ formatPercentage(hoveredSegment.percentage) }}</strong>
            <span>{{ hoveredSegment.characters.toLocaleString('zh-CN') }} 个字符</span>
            <span v-if="hoveredSegment.segmentCount">{{ compositionSegmentScope(hoveredSegment) }}</span>
          </div>
        </div>
        <div v-else class="chatluna-studio-model-trajectory-composition-empty">
          {{ mode === 'conversation' ? '当前会话没有可投影的请求组成' : '当前请求体没有可统计的提示词内容' }}
        </div>
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
import { animate } from 'animejs'
import { Button } from '#client/components/ui/button'
import { Input } from '#client/components/ui/input'
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
  COMPOSITION_FOCUS_EASE,
  COMPOSITION_FOCUS_TRANSITION_MS,
  projectCompositionFocusBoundary,
  projectCompositionFocusSpan,
  resolveCompositionFocusFlip,
  resolveCompositionFocusRequests,
  resolveCompositionFocusWindow,
} from './composition-focus'
import {
  MODEL_REQUEST_COMPOSITION_KINDS,
  MODEL_REQUEST_COMPOSITION_MIN_SEGMENT_PIXELS,
  groupModelRequestCompositionSegments,
  isModelRequestCompositionSegmentSelected,
  layoutModelRequestCompositionSegment,
  layoutModelRequestCompositionSlots,
} from '../../src/model-request-composition'
import {
  createCompositionHoverIntent,
  resolveCompositionTooltipPosition,
} from './composition-tooltip'
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
import { vChatlunaStudioScrollbar } from '#client/shared/scrollbar'
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
  /** 会话账本展开哪几条请求。事件行由服务端按这份清单下发，因此展开是一次读取而不是纯显示。 */
  'update:expandedRequestIds': [requestIds: string[]]
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
/** 轨道视图口的像素宽。分段挤不挤得开只能按像素判，而它随窗口与侧栏一起变。 */
const compositionViewportWidth = ref(0)
let compositionViewportResizeObserver: ResizeObserver | undefined
const compositionShell = ref<HTMLElement>()
const compositionFocusLayer = ref<HTMLElement>()
let compositionFocusAnimation: ReturnType<typeof animate> | undefined
const compositionTooltip = ref<HTMLElement>()
const compositionTooltipId = useId()
const hoveredSegment = ref<CompositionSegment>()
const compositionTooltipPosition = ref({ left: 0, top: 0 })
const compositionHover = createCompositionHoverIntent()
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
/**
 * 单请求模式的折叠集合。会话模式不用它：那边的事件行由服务端按已展开清单下发，
 * 折叠态因此是「轨迹里没有这一条的行」而不是「有行但藏起来」，两种模式合用一个集合
 * 会让会话模式在取回新行之前把它们又藏一遍。
 */
const localCollapsedRequestIds = ref<ReadonlySet<string>>(new Set())
const expandedRequestIds = computed(() => new Set(props.trajectory?.expandedRequestIds ?? []))
const collapsedRequestIds = computed<ReadonlySet<string>>(() => {
  if (props.mode !== 'conversation') return localCollapsedRequestIds.value
  const expanded = expandedRequestIds.value
  return new Set((props.trajectory?.records ?? []).flatMap(({ id }) => expanded.has(id) ? [] : [id]))
})
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
/**
 * 请求组成图的轨道顺序由请求组成 module 独占，服务端聚合每个请求内部的先后也按它排；
 * 视图再留一份会让同一条会话在切换粒度时凭空多出或少掉几条轨道。
 */
const COMPOSITION_KINDS = MODEL_REQUEST_COMPOSITION_KINDS

interface CompositionSegment {
  /** 渲染键。一条消息被变量切开后会产出多段同 evidenceId 的分段，键必须自带序号才唯一。 */
  id: string
  /** 服务端聚合粒度下一段覆盖一整档证据，没有单一身份，因此可缺省。 */
  evidenceId?: string
  /** 合成块合了哪几条证据。逐段分段只有自己那一条，因此不带这一项。 */
  evidenceIds?: readonly string[]
  kind: StudioModelRequestPromptKind
  characters: number
  percentage: number
  left: number
  width: number
  /** 聚合粒度下这一段合并了多少条逐段证据。 */
  segmentCount?: number
  variableId?: string
  variableName?: string
  requestId?: string
}

const compositionTracks = computed(() => (
  props.mode === 'conversation' ? conversationCompositionTracks.value : requestCompositionTracks.value
))
/**
 * 轨道当前铺开的那一段会话轴。
 *
 * 焦点范围直接取账本的展开清单，不另立一份选中态：轨道放大到哪一段与账本展开哪几条必须是
 * 同一件事，各存一份就会出现「轨道停在上一条请求上」这类只能靠人回忆的错位。单请求模式没有
 * 第二条请求可选，它的组成本来就铺满整条轨道。
 */
const compositionFocusWindow = computed(() => (
  props.mode === 'conversation'
    ? resolveCompositionFocusWindow(timingSegments.value, expandedRequestIds.value)
    : undefined
))
/** 窗口里该画哪几条请求的分段。缺省表示铺整段会话，不筛。 */
const compositionFocusRequestIds = computed(() => resolveCompositionFocusRequests(
  timingSegments.value,
  compositionFocusWindow.value,
  expandedRequestIds.value,
))
const focusedCompositionTracks = computed(() => {
  const focus = compositionFocusWindow.value
  if (!focus) return compositionTracks.value
  const visible = compositionFocusRequestIds.value
  // 轨道清单仍按未投影的分段算：窗口里恰好没有某一档时留一条空轨道，否则左侧标签列会随
  // 展开与折叠增删，整块组成图跟着上下跳，而动画只作用于横轴。
  return compositionTracks.value.map(({ kind, segments }) => ({
    kind,
    segments: segments.flatMap((segment) => {
      // 先按请求身份筛一遍：贴着窗口端点的邻格与几何上无从分辨，判据见焦点 module。
      if (visible && segment.requestId && !visible.has(segment.requestId)) return []
      const span = projectCompositionFocusSpan(focus, segment)
      return span ? [{ ...segment, ...span }] : []
    }),
  }))
})
/**
 * 轨道最终画出来的那几块。
 *
 * 会话轨道要多走一步按像素合并：整段会话铺在一屏里时一条请求只分到几十个像素，它内部的几十条
 * 证据落不到一个像素上，各自兜住像素级最小宽度之后就互相压住，整条请求糊成一根实心条。合并只
 * 改「这一块里有几条证据」，不改占比；放大到一条请求后每段自己就够宽，同一批分段随之散开。
 * 单请求模式一条请求独占整条轴，它的分段本来就够宽，不需要这一步。
 */
const drawnCompositionTracks = computed(() => {
  const minWidth = compositionMinSegmentWidth.value
  if (props.mode !== 'conversation' || !minWidth) return focusedCompositionTracks.value
  return focusedCompositionTracks.value.map(({ kind, segments }) => ({
    kind,
    segments: mergeCompositionSegments(segments, minWidth),
  }))
})
/** 一条分段至少要占轨道的百分之多少才与邻段分得开；轨道宽度随视图口与缩放倍率变化。 */
const compositionMinSegmentWidth = computed(() => {
  const pixels = compositionViewportWidth.value * compositionZoom.value
  return pixels > 0 ? (MODEL_REQUEST_COMPOSITION_MIN_SEGMENT_PIXELS / pixels) * 100 : 0
})

function mergeCompositionSegments(segments: readonly CompositionSegment[], minWidth: number) {
  const groups = groupModelRequestCompositionSegments(segments, minWidth)
  if (groups.length === segments.length) return segments
  return groups.map(({ from, to, left, width }): CompositionSegment => {
    const first = segments[from]!
    if (to - from === 1) return { ...first, left, width }
    const merged = segments.slice(from, to)
    // 合成块记得自己合了哪几条证据：这一步是按当前像素做的几何合并，不是身份聚合，合了哪几条
    // 始终是已知的。少了这份清单，选中判定只能退回服务端聚合段的「请求 + 轨道」，于是点中一条
    // 证据会把同一轨道上所有合成块一起描边——它们各自只覆盖这一档里的几条，不是整档。
    const evidenceIds = merged.flatMap(segment => segment.evidenceId ? [segment.evidenceId] : [])
    // 变量身份要留住：合并不跨变量档的边界，整块因此同在变量档或同在非变量档，丢掉它会让
    // User 轨道上那一档颜色凭空消失。具体是哪个变量只有整块同名时才成立——相邻的不同变量会
    // 并成一块，那一块属于变量档但没有单一变量身份。
    const named = merged.every(segment => segment.variableId === first.variableId)
    return {
      id: `${first.id}+${to - from}`,
      ...(evidenceIds.length ? { evidenceIds } : {}),
      kind: first.kind,
      characters: merged.reduce((sum, segment) => sum + segment.characters, 0),
      percentage: merged.reduce((sum, segment) => sum + segment.percentage, 0),
      segmentCount: merged.reduce((sum, segment) => sum + (segment.segmentCount ?? 1), 0),
      left,
      width,
      ...(first.requestId ? { requestId: first.requestId } : {}),
      ...(first.variableId ? { variableId: first.variableId } : {}),
      ...(named && first.variableName ? { variableName: first.variableName } : {}),
    }
  })
}
const compositionScopeLabel = computed(() => {
  const focusedCount = props.mode === 'conversation' && compositionFocusWindow.value
    ? (props.trajectory?.records ?? []).filter(({ id }) => expandedRequestIds.value.has(id)).length
    : 0
  return focusedCount
    ? `请求体提示词内容占比 · 已放大到展开的 ${focusedCount} 次请求`
    : '请求体提示词内容占比'
})
const requestCompositionTracks = computed(() => {
  // 单请求模式的那一格就是整条轴；间隙与下限因此与会话模式共用同一份换算。
  const slot = { left: 0, width: 100 }
  let offset = 0
  const segments = promptComposition.value.map((item, index): CompositionSegment => {
    const start = offset
    offset += item.percentage
    return {
      id: `${index}:${item.evidenceId ?? item.kind}`,
      ...(item.evidenceId ? { evidenceId: item.evidenceId } : {}),
      kind: item.kind,
      characters: item.characters,
      percentage: item.percentage,
      ...(item.segmentCount ? { segmentCount: item.segmentCount } : {}),
      ...(item.variableId ? { variableId: item.variableId } : {}),
      ...(item.variableName ? { variableName: item.variableName } : {}),
      ...layoutModelRequestCompositionSegment(slot, {
        start,
        span: item.percentage,
        gapAfter: index < promptComposition.value.length - 1,
      }),
    }
  })
  return groupCompositionTracks(COMPOSITION_KINDS, segments)
})

const conversationCompositionTracks = computed(() => {
  const itemsByRequest = new Map<string, typeof promptComposition.value>()
  for (const item of promptComposition.value) {
    // 没有请求身份的组成项无法落到时间轴的任何一格，只有它需要在这里排除；
    // 种类不必再筛一遍，组成投影的种类集合与轨道清单同源。
    if (!item.requestId) continue
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
      const span = layoutModelRequestCompositionSegment(slot, {
        start: used,
        span: percentage,
        gapAfter: index < items.length - 1,
      })
      used += percentage
      segments.push({
        id: `${slot.id}:${index}:${item.evidenceId ?? item.kind}`,
        ...(item.evidenceId ? { evidenceId: item.evidenceId } : {}),
        kind: item.kind,
        characters: item.characters,
        percentage,
        ...(item.segmentCount ? { segmentCount: item.segmentCount } : {}),
        ...(item.variableId ? { variableId: item.variableId } : {}),
        ...(item.variableName ? { variableName: item.variableName } : {}),
        ...span,
        requestId: slot.id,
      })
    })
  }
  return groupCompositionTracks(COMPOSITION_KINDS, segments)
})

/** 一趟分桶而不是每档筛一遍：聚合前的会话分段可以有上万条，逐档 filter 等于把它们扫五遍。 */
function groupCompositionTracks(
  kinds: readonly StudioModelRequestPromptKind[],
  segments: readonly CompositionSegment[],
) {
  const byKind = new Map<StudioModelRequestPromptKind, CompositionSegment[]>()
  for (const segment of segments) {
    const bucket = byKind.get(segment.kind)
    if (bucket) bucket.push(segment)
    else byKind.set(segment.kind, [segment])
  }
  return kinds.flatMap((kind) => {
    const kindSegments = byKind.get(kind)
    return kindSegments?.length ? [{ kind, segments: kindSegments }] : []
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

watch(compositionViewport, (viewport) => {
  compositionViewportResizeObserver?.disconnect()
  compositionViewportResizeObserver = undefined
  compositionViewportWidth.value = viewport?.clientWidth ?? 0
  if (!viewport || typeof ResizeObserver === 'undefined') return
  compositionViewportResizeObserver = new ResizeObserver(() => {
    compositionViewportWidth.value = viewport.clientWidth
  })
  compositionViewportResizeObserver.observe(viewport)
}, { flush: 'post' })

onBeforeUnmount(() => {
  stickyHeaderResizeObserver?.disconnect()
  compositionViewportResizeObserver?.disconnect()
  compositionHover.dispose()
  compositionFocusAnimation?.complete()
  compositionFocusAnimation = undefined
})

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
const timingSegments = computed(() => {
  const rows = requestRows.value
  const evenSpan = 100 / Math.max(rows.length, 1)
  // 自然位置与实际铺位分成两步：位置由布局方式决定，互不重叠由请求组成 module 的扫描保证。
  // 视图自己夹一遍（原先的 `Math.min(left, 99.25)`）只能挡住越出右边界，挡不住彼此重叠。
  const boxes = layoutModelRequestCompositionSlots(rows.map((row, rowIndex) => {
    const start = row.startedAt ? Date.parse(row.startedAt) : timingBounds.value.start
    const durationMs = Math.max(row.durationMs ?? 0, row.status === 'pending' ? 0 : 1)
    if (!actualDuration.value) {
      return { start: rowIndex * evenSpan, span: durationMs > 0 ? evenSpan : 0 }
    }
    return {
      start: ((start - timingBounds.value.start) / totalDuration.value) * 100,
      span: durationMs > 0 ? (durationMs / totalDuration.value) * 100 : 0,
    }
  }))
  return rows.map((row, rowIndex) => ({
    id: row.requestId ?? row.id,
    label: `${requestOrdinal(row.requestId)} · ${requestLabel(row.requestId)}`,
    durationMs: row.durationMs ?? 0,
    startedAt: row.startedAt,
    status: row.status,
    ...boxes[rowIndex]!,
  }))
})
const requestBoundaries = computed(() => timingSegments.value.slice(1).map(({ id, left }) => ({ id, left })))
const compositionBoundaries = computed(() => {
  if (props.mode !== 'conversation') return []
  const focus = compositionFocusWindow.value
  return requestBoundaries.value.flatMap(({ id, left }) => {
    const position = projectCompositionFocusBoundary(focus, left)
    return position === undefined ? [] : [{ id, left: position }]
  })
})
const hasUnknownTiming = computed(() => requestRows.value.some(({ status, durationMs }) => status === 'pending' || durationMs === undefined))

/**
 * 焦点窗口切换时把轨道从旧窗口缩放到新窗口。
 *
 * 变换写在焦点层这一个元素上，因此上千条分段不参与逐帧重排。`flush: 'post'` 是必须的：
 * 新几何要先落进 DOM，起始帧才能把它摆回旧窗口的位置；当拍写入会被随后的更新覆盖。
 *
 * 这段注册必须排在时间分段之后。`watch` 会在建立时先求一次源值以便记住旧值，而窗口从时间分段
 * 求得——放到时间分段声明之前，整个轨迹视图会在 setup 阶段抛出「Cannot access before
 * initialization」并整块渲染不出来。
 */
watch(compositionFocusWindow, (next, previous) => {
  const flip = resolveCompositionFocusFlip(previous, next)
  // 自动刷新会把同一个窗口重新求一遍值；没有位移就不动正在跑的那一段动画。
  if (!flip) return
  // 上一段必须先推到终态：两个 transform 同时驱动同一元素时，后写入的会被前一段每帧覆盖。
  compositionFocusAnimation?.complete()
  compositionFocusAnimation = undefined
  const layer = compositionFocusLayer.value
  if (!layer || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  // 先写起始帧，避免动画首个 tick 之前闪现终态。
  layer.style.transform = `translateX(${flip.translateX}%) scaleX(${flip.scaleX})`
  compositionFocusAnimation = animate(layer, {
    translateX: [`${flip.translateX}%`, '0%'],
    scaleX: [flip.scaleX, 1],
    duration: COMPOSITION_FOCUS_TRANSITION_MS,
    ease: COMPOSITION_FOCUS_EASE,
    onComplete: () => {
      // 终态就是原位，因此收尾只需要清掉内联变换，让静止态回到样式表。
      layer.style.transform = ''
      compositionFocusAnimation = undefined
    },
  })
}, { flush: 'post' })

function isRowSearchMuted(row: StudioModelRequestTrajectoryRow) {
  return Boolean(searchMutedRowIds.value?.has(row.id))
}

function isRequestRowCollapsed(row: StudioModelRequestTrajectoryRow) {
  return isModelRequestTrajectoryRowCollapsed(row, collapsedRequestIds.value)
}

function toggleRequestCollapsed(row: StudioModelRequestTrajectoryRow) {
  if (props.mode !== 'conversation') {
    localCollapsedRequestIds.value = toggleModelRequestTrajectoryCollapse(localCollapsedRequestIds.value, row.requestId)
    return
  }
  if (!row.requestId) return
  emit('update:expandedRequestIds', [...toggleFilterMember(expandedRequestIds.value, row.requestId)])
}

function expandRequest(requestId: string) {
  if (props.mode !== 'conversation' || expandedRequestIds.value.has(requestId)) return
  emit('update:expandedRequestIds', [...expandedRequestIds.value, requestId])
}

function handleCompositionClickCapture(event: MouseEvent) {
  if (!consumeSuppressedCompositionClick()) return
  event.preventDefault()
  event.stopPropagation()
}

/** 最近一次量到的浮层尺寸。首帧还没渲染出来时用它先落位，避免浮层在上一个分段的位置闪一下。 */
let compositionTooltipSize = { width: 168, height: 46 }

function enterCompositionSegment(segment: CompositionSegment, event: Event) {
  const bar = event.currentTarget
  if (!(bar instanceof HTMLElement)) return
  compositionHover.enter(() => {
    hoveredSegment.value = segment
    placeCompositionTooltip(bar)
    void nextTick(() => placeCompositionTooltip(bar))
  })
}

function hideCompositionTooltip() {
  compositionHover.leave(() => {
    hoveredSegment.value = undefined
  })
}

function placeCompositionTooltip(bar: HTMLElement) {
  const shell = compositionShell.value
  if (!shell) return
  const tip = compositionTooltip.value
  if (tip) compositionTooltipSize = { width: tip.offsetWidth, height: tip.offsetHeight }
  compositionTooltipPosition.value = resolveCompositionTooltipPosition({
    bar: bar.getBoundingClientRect(),
    shell: shell.getBoundingClientRect(),
    // 表头声明了 overflow: clip，浮层顶到它的上边缘就会被切掉。
    clip: (stickyHeaderElement.value ?? shell).getBoundingClientRect(),
    tooltip: compositionTooltipSize,
  })
}

function selectPromptSegment(segment: CompositionSegment) {
  const evidenceId = compositionSegmentLanding(segment)
  if (evidenceId) {
    if (props.analysis) {
      internalAnalysisLocateRequest.value = props.navigation.locateEvidence(evidenceId)
      return
    }
    // 组成分段与账本行共享模型证据身份；同一条证据在两个入口一定选中同一行。
    const row = (props.trajectory?.rows ?? []).find(candidate => (
      candidate.evidenceId === evidenceId
      && (!segment.requestId || candidate.requestId === segment.requestId)
    ))
    if (row) {
      selectedRowId.value = row.id
      return
    }
  }
  // 剩下两种块的落点都是那条请求本身：服务端聚合段没有证据身份，而会话模式只给展开的请求下发
  // 事件行，折叠中的请求即使分段自带身份也还没有行可选。展开它并选中请求边界行，逐条证据随
  // 展开后的账本一起出现。
  if (!segment.requestId) return
  expandRequest(segment.requestId)
  const boundary = (props.trajectory?.rows ?? []).find(row => row.kind === 'request' && row.requestId === segment.requestId)
  if (boundary) selectedRowId.value = boundary.id
}

/**
 * 点这一块会落到哪一条证据上。
 *
 * 合成块取它合进去的第一条：整块画在一起是因为在当前像素下挤不开，不是因为身份不明，
 * 因此落点仍然精确到单条证据，而不是退回整条请求。服务端聚合段没有证据身份，因此没有落点。
 */
function compositionSegmentLanding(segment: CompositionSegment) {
  return segment.evidenceId ?? segment.evidenceIds?.[0]
}

/**
 * 点这一块会不会落到一条具体的证据上。
 *
 * 与落点解析同源，但只问「有没有证据身份、那条请求的事件行下发了吗」这两件事：无障碍名要给每一
 * 块各求一次，逐块回账本里找行会让一屏上千块各扫一遍上万行的账本。
 */
function compositionSegmentLandsOnEvidence(segment: CompositionSegment) {
  if (!compositionSegmentLanding(segment)) return false
  return props.mode !== 'conversation' || !segment.requestId || expandedRequestIds.value.has(segment.requestId)
}

/** 组成图当前的选中态：分析视图按定位信号，账本按选中行。判定本身由请求组成 module 独占。 */
const compositionSelection = computed(() => {
  if (props.analysis) {
    const evidenceId = analysisLocateRequest.value?.evidenceId
    return evidenceId ? { evidenceId } : undefined
  }
  return selectedRow.value
})

function isCompositionSegmentSelected(segment: CompositionSegment) {
  return isModelRequestCompositionSegmentSelected(segment, compositionSelection.value)
}

/**
 * 一条分段属于哪一档。
 *
 * 变量档按变量身份报而不是按轨道报：变量片段落在 User 轨道上，却自带一档颜色，只按轨道报会让
 * 紫红色的那一块在浮层里自称 User。合成块可能并了相邻的几个不同变量，那时它仍然是变量档，
 * 只是没有单一变量名可报。
 */
function compositionSegmentTitle(segment: CompositionSegment) {
  if (!segment.variableId) return evidenceTitleLabel(segment.kind)
  const variable = evidenceTitleLabel('variable')
  return segment.variableName ? `${variable} · ${segment.variableName}` : variable
}

function compositionSegmentLabel(segment: CompositionSegment) {
  const share = `占请求体提示内容的 ${formatPercentage(segment.percentage)}`
  const title = compositionSegmentTitle(segment)
  // 合成块与聚合段都覆盖多条证据，无障碍名要说出这一层：浮层里的那句只有指针能读到。
  const scope = segment.segmentCount ? `，${compositionSegmentScope(segment)}` : ''
  if (segment.requestId && !compositionSegmentLandsOnEvidence(segment)) {
    return `${requestOrdinal(segment.requestId)} 的 ${title} ${share}${scope}，点击展开这条请求`
  }
  return `${title} ${share}${scope}`
}

/** 聚合段与合成块的补充说明：这一块把多少条证据画成了一段。 */
function compositionSegmentScope(segment: CompositionSegment) {
  return `合并 ${segment.segmentCount} 条证据`
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
