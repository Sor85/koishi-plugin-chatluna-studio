import { computed, ref } from 'vue'

/**
 * 详情区的页签与轨迹模式。
 *
 * 四个开关原先各自散在组件里，五处转换手写重复的赋值序列：换详情、导航到达、
 * 打开关联请求、返回视图快照、切页签。漏掉其中一个赋值不会有任何报错，只会表现为
 * 「返回后落回分析页」或「新详情还带着上一条的响应原文页签」这类偶发错位。
 *
 * 这里把转换命名成五个动作，并且让轨迹模式从页签单向派生——模式一旦另存一份，
 * 就会出现页签停在轨迹、拉回来的却是单请求账本。
 */
export type ModelRequestDetailTab = 'trajectory' | 'evidence'
export type ModelRequestBodyTab = 'request' | 'response' | 'analysis'
export type ModelRequestResponseTab = 'content' | 'json'
export type ModelRequestTrajectoryMode = 'request' | 'conversation'

export interface ModelRequestDetailViewSnapshot {
  detailView: ModelRequestDetailTab
  bodyView: ModelRequestBodyTab
}

export function createModelRequestDetailView() {
  const detailView = ref<ModelRequestDetailTab>('evidence')
  const bodyView = ref<ModelRequestBodyTab>('analysis')
  const responseView = ref<ModelRequestResponseTab>('content')
  const headersExpanded = ref(false)
  const trajectoryMode = computed<ModelRequestTrajectoryMode>(() => (
    detailView.value === 'trajectory' ? 'conversation' : 'request'
  ))

  /** 换到另一条记录：四个开关全部回到默认，包括请求头折叠与响应原文页签。 */
  function showNewDetail() {
    detailView.value = 'evidence'
    bodyView.value = 'analysis'
    responseView.value = 'content'
    headersExpanded.value = false
  }

  /** 导航到达目标证据：只把页签摆到分析卡片，不动响应页签与请求头折叠。 */
  function showEvidenceAnalysis() {
    detailView.value = 'evidence'
    bodyView.value = 'analysis'
  }

  /** 从轨迹打开关联请求的原始请求体：落到请求页签，其余回到默认。 */
  function showRequestBody() {
    detailView.value = 'evidence'
    bodyView.value = 'request'
    responseView.value = 'content'
    headersExpanded.value = false
  }

  function snapshot(): ModelRequestDetailViewSnapshot {
    return { detailView: detailView.value, bodyView: bodyView.value }
  }

  function restore(state: ModelRequestDetailViewSnapshot) {
    detailView.value = state.detailView
    bodyView.value = state.bodyView
  }

  function toggleHeaders() {
    headersExpanded.value = !headersExpanded.value
  }

  return {
    detailView,
    bodyView,
    responseView,
    headersExpanded,
    trajectoryMode,
    showNewDetail,
    showEvidenceAnalysis,
    showRequestBody,
    snapshot,
    restore,
    toggleHeaders,
  }
}

/** 折叠态要报出还有多少项，否则用户无法判断值不值得展开。 */
export function modelRequestHeadersToggleLabel(expanded: boolean, count: number): string {
  return expanded ? '收起 JSON' : `展开 JSON（${count} 项）`
}
