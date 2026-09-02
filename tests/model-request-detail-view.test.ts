import { describe, expect, it } from 'vitest'
import {
  createModelRequestDetailView,
  modelRequestHeadersToggleLabel,
} from '../client/model-request/detail-view'

describe('模型请求详情页签与轨迹模式', () => {
  it('默认停在请求页签的分析卡片，轨迹模式为单请求', () => {
    const view = createModelRequestDetailView()

    expect(view.detailView.value).toBe('evidence')
    expect(view.bodyView.value).toBe('analysis')
    expect(view.responseView.value).toBe('content')
    expect(view.headersExpanded.value).toBe(false)
    expect(view.trajectoryMode.value).toBe('request')
  })

  it('轨迹模式由详情页签单向派生，切回来立刻回到单请求', () => {
    const view = createModelRequestDetailView()

    view.detailView.value = 'trajectory'
    expect(view.trajectoryMode.value).toBe('conversation')

    view.detailView.value = 'evidence'
    expect(view.trajectoryMode.value).toBe('request')
  })

  it('换到另一条记录时四个开关全部回到默认', () => {
    const view = createModelRequestDetailView()
    view.detailView.value = 'trajectory'
    view.bodyView.value = 'response'
    view.responseView.value = 'json'
    view.headersExpanded.value = true

    view.showNewDetail()

    expect(view.detailView.value).toBe('evidence')
    expect(view.bodyView.value).toBe('analysis')
    expect(view.responseView.value).toBe('content')
    expect(view.headersExpanded.value).toBe(false)
    expect(view.trajectoryMode.value).toBe('request')
  })

  it('导航到达只摆页签，不清掉响应原文页签与请求头折叠', () => {
    const view = createModelRequestDetailView()
    view.detailView.value = 'trajectory'
    view.responseView.value = 'json'
    view.headersExpanded.value = true

    view.showEvidenceAnalysis()

    expect(view.detailView.value).toBe('evidence')
    expect(view.bodyView.value).toBe('analysis')
    expect(view.responseView.value).toBe('json')
    expect(view.headersExpanded.value).toBe(true)
  })

  it('打开关联请求的原始请求体时落到请求页签，其余回到默认', () => {
    const view = createModelRequestDetailView()
    view.detailView.value = 'trajectory'
    view.responseView.value = 'json'
    view.headersExpanded.value = true

    view.showRequestBody()

    expect(view.detailView.value).toBe('evidence')
    expect(view.bodyView.value).toBe('request')
    expect(view.responseView.value).toBe('content')
    expect(view.headersExpanded.value).toBe(false)
  })

  it('返回视图快照恢复两个页签，并让轨迹模式随之回到会话', () => {
    const view = createModelRequestDetailView()
    view.detailView.value = 'trajectory'
    view.bodyView.value = 'response'
    const snapshot = view.snapshot()

    view.showNewDetail()
    expect(view.trajectoryMode.value).toBe('request')

    view.restore(snapshot)
    expect(view.detailView.value).toBe('trajectory')
    expect(view.bodyView.value).toBe('response')
    expect(view.trajectoryMode.value).toBe('conversation')
  })

  it('请求头折叠可来回切换，折叠态报出项数', () => {
    const view = createModelRequestDetailView()

    view.toggleHeaders()
    expect(view.headersExpanded.value).toBe(true)
    view.toggleHeaders()
    expect(view.headersExpanded.value).toBe(false)

    expect(modelRequestHeadersToggleLabel(false, 7)).toBe('展开 JSON（7 项）')
    expect(modelRequestHeadersToggleLabel(true, 7)).toBe('收起 JSON')
  })
})
