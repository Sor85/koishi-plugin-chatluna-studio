import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatDuration } from '../client/shared/format-duration'
import {
  buildModelRequestJsonTree,
  parseModelRequestImageSource,
} from '../client/model-request/json'
import { createModelRequestEnterRefresh, createModelRequestLiveRefresh, MODEL_REQUEST_LIVE_REFRESH_INTERVAL_MS } from '../client/model-request/live-refresh'

describe('Studio 模型请求工作台', () => {
  it('页面入口与装配：侧栏切到独立视图，页面只传筛选可选值与访问计数，不传容量上限', () => {
    const pageSource = readFileSync(resolve('client/workspace/page.vue'), 'utf8')
    const workspaceSource = readFileSync(resolve('client/model-request/workspace.vue'), 'utf8')

    expect(pageSource).toContain("shell.selectView('model-requests')")
    expect(pageSource).toContain('<ModelRequestWorkspace')
    expect(pageSource).toContain(':facets="model.facets"')
    expect(pageSource).toContain(':visit-key="shell.modelRequestVisitKey.value"')
    expect(pageSource).not.toContain(':capacity=')
    expect(workspaceSource).not.toContain('capacityText')
    expect(workspaceSource).not.toContain('maxRecords')
  })

  it('列表筛选与排序：工具栏的范围、排序、会话筛选、自动刷新开关与清理确认，列表项按名称、状态、会话、时间、耗时排列', () => {
    const workspaceSource = readFileSync(resolve('client/model-request/workspace.vue'), 'utf8')
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')

    expect(workspaceSource).toContain('自动刷新')
    expect(workspaceSource).not.toContain('实时刷新')
    expect(workspaceSource).toContain('清理全部记录')
    expect(workspaceSource).toContain("value=\"unattributed\"")
    expect(workspaceSource).toContain("value=\"all\"")
    expect(workspaceSource).toContain('加载更多')
    expect(workspaceSource).toMatch(/chatluna-studio-model-request-list-pane[\s\S]*chatluna-studio-model-request-list-toolbar[\s\S]*chatluna-studio-model-request-list/)
    expect(workspaceSource).toContain('筛选模型请求')
    expect(workspaceSource).toContain('请求列表')
    expect(workspaceSource).toContain('按时间倒序')
    expect(workspaceSource).toContain('按时间正序')
    expect(workspaceSource).toContain('全部记录')
    expect(workspaceSource).toContain('已归属会话')
    // 机器人与会话两级筛选的可选值来自服务端聚合，不从当前这一页记录里推。
    expect(workspaceSource).toContain('facets.bots')
    expect(workspaceSource).toContain('selectableConversations')
    expect(workspaceSource).not.toContain('sortOpen')
    expect(workspaceSource).not.toContain('chatluna-studio-model-request-sort-popover')
    expect(styles).toMatch(/\.chatluna-studio-model-request-list-toolbar\s*\{[^}]*justify-content:\s*space-between/s)
    expect(workspaceSource).toContain("'is-selected': record.id === selectedRecordId")
    expect(workspaceSource).toContain(':aria-current="record.id === selectedRecordId')
    expect(styles).toMatch(/\.chatluna-studio-model-request-item\.is-selected,\s*\n\.chatluna-studio-model-request-item\[aria-current="true"\]\s*\{[^}]*background:\s*var\(--chatluna-studio-hover\)/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-item:hover\s*\{[^}]*background:\s*var\(--chatluna-studio-hover\)/s)
    expect(styles).not.toContain('.chatluna-studio-model-request-item.is-active')
    expect(workspaceSource).toContain('<ModelRequestAvatar')
    expect(workspaceSource).toMatch(/chatluna-studio-model-request-bot-copy[\s\S]*chatluna-studio-model-request-bot-name[\s\S]*resolveRequestBot\(record\)\.name[\s\S]*statusLabel\(record\.status\)[\s\S]*formatConversationLabel\(record\.entities\)[\s\S]*formatStudioDateTime\(record\.createdAt\)[\s\S]*formatDuration\(record\.durationMs\)/)
    expect(workspaceSource).not.toMatch(/class="chatluna-studio-model-request-item"[\s\S]*record\.error\.message/)
    // 名字与头像由会话身份模块从记录自带的实体派生，工作台自己不再拼兜底文案。
    expect(workspaceSource).toContain('resolveBotIdentity(record.entities')
    expect(workspaceSource).not.toContain("record.model || '未知模型'")
    expect(workspaceSource).toContain('来源')
    expect(workspaceSource).not.toContain('record.provider')
    expect(workspaceSource).not.toMatch(/<Badge v-if="record\.provider" variant="outline" class="chatluna-studio-model-request-provider">/)
    expect(workspaceSource).not.toMatch(/<Badge v-if="detail\.provider" variant="outline" class="chatluna-studio-model-request-provider">/)
    expect(workspaceSource).toContain('确认清理')
  })

  it('未归属请求走专属头像：虚线圆里的单色机器人配一道斜线，而不是名称首字母', () => {
    const avatarSource = readFileSync(resolve('client/model-request/request-avatar.vue'), 'utf8')
    const workspaceSource = readFileSync(resolve('client/model-request/workspace.vue'), 'utf8')
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')

    // 专属头像只在未归属时接管；有机器人可显示时仍走共享身份头像，圆形几何不复制一份。
    expect(avatarSource).toContain('v-if="unattributed"')
    expect(avatarSource).toContain('chatluna-studio-identity-avatar chatluna-studio-model-request-unattributed-avatar')
    expect(avatarSource).toContain('<StudioAvatar v-else kind="bot"')
    // 单色描边：整枚图形只用 currentColor，也不留名称首字母。
    expect(avatarSource).toContain('stroke="currentColor"')
    expect(avatarSource).toContain('fill="currentColor"')
    expect(avatarSource).not.toMatch(/fill="#/)
    expect(avatarSource).not.toContain('{{ initial')
    // 机头是描边：实底机头压同色斜线会糊成一片，只能靠底色垫白缝切开，那道缝比斜线还显眼。
    expect(avatarSource).toContain('<rect x="24" y="32" width="80" height="68" rx="22" />')
    expect(avatarSource).not.toContain('fill-rule="evenodd"')
    expect(avatarSource).not.toContain('slash-gap')
    // 斜线只比机头轮廓多出一点、两端留空隙：不加垫缝，也不贴到虚线环上。
    expect(avatarSource).toContain('<path d="M26 16L110 100" />')
    // 形状与 sandbox 插件的内置机器人头像同源，两个插件的未归属头像必须长得一样。
    expect(avatarSource).toContain('M64 32V16M55 12h18')
    expect(avatarSource).toContain('<circle cx="49" cy="62" r="8" />')
    expect(avatarSource).toContain('<circle cx="79" cy="62" r="8" />')
    expect(avatarSource).toContain('<path d="M45 82h38" />')
    // 去掉底板后原坐标会明显偏上，靠 viewBox 下移一次补正，而不是逐条路径挪坐标。
    expect(avatarSource).toContain('viewBox="0 -10 128 128"')
    // 归属名称就在同一行的标题里，头像不得再声明一次可访问名，否则读屏念两遍。
    expect(avatarSource).not.toContain('aria-label')
    // 列表项与详情头部共用同一个头像组件，未归属判定由 resolveRequestBot 一处给出。
    expect(workspaceSource).not.toContain('<StudioAvatar')
    expect(workspaceSource).toMatch(/<ModelRequestAvatar\s*\n\s*:unattributed="resolveRequestBot\(record\)\.unattributed"/)
    expect(workspaceSource).toMatch(/<ModelRequestAvatar\s*\n\s*:unattributed="resolveRequestBot\(detail\)\.unattributed"/)
    // 归属口径归采集器所有：视图不得拿「有没有 botId」再推一遍。
    expect(workspaceSource).toMatch(/function resolveRequestBot[\s\S]*?unattributed: record\.attribution === 'unattributed'/)
    expect(workspaceSource).not.toMatch(/function resolveRequestBot[\s\S]*?unattributed: !record\.entities\.botId/)
    // 只覆盖描边与配色，色值取自令牌；机器人收一圈，机头与斜线两端都不顶到虚线环。
    expect(styles).toMatch(/\.chatluna-studio-model-request-unattributed-avatar\s*\{[^}]*border:\s*1px dashed[^}]*color:\s*var\(--chatluna-studio-muted\)[^}]*background:\s*var\(--chatluna-studio-surface-muted\)/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-unattributed-avatar\s*>\s*svg\s*\{[^}]*width:\s*calc\(var\(--chatluna-studio-avatar-size[^}]*height:\s*calc\(var\(--chatluna-studio-avatar-size/s)
  })

  it('详情概览与元信息：详情头部的导航与视图切换、概览格、用量格、元信息列表与请求头树', () => {
    const workspaceSource = readFileSync(resolve('client/model-request/workspace.vue'), 'utf8')
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')
    const detailHeader = workspaceSource.match(/<article v-else[\s\S]*?<header>([\s\S]*?)<\/header>/)?.[1] ?? ''
    const pageHeader = workspaceSource.match(/<header class="chatluna-studio-model-request-header">([\s\S]*?)<\/header>/)?.[1] ?? ''

    expect(workspaceSource).toMatch(/chatluna-studio-model-request-bot-copy[\s\S]*chatluna-studio-model-request-bot-name[\s\S]*resolveRequestBot\(detail\)\.name[\s\S]*formatStudioDateTime\(detail\.createdAt\)/)
    expect(detailHeader).not.toContain('detail.durationMs')
    expect(detailHeader).toContain('chatluna-studio-model-request-detail-nav')
    expect(detailHeader).toContain('chatluna-studio-model-request-view-switch')
    expect(detailHeader).not.toContain('IconArrowLeft')
    expect(detailHeader).not.toContain('returnLabel')
    expect(styles).toMatch(/\.chatluna-studio-model-request-detail-nav\s*\{[^}]*margin-left:\s*auto/s)
    expect(pageHeader).toContain('returnLabel')
    expect(pageHeader.indexOf('刷新')).toBeLessThan(pageHeader.indexOf('returnLabel'))
    expect(styles).toMatch(/\.chatluna-studio-model-request-actions\s*\{[^}]*flex-direction:\s*column[^}]*align-items:\s*flex-end/s)
    expect(workspaceSource).not.toContain('原始证据')
    expect(styles).toMatch(/\.chatluna-studio-model-request-detail > header\s*\{[^}]*justify-content:\s*space-between/s)
    expect(workspaceSource).toContain("return '已完成'")
    expect(workspaceSource).not.toContain("return '成功'")
    expect(workspaceSource).not.toContain('durationMs }} ms')
    expect(workspaceSource).toMatch(/chatluna-studio-model-request-overview[\s\S]*statusLabel\(detail\.status\)[\s\S]*来源[\s\S]*模型 ID[\s\S]*耗时[\s\S]*字段[\s\S]*消息[\s\S]*工具/)
    expect(workspaceSource).not.toContain('API 密钥名称')
    // 用量格逐格渲染 module 给出的取词结果；八项、顺序与缺省符号由 model-request-overview 的行为测试守。
    expect(workspaceSource).toMatch(/chatluna-studio-model-request-usage-grid[\s\S]*v-for="item in usageItems"[\s\S]*{{ item\.label }}[\s\S]*{{ item\.value }}/)
    expect(workspaceSource).not.toContain('usageStateLabel')
    // 概览格的计数由共享模型证据投影派生，不再读旧的请求体摘要字段。
    expect(workspaceSource).not.toContain('summary.keys')
    expect(workspaceSource).toMatch(/chatluna-studio-model-request-meta-list[\s\S]*请求地址[\s\S]*关联实体/)
    // 关联实体渲染成「标签 + 值」，项目、顺序与文案由 model-request-overview 的行为测试守；
    // 这里守视图不再自己拼 `key=value`，且观感跟着请求地址走等宽值加强调色标签。
    expect(workspaceSource).toMatch(/chatluna-studio-model-request-entities[\s\S]*v-for="chip in entityChips"[\s\S]*<strong>{{ chip\.label }}<\/strong>[\s\S]*chatluna-studio-model-request-entity-value[\s\S]*{{ chip\.value }}/)
    expect(workspaceSource).toContain('无关联实体')
    expect(workspaceSource).not.toContain('formatEntities')
    expect(workspaceSource).not.toContain("`${key}=${value}`")
    expect(styles).toMatch(/\.chatluna-studio-model-request-entities\s*\{[^}]*flex-wrap:\s*wrap[^}]*font-family:\s*var\(--chatluna-studio-font-mono\)/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-entity strong\s*\{[^}]*color:\s*var\(--chatluna-studio-accent\)/s)
    expect(workspaceSource).toMatch(/<div v-if="headersExpanded" class="chatluna-studio-model-request-header-json">[\s\S]*<div class="chatluna-studio-model-request-json-viewer">[\s\S]*:node="headersTree"/)
    expect(workspaceSource).toContain(':strings-expanded="true"')
    expect(styles).toContain('.chatluna-studio-model-request-header-toggle')
    expect(styles).toMatch(/\.chatluna-studio-model-request-header-json \.chatluna-studio-model-request-json-viewer\s*\{[^}]*min-height:\s*0[^}]*max-height:\s*320px/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-overview-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-usage-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-meta-list\s*\{[^}]*display:\s*grid[^}]*border:\s*1px solid var\(--chatluna-studio-border\)/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-meta-list \.chatluna-studio-model-request-meta\s*\{[^}]*grid-template-columns:\s*17px minmax\(64px, auto\) minmax\(0, 1fr\)/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-bot-copy\s*\{[^}]*display:\s*grid[^}]*gap:\s*2px/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-bot-name\s*\{[^}]*flex-wrap:\s*wrap/s)
    // 模型名称是采集那一刻的记录事实；详情视图不得再从请求体或请求地址推断第二份。
    // 展示名的三态取词已有 model-request-overview 的行为测试，这里只守「不得出现第二份推断」。
    expect(workspaceSource).not.toContain('detailModel')
    expect(workspaceSource).not.toContain('modelVersion')
    expect(workspaceSource).not.toContain('/models/')
  })

  it('错误诊断：错误码、报错、原始原因与可能的原因四项及其容器', () => {
    const workspaceSource = readFileSync(resolve('client/model-request/workspace.vue'), 'utf8')
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')

    expect(workspaceSource).toContain('detail.error.message')
    expect(workspaceSource).toContain('错误诊断')
    expect(workspaceSource).toContain('<dt class="chatluna-studio-model-request-error-code-label">错误码</dt>')
    expect(workspaceSource).toContain('<dt>报错</dt>')
    expect(workspaceSource).toContain('原始原因')
    expect(workspaceSource).toContain('<dt>可能的原因</dt>')
    expect(workspaceSource).not.toContain('ChatLuna 文档中的可能原因')
    expect(workspaceSource).not.toContain('未捕获到 ChatLuna 规范错误')
    expect(workspaceSource).toContain('chatluna-studio-model-request-error-code')
    expect(workspaceSource).toContain('chatluna-studio-model-request-error-trace')
    expect(styles).toContain('.chatluna-studio-model-request-error-diagnostic')
    expect(styles).toContain('.chatluna-studio-model-request-error-causes')
    expect(styles).toContain('.chatluna-studio-model-request-error-code')
    expect(styles).toContain('.chatluna-studio-model-request-error-trace')
  })

  it('请求体与响应视图：三个页签的顺序、响应采集状态文案、内容预览分区与图片预览开关', () => {
    const workspaceSource = readFileSync(resolve('client/model-request/workspace.vue'), 'utf8')
    const responsePreviewSource = readFileSync(resolve('client/model-request/response-content-preview.vue'), 'utf8')
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')

    expect(workspaceSource).not.toContain('展开长字符串')
    expect(workspaceSource).not.toContain('收起长字符串')
    expect(workspaceSource).toMatch(/role="tab"[\s\S]*分析[\s\S]*role="tab"[\s\S]*请求[\s\S]*role="tab"[\s\S]*响应/)
    expect(workspaceSource).toContain('mode="conversation"')
    expect(workspaceSource).toContain('mode="request"')
    expect(workspaceSource).toContain(':show-mode-switch="false"')
    expect(workspaceSource).toContain('正在采集响应体…')
    expect(workspaceSource).toContain('响应体采集失败')
    expect(workspaceSource).not.toContain('extractModelResponseContent')
    expect(workspaceSource).toContain('<ModelResponseContentPreview')
    expect(workspaceSource).toContain('内容预览')
    expect(workspaceSource).toContain('JSON 原文')
    expect(workspaceSource).toContain('<ModelRequestTrajectory')
    expect(responsePreviewSource).toContain('模型输出')
    expect(responsePreviewSource).toContain('思考内容')
    expect(responsePreviewSource).toContain('工具调用')
    expect(responsePreviewSource).toContain('结束原因')
    expect(workspaceSource).toMatch(/:node="requestTree"[\s\S]*:images-preview="true"/)
    expect(workspaceSource).not.toMatch(/:node="headersTree"[\s\S]{0,180}:images-preview="true"/)
    expect(workspaceSource).not.toMatch(/:node="responseTree"[\s\S]{0,180}:images-preview="true"/)
    expect(workspaceSource).not.toContain('stringsExpanded')
    expect(workspaceSource).not.toContain('canExpandBodyStrings')
    expect(workspaceSource).toContain(':root="true"')
    expect(styles).toMatch(/\.chatluna-studio-model-request-response-raw\s*\{[^}]*overflow:\s*auto[^}]*white-space:\s*pre-wrap[^}]*user-select:\s*text/s)
    expect(styles).toMatch(/\.chatluna-studio-model-response-preview\s*\{[^}]*display:\s*grid[^}]*overflow:\s*auto/s)
    expect(styles).toMatch(/\.chatluna-studio-model-response-section\.is-content,\s*\n\s*\.chatluna-studio-model-response-section\.is-reasoning\s*\{[^}]*border-left-color:\s*var\(--chatluna-studio-role-response\)/s)
    expect(styles).toMatch(/\.chatluna-studio-model-response-section\.is-tools\s*\{[^}]*border-left-color:\s*var\(--chatluna-studio-role-tool-interaction\)/s)
  })

  it('请求组成图：轨道缩放控件、变量分段标签与空态文案', () => {
    const trajectorySource = readFileSync(resolve('client/model-request/trajectory.vue'), 'utf8')
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')

    expect(trajectorySource).toContain('请求体提示词内容占比')
    expect(trajectorySource).toContain('aria-label="轨道缩放"')
    expect(trajectorySource).toMatch(/chatluna-studio-model-trajectory-controls[\s\S]*chatluna-studio-model-trajectory-control-query[\s\S]*chatluna-studio-model-trajectory-composition-zoom[\s\S]*chatluna-studio-model-trajectory-search[\s\S]*chatluna-studio-model-trajectory-composition-shell/)
    expect(trajectorySource).not.toContain('Ctrl + 滚轮')
    expect(trajectorySource).not.toContain("'is-expanded': compositionZoom > COMPOSITION_ZOOM_MIN")
    expect(trajectorySource).toContain("'is-variable': segment.variableId")
    // 一条消息被变量切开后会产出多段同 evidenceId 的分段，渲染键必须自带序号，否则同一轨道内撞键。
    expect(trajectorySource).toContain('id: `${index}:${item.evidenceId}`')
    expect(trajectorySource).toContain('id: `${slot.id}:${index}:${item.evidenceId}`')
    // 变量分段的标题标签同样来自证据种类 module，不在视图里硬编码一份。
    expect(trajectorySource).toContain("`${evidenceTitleLabel('variable')} · ${segment.variableName}`")
    expect(trajectorySource).toContain('当前会话没有可投影的请求组成')
    expect(styles).toMatch(/\.chatluna-studio-model-trajectory-composition-bar\s*\{[^}]*position:\s*absolute/s)
    expect(styles).toMatch(/\.chatluna-studio-model-trajectory-composition-viewport\s*\{[^}]*overflow-x:\s*auto/s)
    expect(styles).not.toMatch(/\.chatluna-studio-model-trajectory-composition-viewport[^}]*cursor:/s)
    expect(styles).toMatch(/\.chatluna-studio-model-trajectory-control-query\s*\{[^}]*display:\s*flex[^}]*gap:\s*8px[^}]*margin-left:\s*auto/s)
    expect(styles).toMatch(/\.chatluna-studio-model-trajectory-composition-zoom\s*\{[^}]*position:\s*relative[^}]*flex:\s*0 0 auto[^}]*gap:\s*1px/s)
    expect(styles).toMatch(/\.chatluna-studio-model-trajectory-search\s*\{[^}]*flex:\s*0 1 164px/s)
    expect(styles).not.toContain('.chatluna-studio-model-trajectory-composition-zoom.is-expanded')
    expect(styles).not.toMatch(/\.chatluna-studio-model-trajectory-composition-zoom\s*\{[^}]*border:/s)
    expect(styles).not.toMatch(/\.chatluna-studio-model-trajectory-composition-zoom\s*\{[^}]*background:/s)
    expect(styles).not.toMatch(/\.chatluna-studio-model-trajectory-composition-zoom\s*\{[^}]*backdrop-filter:/s)
    expect(styles).not.toMatch(/\.chatluna-studio-model-trajectory-composition-zoom\s*\{[^}]*box-shadow:/s)
    expect(styles).toMatch(/\.chatluna-studio-model-trajectory-composition-tracks\s*\{[^}]*min-width:\s*100%/s)
    expect(styles).toMatch(/\.chatluna-studio-model-trajectory-composition-bar\.is-variable\s*\{[^}]*background:\s*var\(--chatluna-studio-role-variable\)/s)
    expect(styles).toMatch(/\.chatluna-studio-model-trajectory-composition-bar\.is-selected\s*\{[^}]*z-index:\s*1[^}]*0 0 0 1px var\(--chatluna-studio-trajectory-layer\)[^}]*0 0 0 2px var\(--chatluna-studio-accent\)/s)
    expect(styles).not.toMatch(/\.chatluna-studio-model-trajectory-composition-bar\.is-selected\s*\{[^}]*outline:/s)
  })

  it('轨迹账本与检查器：模式切换、账本列与种类标签、请求折叠、检查器容器与工具栏折叠', () => {
    const trajectorySource = readFileSync(resolve('client/model-request/trajectory.vue'), 'utf8')
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')
    const toggleRequestCollapsedSource = trajectorySource.match(/function toggleRequestCollapsed\([\s\S]*?\n}\n/)?.[0] ?? ''

    expect(trajectorySource).toContain('单请求')
    expect(trajectorySource).toContain('完整会话')
    expect(trajectorySource).not.toContain('上下文')
    expect(trajectorySource).not.toContain('contextMarkers')
    expect(trajectorySource).not.toContain('toolMarkers')
    expect(trajectorySource).toContain('TTFT 与解码阶段')
    expect(trajectorySource).toContain('轨迹事件账本')
    expect(trajectorySource).toContain('打开原始请求')
    expect(trajectorySource).toMatch(/<header>[\s\S]*打开原始请求[\s\S]*<\/header>/)
    expect(trajectorySource).not.toContain('<Badge variant="outline">{{ kindLabel(selectedRow.kind) }}</Badge>')
    // 轨迹行不再携带原始证据副本，也不再靠角色内序号定位。
    expect(trajectorySource).not.toContain('row.detail')
    expect(trajectorySource).not.toContain('indexInKind')
    expect(trajectorySource).toContain('layout="inspector"')
    expect(trajectorySource).toContain('class="chatluna-studio-model-trajectory-inspector-close"')
    expect(trajectorySource).toContain('v-chatluna-studio-scrollbar="{ showOverlay: false }"')
    // 账本选中行与组成分段共用同一种定位信号形状，且从证据导航 module 的同一个发号源取号。
    expect(trajectorySource).toContain(':locate-request="inspectorLocateRequest"')
    expect(trajectorySource).toContain(':locate-request="analysisLocateRequest"')
    expect(trajectorySource).not.toContain('locateSeq')
    expect(trajectorySource).not.toContain('inspectorFocusToken')
    expect(trajectorySource).toContain('正在加载分析…')
    expect(trajectorySource).not.toContain('selectedTree')
    expect(trajectorySource).not.toContain('chatluna-studio-model-trajectory-facts')
    expect(styles).toMatch(/\.chatluna-studio-model-trajectory-ledger\.has-inspector\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(480px, 42%\)/s)
    expect(styles).toMatch(/\.chatluna-studio-model-trajectory-inspector-close\s*\{[^}]*position:\s*absolute[^}]*top:\s*0[^}]*right:\s*0/s)
    expect(styles).toMatch(/\.chatluna-studio-model-analysis\.is-inspector \.chatluna-studio-model-analysis-main \{[^}]*display: block/s)
    expect(styles).toMatch(/\.chatluna-studio-model-analysis\.is-inspector \.chatluna-studio-model-analysis-content \{[^}]*max-height: none/s)
    expect(styles).toMatch(/\.chatluna-studio-model-trajectory-row\s*\{[^}]*grid-template-columns:\s*122px minmax\(0, 1fr\)/s)
    expect(trajectorySource).toContain('耗时')
    expect(trajectorySource).toContain('placeholder="搜索"')
    expect(trajectorySource).toContain("'当前请求按倒序排列，点击改为正序'")
    expect(trajectorySource).toMatch(/耗时[\s\S]*?mode === 'conversation' && !analysis[\s\S]*?请求/)
    expect(trajectorySource).not.toContain('selectAndToggleRequest(row)')
    expect(toggleRequestCollapsedSource).not.toContain('selectedRowId.value')
    // 账本种类列的标签来自证据种类 module 的徽标变体，视图里不再有第二张标签表。
    expect(trajectorySource).toContain("kind === 'request' ? 'REQUEST' : studioEvidenceLabels(kind).badge")
    expect(trajectorySource).not.toContain('请求侧')
    expect(trajectorySource).toContain('VARIABLE')
    expect(trajectorySource).not.toContain('响应侧')
    expect(trajectorySource).not.toContain('MODEL_EVIDENCE_FILTER_SOURCES')
    // 过滤开关多了之后工具栏必须能换行，否则窄屏会把搜索框挤出容器。
    expect(styles).toMatch(/\.chatluna-studio-model-trajectory-controls\s*\{[^}]*min-height:\s*32px/s)
    expect(styles).toMatch(/\.chatluna-studio-model-trajectory-controls\s*\{[^}]*flex-wrap:\s*wrap/s)
    // 过滤开关沿用「请求」按钮的原样式，不额外加删除线或降饱和。
    expect(styles).not.toContain('text-decoration: line-through')
    // 横向折叠收起时必须一并移出焦点顺序，不能只是宽度归零。
    expect(styles).toMatch(/\.chatluna-studio-model-trajectory-control-filters\.is-collapsed\s*\{[^}]*visibility:\s*hidden/s)
    // 用 0fr → 1fr 向右展开到内容宽；组内按钮不得换行，否则宽屏也会向下长高。
    expect(styles).toMatch(/\.chatluna-studio-model-trajectory-control-filters\.is-collapsed\s*\{[^}]*grid-template-columns:\s*0fr/s)
    expect(styles).toMatch(/\.chatluna-studio-model-trajectory-control-filters-inner\s*\{[^}]*flex-wrap:\s*nowrap/s)
    expect(styles).not.toMatch(/\.chatluna-studio-model-trajectory-control-filters\s*\{[^}]*flex-wrap:\s*wrap/s)
    expect(styles).not.toMatch(/\.chatluna-studio-model-trajectory-control-filters[^}]*cursor:/s)
  })

  it('跨视图往返：返回快照、页签恢复与滚动恢复全部交给证据导航与滚动恢复 module', () => {
    const workspaceSource = readFileSync(resolve('client/model-request/workspace.vue'), 'utf8')
    const trajectorySource = readFileSync(resolve('client/model-request/trajectory.vue'), 'utf8')

    expect(workspaceSource).toContain(':detail="detail"')
    expect(workspaceSource).toMatch(/v-else-if="bodyView === 'analysis'"[\s\S]*@open-request="openRelatedRequest"/)
    // 返回快照与「详情到达后才消费」的判定都在证据导航 module 里；工作台不再持有任何镜像状态。
    expect(workspaceSource).not.toContain('canReturnToTrajectory')
    expect(workspaceSource).not.toContain('createEvidenceNavigationStack')
    expect(workspaceSource).not.toContain('pendingReturnState')
    expect(workspaceSource).not.toContain('returnStateToken')
    expect(workspaceSource).not.toContain("bodyView.value = pending.source === 'response' ? 'response' : 'request'")
    expect(workspaceSource).not.toContain(':highlight-path="requestHighlightPath"')
    expect(workspaceSource).not.toContain('highlight-action-label="返回"')
    // 两处滚动恢复都交给 scroll-restore，不再各写一套 nextTick + requestAnimationFrame。
    expect(workspaceSource).not.toContain('detailElement.value.scrollTop = state.detailScrollTop')
    expect(trajectorySource).not.toContain('ledgerElement.value.scrollTop = state.scrollTop')
    expect(workspaceSource).toContain(':restore-state="navigation.viewRestore.value"')
  })

  it('JSON 树交互：字符串与图片视图切换、行手势守卫与定位高亮', () => {
    const jsonSource = readFileSync(resolve('client/model-request/json-tree.vue'), 'utf8')
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')

    expect(jsonSource).toContain('data-json-path')
    expect(styles).toContain('.chatluna-studio-model-request-json-node.is-highlighted')
    expect(jsonSource).toContain('chatluna-studio-model-request-json-image')
    expect(jsonSource).toContain('图片预览')
    expect(jsonSource).toContain('image - {{ formatModelRequestJsonImageSize(imageSource.source) }}')
    expect(jsonSource).toContain('>raw<')
    expect(jsonSource).toContain('>image<')
    expect(jsonSource).not.toContain('clipboard')
    expect(jsonSource).not.toContain(':title=')
    expect(jsonSource).toMatch(/<span\s+v-if="node\.valueKind === 'string'"\s+class="chatluna-studio-model-request-json-string"/)
    expect(jsonSource).toMatch(/class="chatluna-studio-model-request-json-toggle chatluna-studio-model-request-json-string-toggle"/)
    expect(jsonSource).not.toContain("window.getSelection()?.isCollapsed")
    expect(styles).toMatch(/\.chatluna-studio-model-request-json-viewer\s*\{[^}]*overflow:\s*auto[^}]*border:\s*1px solid var\(--chatluna-studio-border\)[^}]*border-radius:\s*8px[^}]*user-select:\s*text/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-json-children\s*\{[^}]*border-left:\s*1px solid var\(--chatluna-studio-border\)/s)
    expect(styles).toMatch(/data-value-kind="number"[^}]*color:\s*#d97706/s)
    expect(styles).toMatch(/data-value-kind="boolean"[^}]*color:\s*#2563eb/s)
    expect(styles).toMatch(/data-value-kind="null"[^}]*color:\s*#e11d48/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-json-string\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-json-string-expanded\s*\{[^}]*white-space:\s*pre-wrap/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-json-image\s*\{[^}]*max-width:\s*100%[^}]*max-height:\s*360px/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-json-image-preview\s*\{[^}]*display:\s*grid/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-json-image-summary\s*\{[^}]*font-style:\s*italic/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-json-image-mode\s*\{[^}]*text-decoration:\s*underline/s)
  })

  it('样式：工作台栅格、粘性轨迹头、徽标与角色配色', () => {
    const workspaceSource = readFileSync(resolve('client/model-request/workspace.vue'), 'utf8')
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')

    expect(workspaceSource).toContain("'has-sticky-trajectory': detailView === 'trajectory' || bodyView === 'analysis'")
    expect(workspaceSource).toContain("'is-trajectory-view': detailView === 'trajectory'")
    expect(styles).toMatch(/\.chatluna-studio-model-request-detail\.has-sticky-trajectory \{[^}]*padding-top: 0;/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-detail\.has-sticky-trajectory > header:first-child \{[^}]*padding-top: 16px;/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-detail\.is-trajectory-view \{[^}]*overflow: hidden;/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-detail\.is-trajectory-view > \.chatluna-studio-model-trajectory \{[^}]*position: relative;[^}]*height: 100%[^}]*min-height: 0;/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-detail\.is-trajectory-view \.chatluna-studio-model-trajectory-header \{[^}]*position: absolute;[^}]*inset: 0 0 auto;[^}]*overflow: clip;/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-detail\.is-trajectory-view \.chatluna-studio-model-trajectory-header::before \{[^}]*z-index: 0;/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-detail\.is-trajectory-view \.chatluna-studio-model-trajectory-header > \* \{[^}]*z-index: 1;/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-detail\.is-trajectory-view \.chatluna-studio-model-trajectory-table::before \{[^}]*height: var\(--chatluna-studio-model-trajectory-sticky-height[^}]*content: "";/s)
    expect(styles).toMatch(/\.chatluna-studio-workspace\.is-frosted \.chatluna-studio-model-trajectory \{[^}]*background: transparent;/s)
    expect(styles).not.toMatch(/\.chatluna-studio-model-request-detail\.is-trajectory-view \.chatluna-studio-model-trajectory-header \{[^}]*top:\s*-/s)
    expect(styles).toMatch(/\.chatluna-studio-workspace \.studio-badge\.chatluna-studio-model-request-complete(?:,\s*\.chatluna-studio-workspace \.studio-badge\.chatluna-studio-model-request-status-success)?\s*\{[^}]*color:\s*#047857[^}]*background:\s*#d1fae5/s)
    expect(styles).toMatch(/\.chatluna-studio-chat\.chatluna-studio-model-request-workspace\s*\{[^}]*grid-template-rows:\s*auto auto minmax\(0, 1fr\)/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-split\s*\{[^}]*grid-row:\s*3/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-list-pane\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/s)
    expect(styles).toMatch(/\.chatluna-studio-model-request-list-toolbar\s*\{[^}]*border-bottom:\s*1px solid var\(--chatluna-studio-border\)/s)
    expect(styles).not.toContain('.chatluna-studio-model-request-filters {')
    expect(styles).toContain('--chatluna-studio-trajectory-request: #2f76c9')
    expect(styles).toContain('--chatluna-studio-trajectory-request: #4d8ed3')
    expect(styles).toContain('--chatluna-studio-role-variable: #a13d76')
    expect(styles).toContain('--chatluna-studio-role-variable: #dd79b2')
  })

  it('结构化 JSON 只展开对象和数组，标量保持为只读节点', () => {
    const tree = buildModelRequestJsonTree({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: '你好' }],
    }, 'requestBody')

    expect(tree.kind).toBe('object')
    expect(tree.children.map(({ key }) => key)).toEqual(['model', 'messages'])
    expect(tree.children[0]).toMatchObject({ key: 'model', kind: 'value', valueKind: 'string', preview: '"gpt-4.1"' })
    expect(tree.children[1]).toMatchObject({ key: 'messages', kind: 'array', preview: '1 items' })
  })

  it('识别 Data URL、Anthropic 裸 Base64 和 b64_json 图片，并拒绝普通 Base64', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
    const dataUrl = `data:image/png;base64,${png}`
    const anthropic = { media_type: 'image/png', data: png }

    expect(parseModelRequestImageSource(dataUrl)).toEqual({
      source: dataUrl,
      mimeType: 'image/png',
    })
    expect(parseModelRequestImageSource(anthropic.data, 'data', anthropic)).toEqual({
      source: dataUrl,
      mimeType: 'image/png',
    })
    expect(parseModelRequestImageSource(png, 'b64_json', {})).toEqual({
      source: dataUrl,
      mimeType: 'image/png',
    })
    expect(parseModelRequestImageSource(png, 'data', {})).toBeUndefined()
    expect(parseModelRequestImageSource(png, 'image', { mime_type: 'text/plain' })).toBeUndefined()
    expect(parseModelRequestImageSource('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBeUndefined()
    expect(parseModelRequestImageSource('data:text/html;base64,PGgxPng8L2gxPg==')).toBeUndefined()
    expect(parseModelRequestImageSource('https://example.com/image.png')).toBeUndefined()

    expect(buildModelRequestJsonTree({ image: anthropic }).children[0]?.children[1]).toMatchObject({
      imageSource: { source: dataUrl, mimeType: 'image/png' },
    })
  })

  it('按数量级将耗时切换为 ms、s、min、h', () => {
    expect(formatDuration(0)).toBe('0 ms')
    expect(formatDuration(842)).toBe('842 ms')
    expect(formatDuration(1000)).toBe('1 s')
    expect(formatDuration(1240)).toBe('1.24 s')
    expect(formatDuration(12400)).toBe('12.4 s')
    expect(formatDuration(60_000)).toBe('1 min')
    expect(formatDuration(83_400)).toBe('1 min 23 s')
    expect(formatDuration(3_600_000)).toBe('1 h')
    expect(formatDuration(3_723_000)).toBe('1 h 2 min 3 s')
  })

  it('实时刷新默认关闭，仅在开关打开且页面可见时按 2 秒轮询', () => {
    expect(MODEL_REQUEST_LIVE_REFRESH_INTERVAL_MS).toBe(2000)
    const timeouts: Array<() => void> = []
    const handles: number[] = []
    let enabled = false
    let visible = true
    let refreshCount = 0
    const live = createModelRequestLiveRefresh({
      isEnabled: () => enabled,
      isVisible: () => visible,
      refresh: () => { refreshCount += 1 },
      setInterval: (handler) => {
        timeouts.push(handler)
        handles.push(handles.length + 1)
        return handles.at(-1) as unknown as ReturnType<typeof setInterval>
      },
      clearInterval: () => {
        timeouts.length = 0
      },
    })

    live.sync()
    expect(live.isRunning()).toBe(false)

    enabled = true
    live.sync()
    expect(live.isRunning()).toBe(true)
    timeouts[0]?.()
    expect(refreshCount).toBe(1)

    visible = false
    live.sync()
    expect(live.isRunning()).toBe(false)

    visible = true
    live.sync()
    expect(live.isRunning()).toBe(true)

    live.dispose()
    expect(live.isRunning()).toBe(false)
  })

  it('进入页面时把 onMounted 与 onActivated 合并为一次刷新', async () => {
    let refreshCount = 0
    const enter = createModelRequestEnterRefresh(() => {
      refreshCount += 1
    })

    enter.schedule()
    enter.schedule()
    expect(refreshCount).toBe(0)

    await Promise.resolve()
    expect(refreshCount).toBe(1)

    enter.schedule()
    await Promise.resolve()
    expect(refreshCount).toBe(2)
  })
})
