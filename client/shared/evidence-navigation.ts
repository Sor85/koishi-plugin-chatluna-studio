import { computed, shallowRef } from 'vue'
import type { LocateRequest } from './evidence-locator'
import type { ModelTextRange } from '#client/model-request/occurrence'
import type { LocateStudioPresetExpressionResult } from '../../src/presets'
import type {
  StudioModelRequestDetail,
  StudioModelRequestTrajectory,
} from '../../src/types'

/**
 * 证据导航：跨视图打开某条模型请求记录，按需继续定位到某条证据，并在返回时把原视图恢复回去。
 *
 * 本 module 拥有「从哪来、何时到、怎么回去」；证据定位（ADR-0062）拥有「最终停在哪」，
 * 两者通过 LocateRequest 相接。四个一次性触发编号全部由这里独家发出，视图与工作台 shell 一个都不持有。
 *
 * 反应式暴露而非纯数据：导航一行 DOM、一个帧时序原语都不碰，它的全部事实是
 * 「意图是否仍然待处理、快照是否可恢复」，因此可以在没有浏览器环境的测试里被完整驱动。
 */

/** 意图可选携带的证据定位段；带范围时走精确文本定位。 */
export interface EvidenceNavigationTarget {
  evidenceId: string
  range?: ModelTextRange
}

/** 一个类型两种形态：必含记录标识，可选携带证据定位段。 */
export interface EvidenceNavigationIntent {
  seq: number
  recordId: string
  evidence?: EvidenceNavigationTarget
}

/**
 * 进入模型请求视图时该写入的视图状态。
 *
 * 两条入口路径共用同一份，因此「一条路径有列表选择保护、另一条没有」在结构上不可能出现。
 * 筛选、页签、选中记录与状态文案仍由视图持有，这里只交出该进入什么状态的数据。
 */
export interface ModelRequestEntryState {
  seq: number
  recordId: string
  /** 预设证据只可能来自有归属的请求；进入时把范围收到「已归属」，目标一定在列表里。 */
  category: 'attributed'
  model: string
  errorsOnly: boolean
  detailView: 'evidence'
  bodyView: 'analysis'
  /** 这是一次导航选中：列表选择保护随之生效，视图无法遗漏。 */
  navigationSelection: true
  /** 进行态文案；不携带证据定位段时为空。 */
  status: string
}

/** 从轨迹账本进入检查器时记录的工作台内视图快照。 */
export interface EvidenceViewSnapshot {
  recordId: string
  detailView: 'trajectory' | 'evidence'
  bodyView: 'request' | 'response' | 'analysis'
  trajectoryMode: 'request' | 'conversation'
  detailScrollTop: number
  trajectory: {
    rowId: string
    scrollTop: number
  }
}

/** 待恢复的工作台内视图快照；seq 只用来触发一次恢复，不参与快照内容。 */
export type EvidenceViewRestore = EvidenceViewSnapshot & { seq: number }

/** 从预设工作台跳转时记录的原点位置。 */
export interface PresetOriginSnapshot {
  listScrollTop: number
  searchQuery: string
  editorScroll?: unknown
}

/** 待恢复的预设工作台原点；编号由导航的返回动作自己发出。 */
export type PresetOriginRestore = PresetOriginSnapshot & { seq: number }

export type EvidenceReturnTarget = 'view' | 'presets'

const LOCATING_STATUS = '正在打开匹配的模型请求并定位精确文本…'

const emptyPresetOrigin = (): PresetOriginSnapshot => ({ listScrollTop: 0, searchQuery: '' })

