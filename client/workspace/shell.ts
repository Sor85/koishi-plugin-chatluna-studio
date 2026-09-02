import { computed, ref } from 'vue'
import { createEvidenceNavigation, type PresetOriginSnapshot } from '#client/shared/evidence-navigation'
import { createPresetDirtyGuard, type PresetDirtyGuardState } from '#client/preset/dirty-guard'
import type {
  ModelRequestRecordQuery,
  ModelRequestRecordsQuery,
  ModelRequestTrajectoryQuery,
} from '#client/model-request/query'
import type {
  CreatePresetInput,
  DeletePresetInput,
  LocateStudioPresetExpressionInput,
  LocateStudioPresetExpressionResult,
  ReadStudioPresetInput,
  RenamePresetInput,
  SavePresetInput,
} from '../../src/presets'
import { createWorkspaceController, type StudioWorkspacePorts } from './controller'
import { createErrorSlot } from './error-slot'
import { createRegionReadGate } from './region-read-gate'
import {
  loadWorkspacePreferences,
  saveWorkspacePreferences,
  type StudioWorkspaceView,
} from './state'

/**
 * 工作室页面 shell：把控制器、两个区域的错误闸门与证据导航接到一起。
 *
 * 页面组件只做布局与事件绑定，因此这里持有「切视图时该发生什么」这类跨区域规则：预设有未保存
 * 修改时离开要先问一句、进入模型请求视图要重新读一次列表、离开时要清掉跳转意图。这些规则一条
 * 都不需要浏览器，因此可以在没有 DOM 的测试里被完整驱动。
 */

interface ShellStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface StudioWorkspaceShellOptions {
  ports: StudioWorkspacePorts
  storage?: ShellStorage
}

const memoryStorage = (): ShellStorage => {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
}

