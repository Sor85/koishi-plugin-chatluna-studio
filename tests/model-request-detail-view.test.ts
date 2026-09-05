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
    view.expandedTrajectoryRequestIds.value = ['request-7']

    view.showNewDetail()

    expect(view.detailView.value).toBe('evidence')
    expect(view.bodyView.value).toBe('analysis')
    expect(view.responseView.value).toBe('content')
    expect(view.headersExpanded.value).toBe(false)
    expect(view.trajectoryMode.value).toBe('request')
    // 展开清单同时是读取参数：留着上一条会话的请求标识会拿去向服务端取根本不同会话的事件行。
    expect(view.expandedTrajectoryRequestIds.value).toEqual([])
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
    view.expandedTrajectoryRequestIds.value = ['request-3', 'request-9']
    const snapshot = view.snapshot()

    view.showNewDetail()
    expect(view.trajectoryMode.value).toBe('request')

    view.restore(snapshot)
    expect(view.detailView.value).toBe('trajectory')
    expect(view.bodyView.value).toBe('response')
    expect(view.trajectoryMode.value).toBe('conversation')
    // 打开原始请求再返回时展开清单必须一起回来，否则账本落回全折叠，返回定位没有行可停。
    expect(view.expandedTrajectoryRequestIds.value).toEqual(['request-3', 'request-9'])
  })

  it('快照与恢复各自复制展开清单，恢复后改动不会回写进快照', () => {
    const view = createModelRequestDetailView()
    view.expandedTrajectoryRequestIds.value = ['request-3']
    const snapshot = view.snapshot()

    view.restore(snapshot)
    view.expandedTrajectoryRequestIds.value = [...view.expandedTrajectoryRequestIds.value, 'request-4']

    expect(snapshot.expandedTrajectoryRequestIds).toEqual(['request-3'])
  })

  it('进入会话账本时播种当前请求，已有展开清单时不动它', () => {
    const view = createModelRequestDetailView()

    view.expandTrajectoryRequestByDefault('request-1')
    expect(view.expandedTrajectoryRequestIds.value).toEqual(['request-1'])

    // 从原始请求返回时清单已由快照恢复，播种不能把它顶掉。
    view.expandedTrajectoryRequestIds.value = ['request-7', 'request-9']
    view.expandTrajectoryRequestByDefault('request-1')
    expect(view.expandedTrajectoryRequestIds.value).toEqual(['request-7', 'request-9'])
  })

  it('播种是默认值而不是恒定值：折叠掉唯一展开的请求后清单保持为空', () => {
    const view = createModelRequestDetailView()
    view.expandTrajectoryRequestByDefault('request-1')

    // 用户点箭头折叠它——播种过一次之后不会在同一次浏览里被重新加回来，否则它永远折不下来。
    view.expandedTrajectoryRequestIds.value = []

    expect(view.expandedTrajectoryRequestIds.value).toEqual([])
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