export function createEvidenceNavigation() {
  const entryState = shallowRef<ModelRequestEntryState>()
  const locateRequest = shallowRef<LocateRequest>()
  const viewRestore = shallowRef<EvidenceViewRestore>()
  const presetOriginRestore = shallowRef<PresetOriginRestore>()
  const savedViewSnapshot = shallowRef<EvidenceViewSnapshot>()
  const presetOrigin = shallowRef<PresetOriginSnapshot>()
  const pendingIntent = shallowRef<EvidenceNavigationIntent>()

  // 四个语义互不重叠的一次性触发编号，各自单调；消费者不需要判断这一次轮不轮到自己。
  let entrySeq = 0
  let locateSeq = 0
  let viewRestoreSeq = 0
  let presetOriginSeq = 0

  /** 闸门交出的那一次定位编号；同时充当「已交出，不再重复」的标记。 */
  let gatedLocateSeq: number | undefined
  let pendingViewSnapshot: EvidenceViewSnapshot | undefined
  let selectionGuard = false

  /**
   * 返回按钮该指向哪，同时就是「返回是否可用」这个响应式事实。
   *
   * 工作台内快照比预设原点晚一步产生，因此它存在时就是最近一次离开的位置。
   */
  const returnTarget = computed<EvidenceReturnTarget | undefined>(() => {
    if (savedViewSnapshot.value) return 'view'
    return presetOrigin.value ? 'presets' : undefined
  })
  const pending = computed(() => pendingIntent.value)

  /** 从预设工作台进入：携带证据定位段并记录原点，可返回。只有匹配结果才发布意图。 */
  function enterFromPreset(
    result: LocateStudioPresetExpressionResult,
    snapshot?: PresetOriginSnapshot,
  ): EvidenceNavigationIntent | undefined {
    if (result.status !== 'matched') return
    presetOrigin.value = snapshot ?? emptyPresetOrigin()
    return publish({
      recordId: result.recordId,
      evidence: { evidenceId: result.evidenceId, range: { ...result.range } },
    })
  }

  function publish(intent: Omit<EvidenceNavigationIntent, 'seq'>): EvidenceNavigationIntent {
    const published = { ...intent, seq: ++entrySeq }
    pendingIntent.value = published
    gatedLocateSeq = undefined
    locateRequest.value = undefined
    // 上一次的工作台内快照属于已经卸载的视图；重新进入时不能让它冒充回程。
    savedViewSnapshot.value = undefined
    pendingViewSnapshot = undefined
    viewRestore.value = undefined
    selectionGuard = true
    entryState.value = {
      seq: published.seq,
      recordId: published.recordId,
      category: 'attributed',
      model: '',
      errorsOnly: false,
      detailView: 'evidence',
      bodyView: 'analysis',
      navigationSelection: true,
      status: published.evidence ? LOCATING_STATUS : '',
    }
    return published
  }

  /**
   * 视图已经应用完进入状态。不携带证据定位段的意图在此消费完毕。
   *
   * `filtersChanged` 是视图唯一知道而 module 不知道的事实：进入状态写入筛选后，
   * 筛选值是否真的变了。没变时筛选侦听器不会触发，令牌必须当场失效，
   * 否则它会一直留到下一次用户主动改筛选，把那一次的清空也误挡掉。
   */
  function applyEntry(seq: number, filtersChanged: boolean): void {
    if (entryState.value?.seq !== seq) return
    entryState.value = undefined
    if (!filtersChanged) selectionGuard = false
    if (pendingIntent.value?.seq === seq && !pendingIntent.value.evidence) pendingIntent.value = undefined
  }

  /**
   * 到达闸门：三个条件全部满足才交出定位请求，且只交出一次。
   *
   * 详情与轨迹都是异步到达的，缺少任何一个条件时定位会作用在上一条记录上，
   * 或者在会话模式的跨请求聚合视图里跳到错误的证据。
   */
  function arrive(
    detail: Pick<StudioModelRequestDetail, 'id'> | undefined,
    trajectory: Pick<StudioModelRequestTrajectory, 'mode' | 'records'> | undefined,
  ): LocateRequest | undefined {
    const intent = pendingIntent.value
    if (!intent?.evidence || gatedLocateSeq !== undefined) return
    if (detail?.id !== intent.recordId || trajectory?.mode !== 'request') return
    if (!trajectory.records.some(({ id }) => id === intent.recordId)) return
    const request = locateEvidence(intent.evidence.evidenceId, intent.evidence.range)
    gatedLocateSeq = request.seq
    locateRequest.value = request
    return request
  }

  /**
   * 详情内定位的唯一发号源。
   *
   * 预设跳转经到达闸门取号，轨迹账本选中行与请求组成分段点击直接取号；
   * 三个来源共用同一个计数器，两个互不知情的计数器撞号因此在结构上不可能。
   *
   * 只交号与请求值，不写入 locateRequest：那个引用专属于闸门交出的那一次定位，
   * 账本与分段的定位由发起它们的视图自己持有，两者因此不会互相吞掉。
   */
  function locateEvidence(evidenceId: string, range?: ModelTextRange): LocateRequest {
    return {
      evidenceId,
      seq: ++locateSeq,
      ...(range ? { range: { ...range } } : {}),
    }
  }

  /** 切换详情内视图或重新进入时丢弃闸门那一次定位请求，避免另一侧挂载时按旧目标定位。 */
  function resetLocate(): void {
    locateRequest.value = undefined
  }

  /** 定位回执。只有闸门交出的那一次定位会结束意图；账本与分段的定位不受影响。 */
  function acknowledgeLocate(seq: number, located: boolean) {
    const intent = pendingIntent.value
    if (!intent || gatedLocateSeq !== seq) return
    pendingIntent.value = undefined
    gatedLocateSeq = undefined
    if (locateRequest.value?.seq === seq) locateRequest.value = undefined
    return { intent, located }
  }

  /** 用户主动点选其他请求：待处理跳转与工作台内回程都让位，预设原点保留。 */
  function selectOtherRecord(): void {
    pendingIntent.value = undefined
    gatedLocateSeq = undefined
    entryState.value = undefined
    selectionGuard = false
    savedViewSnapshot.value = undefined
    pendingViewSnapshot = undefined
  }

  /** 「本次筛选变化不清空导航选中」一次性令牌：与进入状态绑定，消费即失效。 */
  function preserveSelectionOnFilterChange(): boolean {
    if (!selectionGuard) return false
    selectionGuard = false
    return true
  }

  /** 从轨迹账本进入检查器：记录离开时的视图与滚动快照。 */
  function pushViewSnapshot(snapshot: EvidenceViewSnapshot): void {
    savedViewSnapshot.value = snapshot
  }

  /** 开始工作台内返回：交出快照并转为待消费，调用方据此发起详情与轨迹读取。 */
  function beginViewReturn(): EvidenceViewSnapshot | undefined {
    const snapshot = savedViewSnapshot.value
    if (!snapshot) return
    savedViewSnapshot.value = undefined
    pendingViewSnapshot = snapshot
    return snapshot
  }

  /**
   * 目标详情到达后消费待恢复快照，并发出恢复编号。
   *
   * 必须按记录身份匹配：跨请求返回时详情是异步到达的，中途的详情变更会先把页签重置掉，
   * 只有目标记录真正到达时恢复才有意义，否则会把快照消费在错误的记录上。
   */
  function takeViewRestore(recordId: string | undefined): EvidenceViewRestore | undefined {
    if (!pendingViewSnapshot || !recordId || pendingViewSnapshot.recordId !== recordId) return
    const snapshot = pendingViewSnapshot
    pendingViewSnapshot = undefined
    viewRestore.value = { ...snapshot, seq: ++viewRestoreSeq }
    return viewRestore.value
  }

  /** 返回预设工作台原点：恢复编号由本动作自己发出，不由工作台 shell 补号。 */
  function returnToPresetOrigin(): PresetOriginRestore | undefined {
    const snapshot = presetOrigin.value
    if (!snapshot) return
    presetOrigin.value = undefined
    pendingIntent.value = undefined
    gatedLocateSeq = undefined
    entryState.value = undefined
    presetOriginRestore.value = { ...snapshot, seq: ++presetOriginSeq }
    return presetOriginRestore.value
  }

  /** 离开模型请求视图：不残留任何跳转意图、回程与原点。 */
  function clear(): void {
    pendingIntent.value = undefined
    gatedLocateSeq = undefined
    pendingViewSnapshot = undefined
    selectionGuard = false
    entryState.value = undefined
    locateRequest.value = undefined
    viewRestore.value = undefined
    savedViewSnapshot.value = undefined
    presetOrigin.value = undefined
    presetOriginRestore.value = undefined
  }

  return {
    entryState,
    locateRequest,
    viewRestore,
    presetOriginRestore,
    pending,
    returnTarget,
    enterFromPreset,
    applyEntry,
    arrive,
    locateEvidence,
    resetLocate,
    acknowledgeLocate,
    selectOtherRecord,
    preserveSelectionOnFilterChange,
    pushViewSnapshot,
    beginViewReturn,
    takeViewRestore,
    returnToPresetOrigin,
    clear,
  }
}

export type EvidenceNavigation = ReturnType<typeof createEvidenceNavigation>