export function createStudioWorkspaceShell(options: StudioWorkspaceShellOptions) {
  const controller = createWorkspaceController(options.ports)
  const storage = options.storage ?? (typeof localStorage === 'undefined' ? memoryStorage() : localStorage)
  const currentView = ref<StudioWorkspaceView>(loadWorkspacePreferences(storage).currentView)
  const modelRequestErrorSlot = createErrorSlot()
  const modelRequestGate = createRegionReadGate(modelRequestErrorSlot, ['list', 'detail'])
  const presetErrorSlot = createErrorSlot()
  const presetGate = createRegionReadGate(presetErrorSlot, ['read', 'save'])
  const evidenceNavigation = createEvidenceNavigation()
  const presetDirtyGuard = createPresetDirtyGuard()
  const presetDiscardGuard = ref<PresetDirtyGuardState>(presetDirtyGuard.peek())
  /** 每次进入模型请求视图都自增，视图据此重新拉一次列表。 */
  const modelRequestVisitKey = ref(0)

  const modelRequestWorkspaceModel = computed(() => ({
    records: controller.modelRequestRecords.value,
    detail: controller.modelRequestRecord.value,
    trajectory: controller.modelRequestTrajectory.value,
    facets: controller.modelRequestFacets.value,
    hasMore: controller.modelRequestRecordsPage.value.hasMore,
    nextCursor: controller.modelRequestRecordsPage.value.nextCursor,
    loading: modelRequestGate.loading.list.value,
    detailLoading: modelRequestGate.loading.detail.value,
    error: modelRequestGate.error.value,
    useQQAvatars: controller.appearance.value.studioUseQQAvatars,
  }))
  const presetWorkspaceModel = computed(() => ({
    catalog: controller.presetCatalog.value,
    document: controller.presetDocument.value,
    loading: presetGate.loading.read.value,
    saving: presetGate.loading.save.value,
    error: presetGate.error.value,
  }))

  function selectView(view: StudioWorkspaceView, commit = true) {
    // 预设有未保存修改时先问一句；用户确认丢弃后由 confirmPresetDiscard 再走一遍同一条路径。
    if (currentView.value === 'presets' && view !== 'presets' && !presetDirtyGuard.request({ action: 'leave', targetView: view })) {
      presetDiscardGuard.value = presetDirtyGuard.peek()
      return false
    }
    if (!commit) return true
    // 离开模型请求视图时清掉跳转意图与回程：它们属于这一次进入，留着会在下次进入时误触发定位。
    if (view !== 'model-requests') evidenceNavigation.clear()
    currentView.value = view
    saveWorkspacePreferences(storage, { currentView: view })
    if (view === 'model-requests') modelRequestVisitKey.value += 1
    if (view === 'presets') void loadPresetCatalog()
    return true
  }

  async function initialize() {
    await loadWorkspace()
    if (currentView.value === 'presets') await loadPresetCatalog()
  }

  /**
   * 新记录广播：只在模型请求视图上把访问计数推一格，由视图自己按当前筛选重新读一页。
   *
   * 不在这里直接调 `loadModelRequestRecords`：查询条件（范围、机器人、会话、排序）只有视图知道，
   * shell 自己拼一份会把用户的筛选静默换掉。
   */
  const unsubscribeRecorded = options.ports.workspace.subscribeModelRequestRecorded(() => {
    if (currentView.value === 'model-requests') modelRequestVisitKey.value += 1
  })

  function dispose() {
    unsubscribeRecorded()
  }

  async function loadWorkspace() {
    await modelRequestGate.read('list', '读取工作区状态失败', () => controller.loadWorkspace())
  }

  async function loadModelRequestRecords(input: ModelRequestRecordsQuery, mode: 'replace' | 'append' = 'replace') {
    await modelRequestGate.read('list', '读取模型请求记录失败', () => controller.loadModelRequestRecords(input, mode))
    // 筛选可选值随记录一起变旧：清理过记录或新会话第一次出现时，下拉必须跟着更新。
    // 列表读失败时不再追一次读取——错误位每次调用前都会清空，接着读会把刚写下的错误抹掉。
    if (mode !== 'replace' || modelRequestGate.error.value) return
    await modelRequestGate.read('list', '读取模型请求筛选项失败', () => controller.loadModelRequestFacets())
  }

  const loadMoreModelRequestRecords = (input: ModelRequestRecordsQuery) => loadModelRequestRecords(input, 'append')

  const loadModelRequestRecord = (input: ModelRequestRecordQuery) => modelRequestGate.readOrThrow(
    'detail',
    '读取模型请求详情失败',
    () => controller.loadModelRequestRecord(input),
  )

  async function loadModelRequestTrajectory(input: ModelRequestTrajectoryQuery) {
    await modelRequestGate.read('detail', '读取模型请求轨迹失败', () => controller.loadModelRequestTrajectory(input))
  }

  async function clearModelRequestRecords() {
    await modelRequestGate.read('list', '清理模型请求记录失败', () => controller.clearModelRequestRecords())
  }

  async function loadPresetCatalog() {
    await presetGate.read('read', '读取预设目录失败', () => controller.loadPresetCatalog())
  }

  const readPreset = (input: ReadStudioPresetInput) => presetGate.readOrThrow(
    'read',
    '读取预设失败',
    () => controller.readPreset(input),
  )

  const runPresetMutation = <T>(operation: () => Promise<T>) => presetGate.readOrThrow('save', '预设操作失败', operation)
  const createPreset = (input: CreatePresetInput) => runPresetMutation(() => controller.createPreset(input))
  const savePreset = (input: SavePresetInput) => runPresetMutation(async () => {
    const result = await controller.savePreset(input)
    updatePresetDirty(false)
    return result
  })
  const renamePreset = (input: RenamePresetInput) => runPresetMutation(() => controller.renamePreset(input))
  const deletePreset = (input: DeletePresetInput) => runPresetMutation(() => controller.deletePreset(input))

  /** 定位不展示进行中：它没有自己的进度通道，因此直接用区域错误位而不是经闸门。 */
  const locatePresetExpression = (input: LocateStudioPresetExpressionInput) => presetErrorSlot.runOrThrow(
    '定位预设表达式失败',
    () => controller.locatePresetExpression(input),
  )

  function navigateToPresetEvidence(result: LocateStudioPresetExpressionResult, snapshot?: PresetOriginSnapshot) {
    if (!evidenceNavigation.enterFromPreset(result, snapshot)) return
    currentView.value = 'model-requests'
    saveWorkspacePreferences(storage, { currentView: 'model-requests' })
    modelRequestVisitKey.value += 1
  }

  function returnToPresetOrigin() {
    if (!evidenceNavigation.returnToPresetOrigin()) return
    currentView.value = 'presets'
    saveWorkspacePreferences(storage, { currentView: 'presets' })
  }

  function reportEvidenceNavigationFailure(message: string) {
    modelRequestErrorSlot.error.value = message
  }

  function updatePresetDirty(dirty: boolean) {
    presetDirtyGuard.update(dirty)
    presetDiscardGuard.value = presetDirtyGuard.peek()
  }

  function cancelPresetDiscard() {
    presetDirtyGuard.cancel()
    presetDiscardGuard.value = presetDirtyGuard.peek()
  }

  function confirmPresetDiscard() {
    const request = presetDirtyGuard.discard()
    presetDiscardGuard.value = presetDirtyGuard.peek()
    if (request?.action === 'leave' && request.targetView) selectView(request.targetView)
  }

  return {
    appearance: controller.appearance,
    persistence: controller.persistence,
    currentView,
    modelRequestVisitKey,
    modelRequestWorkspaceModel,
    presetWorkspaceModel,
    evidenceNavigation,
    presetDiscardGuard,
    selectView,
    initialize,
    dispose,
    loadModelRequestRecords,
    loadMoreModelRequestRecords,
    loadModelRequestRecord,
    loadModelRequestTrajectory,
    clearModelRequestRecords,
    loadPresetCatalog,
    readPreset,
    createPreset,
    savePreset,
    renamePreset,
    deletePreset,
    locatePresetExpression,
    navigateToPresetEvidence,
    returnToPresetOrigin,
    reportEvidenceNavigationFailure,
    updatePresetDirty,
    cancelPresetDiscard,
    confirmPresetDiscard,
  }
}

export type StudioWorkspaceShell = ReturnType<typeof createStudioWorkspaceShell>
