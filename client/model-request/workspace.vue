<template>
  <main class="chatluna-studio-chat chatluna-studio-model-request-workspace" aria-label="模型请求工作台">
    <header class="chatluna-studio-model-request-header">
      <div>
        <h1>模型请求</h1>
        <p>查看模型调用请求日志</p>
      </div>
      <div class="chatluna-studio-model-request-actions">
        <div class="chatluna-studio-model-request-action-row">
          <label class="chatluna-studio-model-request-live">
            <Switch v-model="liveRefresh" aria-label="自动刷新" />
            <span>自动刷新</span>
          </label>
          <Button variant="outline" :disabled="loading" @click="refresh()">
            <IconRefresh :size="16" aria-hidden="true" />
            刷新
          </Button>
          <Button
            variant="destructive"
            :disabled="loading || !records.length"
            @click="openClearDialog"
          >
            <IconTrash :size="16" aria-hidden="true" />
            清理全部记录
          </Button>
        </div>
        <Button
          v-if="returnLabel"
          class="chatluna-studio-model-request-return"
          size="sm"
          variant="ghost"
          :aria-label="returnLabel"
          @click="returnFromDetail"
        >
          <IconArrowLeft data-icon="inline-start" aria-hidden="true" />
          返回
        </Button>
      </div>
    </header>

    <div v-if="error || navigationStatus" class="chatluna-studio-model-request-status">
      <p v-if="error" class="chatluna-studio-model-request-error" role="alert">{{ error }}</p>
      <p v-else role="status">{{ navigationStatus }}</p>
    </div>

    <div class="chatluna-studio-model-request-split">
      <section class="chatluna-studio-model-request-list-pane" aria-label="模型请求列表">
        <header class="chatluna-studio-model-request-list-toolbar chatluna-studio-overlay-header">
          <div class="chatluna-studio-model-request-list-heading">
            <h2>请求列表</h2>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <span
                    class="chatluna-studio-model-request-capacity"
                    :class="{ 'is-near-limit': capacityGauge.nearLimit }"
                    tabindex="0"
                    role="img"
                    :aria-label="capacityGauge.ariaLabel"
                  >
                    <svg viewBox="0 0 32 32" aria-hidden="true">
                      <circle class="chatluna-studio-model-request-capacity-track" cx="16" cy="16" r="13" />
                      <circle class="chatluna-studio-model-request-capacity-track" cx="16" cy="16" r="9" />
                      <!-- 两道上限各占一环：外环体积、内环条数。stroke-dasharray 的第一段是已用弧长，
                           周长按 2πr 求出后写死在 dasharray 里，避免每帧再算一次。 -->
                      <circle
                        class="chatluna-studio-model-request-capacity-arc is-bytes"
                        cx="16"
                        cy="16"
                        r="13"
                        :stroke-dasharray="`${capacityGauge.byteArc} ${capacityGauge.byteCircumference}`"
                      />
                      <circle
                        class="chatluna-studio-model-request-capacity-arc is-records"
                        cx="16"
                        cy="16"
                        r="9"
                        :stroke-dasharray="`${capacityGauge.recordArc} ${capacityGauge.recordCircumference}`"
                      />
                    </svg>
                  </span>
                </TooltipTrigger>
                <TooltipContent class="chatluna-studio-model-request-capacity-tip">
                  <div class="chatluna-studio-model-request-capacity-metrics">
                    <span class="chatluna-studio-model-request-capacity-swatch is-bytes" aria-hidden="true" />
                    <span>体积</span>
                    <strong :class="{ 'is-near-limit': capacityGauge.byteNearLimit }">{{ capacityGauge.byteUsed }}</strong>
                    <span class="chatluna-studio-model-request-capacity-max">/ {{ capacityGauge.byteMax }}</span>
                    <span class="chatluna-studio-model-request-capacity-swatch is-records" aria-hidden="true" />
                    <span>条数</span>
                    <strong :class="{ 'is-near-limit': capacityGauge.recordNearLimit }">{{ capacityGauge.recordUsed }}</strong>
                    <span class="chatluna-studio-model-request-capacity-max">/ {{ capacityGauge.recordMax }}</span>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div class="chatluna-studio-model-request-list-tools">
            <button
              type="button"
              class="chatluna-studio-model-request-sort"
              :aria-label="sortOrder === 'asc' ? '当前按时间正序，点击改为倒序' : '当前按时间倒序，点击改为正序'"
              @click="toggleSortOrder"
            >
              {{ sortOrder === 'asc' ? '按时间正序' : '按时间倒序' }}
              <IconChevronUp v-if="sortOrder === 'asc'" :size="16" aria-hidden="true" />
              <IconChevronDown v-else :size="16" aria-hidden="true" />
            </button>
            <Popover v-model:open="filterOpen">
              <PopoverTrigger as-child>
                <Button
                  variant="outline"
                  size="icon-sm"
                  class="chatluna-studio-model-request-filter-trigger"
                  :class="{ 'is-filtered': filtersActive }"
                  :aria-label="`筛选模型请求，当前：${filterSummary}`"
                >
                  <IconFilter :size="16" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                class="chatluna-studio-model-request-filter-popover relative"
                aria-label="模型请求筛选"
              >
              <label>
                <span>范围</span>
                <Select v-model="category">
                  <SelectTrigger class="chatluna-studio-model-request-control" aria-label="按范围筛选">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent :portal-to="filterSelectPortalTarget" class="z-[120]">
                    <SelectItem value="all">全部记录</SelectItem>
                    <SelectItem value="attributed">已归属会话</SelectItem>
                    <SelectItem value="unattributed">未归属</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label v-if="category !== 'unattributed'">
                <span>机器人</span>
                <Select v-model="botSelection">
                  <SelectTrigger class="chatluna-studio-model-request-control" aria-label="按机器人筛选">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent :portal-to="filterSelectPortalTarget" class="z-[120]">
                    <SelectItem :value="ANY_FILTER_VALUE">全部机器人</SelectItem>
                    <SelectItem v-for="bot in facets.bots" :key="bot.id" :value="bot.id">
                      {{ bot.name || bot.id }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label v-if="category !== 'unattributed'">
                <span>会话</span>
                <Select v-model="conversationSelection">
                  <SelectTrigger class="chatluna-studio-model-request-control" aria-label="按会话筛选">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent :portal-to="filterSelectPortalTarget" class="z-[120]">
                    <SelectItem :value="ANY_FILTER_VALUE">全部会话</SelectItem>
                    <SelectItem
                      v-for="conversation in selectableConversations"
                      :key="conversation.id"
                      :value="conversation.id"
                    >
                      {{ conversation.name || conversation.id }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label>
                <span>模型</span>
                <Input
                  v-model="model"
                  class="chatluna-studio-model-request-control"
                  placeholder="例如 gpt-4.1"
                  @keyup.enter="refresh()"
                />
              </label>
              <label class="chatluna-studio-model-request-error-filter">
                <Checkbox v-model="errorsOnly" />
                <span>仅显示错误</span>
              </label>
              <Button variant="outline" size="sm" @click="resetFilters">重置</Button>
              <div
                ref="filterSelectPortalTarget"
                class="pointer-events-none absolute inset-0 z-[120] [&_[data-reka-popper-content-wrapper]]:pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          </div>
        </header>

        <div v-if="loading && !displayRecords.length" class="chatluna-studio-model-request-empty">正在读取模型请求记录…</div>
        <div v-else-if="!displayRecords.length" class="chatluna-studio-model-request-empty">暂无符合条件的模型请求记录</div>
        <div v-else v-chatluna-studio-scrollbar class="chatluna-studio-model-request-list">
          <button
            v-for="record in displayRecords"
            :key="record.id"
            type="button"
            class="chatluna-studio-model-request-item"
            :class="{ 'is-selected': record.id === selectedRecordId }"
            :aria-current="record.id === selectedRecordId ? 'true' : undefined"
            @click="openRecord(record.id)"
          >
            <header>
              <div class="chatluna-studio-model-request-item-title">
                <span class="chatluna-studio-model-request-bot">
                  <ModelRequestAvatar
                    :unattributed="resolveRequestBot(record).unattributed"
                    :name="resolveRequestBot(record).name"
                    :avatar="resolveRequestBot(record).avatar"
                  />
                  <span class="chatluna-studio-model-request-bot-copy">
                    <span class="chatluna-studio-model-request-bot-name">
                      <strong>{{ resolveRequestBot(record).name }}</strong>
                      <Badge :class="statusClass(record.status)">{{ statusLabel(record.status) }}</Badge>
                      <Badge variant="outline" class="chatluna-studio-model-request-source">{{ formatConversationLabel(record.entities) }}</Badge>
                    </span>
                    <span class="chatluna-studio-model-request-timing">
                      <time>
                        <IconCalendarTime :size="14" aria-hidden="true" />
                        {{ formatStudioDateTime(record.createdAt) }}
                      </time>
                      <span>
                        <IconClock :size="14" aria-hidden="true" />
                        {{ formatDuration(record.durationMs) }}
                      </span>
                    </span>
                  </span>
                </span>
              </div>
            </header>
          </button>
          <Button
            v-if="hasMore"
            variant="outline"
            class="chatluna-studio-model-request-more"
            :disabled="loading || nextCursor === undefined"
            @click="loadMore"
          >
            加载更多
          </Button>
        </div>
      </section>

      <section class="chatluna-studio-model-request-detail-pane" aria-label="模型请求详情">
        <div v-if="detailLoading && !detail" class="chatluna-studio-model-request-empty">正在读取请求详情…</div>
        <div v-else-if="!detail" class="chatluna-studio-model-request-empty">选择一条记录查看请求体和响应体</div>
        <article v-else ref="detailElement" v-chatluna-studio-scrollbar class="chatluna-studio-model-request-detail" :class="{ 'has-sticky-trajectory': detailView === 'trajectory' || bodyView === 'analysis', 'is-trajectory-view': detailView === 'trajectory' }">
          <header>
            <div class="chatluna-studio-model-request-item-title">
              <span class="chatluna-studio-model-request-bot">
                <ModelRequestAvatar
                  :unattributed="resolveRequestBot(detail).unattributed"
                  :name="resolveRequestBot(detail).name"
                  :avatar="resolveRequestBot(detail).avatar"
                />
                <span class="chatluna-studio-model-request-bot-copy">
                  <span class="chatluna-studio-model-request-bot-name">
                    <strong>{{ resolveRequestBot(detail).name }}</strong>
                  </span>
                  <span class="chatluna-studio-model-request-timing">
                    <time>
                      <IconCalendarTime :size="14" aria-hidden="true" />
                      {{ formatStudioDateTime(detail.createdAt) }}
                    </time>
                  </span>
                </span>
              </span>
            </div>
            <div class="chatluna-studio-model-request-detail-nav">
              <section class="chatluna-studio-model-request-view-switch" aria-label="详情显示方式">
                <Button
                  size="sm"
                  :variant="detailView === 'evidence' ? 'secondary' : 'ghost'"
                  @click="detailView = 'evidence'"
                >
                  <IconFileCode data-icon="inline-start" aria-hidden="true" />
                  请求
                </Button>
                <Button
                  size="sm"
                  :variant="detailView === 'trajectory' ? 'secondary' : 'ghost'"
                  @click="detailView = 'trajectory'"
                >
                  <IconTimelineEvent data-icon="inline-start" aria-hidden="true" />
                  轨迹
                </Button>
              </section>
            </div>
          </header>

          <ModelRequestTrajectory
            v-if="detailView === 'trajectory'"
            :trajectory="conversationTrajectory"
            :detail="detail"
            mode="conversation"
            :show-mode-switch="false"
            :loading="detailLoading || trajectory?.mode !== 'conversation'"
            :conversation-available="Boolean(detail.entities.conversationId)"
            :navigation="navigation"
            :restore-state="navigation.viewRestore.value"
            @open-request="openRelatedRequest"
            @inspect-request="inspectRelatedRequest"
            @update:expanded-request-ids="updateExpandedTrajectoryRequests"
          />
          <template v-else>
          <section class="chatluna-studio-model-request-overview" aria-label="请求概览">
            <header class="chatluna-studio-model-request-section-heading">
              <span>
                <IconLayoutGrid :size="17" aria-hidden="true" />
                <strong>概览</strong>
              </span>
              <Badge :class="statusClass(detail.status)">
                {{ statusLabel(detail.status) }}
              </Badge>
            </header>
            <div class="chatluna-studio-model-request-overview-grid">
              <article>
                <IconRoute :size="17" aria-hidden="true" />
                <span>来源</span>
                <strong>{{ formatModelRequestSource(detail) }}</strong>
              </article>
              <article>
                <IconCpu :size="17" aria-hidden="true" />
                <span>模型 ID</span>
                <strong>{{ formatModelRequestModelName(detail.model) }}</strong>
              </article>
              <article>
                <IconClock :size="17" aria-hidden="true" />
                <span>耗时</span>
                <strong>{{ formatDuration(detail.durationMs) }}</strong>
              </article>
              <article>
                <IconBraces :size="17" aria-hidden="true" />
                <span>字段</span>
                <strong>{{ formatModelRequestCount(detail.requestBodyKeyCount) }}</strong>
              </article>
              <article>
                <IconMessages :size="17" aria-hidden="true" />
                <span>消息</span>
                <strong>{{ formatModelRequestCount(detail.evidenceCounts?.requestMessageCount) }}</strong>
              </article>
              <article>
                <IconTools :size="17" aria-hidden="true" />
                <span>工具</span>
                <strong>{{ formatModelRequestCount(detail.evidenceCounts?.toolDefinitionCount) }}</strong>
              </article>
            </div>
          </section>
          <section class="chatluna-studio-model-request-usage" aria-label="Token 用量">
            <header class="chatluna-studio-model-request-section-heading">
              <span>
                <IconChartBar :size="17" aria-hidden="true" />
                <strong>用量</strong>
              </span>
            </header>
            <div class="chatluna-studio-model-request-usage-grid">
              <article v-for="item in usageItems" :key="item.label">
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
              </article>
            </div>
          </section>
          <div class="chatluna-studio-model-request-meta-list">
            <p v-if="detail.method || detail.url" class="chatluna-studio-model-request-meta">
              <IconWorld :size="17" aria-hidden="true" />
              <span class="chatluna-studio-model-request-meta-label">请求地址</span>
              <span class="chatluna-studio-model-request-meta-value chatluna-studio-model-request-endpoint">
                <strong v-if="detail.method">{{ detail.method }}</strong>
                <span v-if="detail.url">{{ detail.url }}</span>
              </span>
            </p>
            <p class="chatluna-studio-model-request-meta">
              <IconTopologyStar3 :size="17" aria-hidden="true" />
              <span class="chatluna-studio-model-request-meta-label">关联实体</span>
              <span
                v-if="entityChips.length"
                class="chatluna-studio-model-request-meta-value chatluna-studio-model-request-entities"
              >
                <span
                  v-for="chip in entityChips"
                  :key="chip.key"
                  class="chatluna-studio-model-request-entity"
                >
                  <strong>{{ chip.label }}</strong>
                  <span class="chatluna-studio-model-request-entity-value">{{ chip.value }}</span>
                </span>
              </span>
              <span v-else class="chatluna-studio-model-request-meta-value">无关联实体</span>
            </p>
            <div v-if="detail.headers && Object.keys(detail.headers).length" class="chatluna-studio-model-request-meta chatluna-studio-model-request-headers">
              <IconBraces :size="17" aria-hidden="true" />
              <span class="chatluna-studio-model-request-meta-label">请求头</span>
              <div class="chatluna-studio-model-request-header-value">
                <Button
                  size="xs"
                  variant="ghost"
                  class="chatluna-studio-model-request-header-toggle"
                  :aria-expanded="headersExpanded"
                  @click="toggleHeaders"
                >
                  {{ modelRequestHeadersToggleLabel(headersExpanded, Object.keys(detail.headers).length) }}
                  <IconChevronDown :size="14" :class="{ 'is-expanded': headersExpanded }" aria-hidden="true" />
                </Button>
                <div v-if="headersExpanded" class="chatluna-studio-model-request-header-json">
                  <div class="chatluna-studio-model-request-json-viewer">
                    <ModelRequestJsonTree
                      :node="headersTree"
                      :open="true"
                      :root="true"
                      :strings-expanded="true"
                    />
                  </div>
                </div>
              </div>
            </div>

            <p v-if="detail.interactionId" class="chatluna-studio-model-request-meta">
              <IconFingerprint :size="17" aria-hidden="true" />
              <span class="chatluna-studio-model-request-meta-label">交互标识</span>
              <span class="chatluna-studio-model-request-meta-value">{{ detail.interactionId }}</span>
            </p>
          </div>
          <section v-if="detail.status === 'error'" class="chatluna-studio-model-request-error-diagnostic" aria-label="错误诊断">
            <header class="chatluna-studio-model-request-section-heading">
              <span>
                <IconAlertCircle :size="17" aria-hidden="true" />
                <strong>错误诊断</strong>
              </span>
              <a
                v-if="detail.chatlunaError"
                :href="CHATLUNA_ERROR_CODE_DOCUMENTATION_URL"
                target="_blank"
                rel="noreferrer"
              >
                ChatLuna 错误码文档
              </a>
            </header>
            <dl class="chatluna-studio-model-request-error-details">
              <template v-if="detail.chatlunaError?.code !== undefined">
                <dt class="chatluna-studio-model-request-error-code-label">错误码</dt>
                <dd>
                  <Badge class="chatluna-studio-model-request-status-error chatluna-studio-model-request-error-code">
                    {{ detail.chatlunaError.code }}
                  </Badge>
                </dd>
              </template>
              <template v-if="detail.chatlunaError?.message">
                <dt>报错</dt>
                <dd>{{ detail.chatlunaError.message }}</dd>
              </template>
              <template v-if="detail.chatlunaError?.originMessage">
                <dt>原始原因</dt>
                <dd>{{ detail.chatlunaError.originMessage }}</dd>
              </template>
              <template v-if="detail.error">
                <dt>请求采集</dt>
                <dd class="chatluna-studio-model-request-capture-error">
                  <Badge class="chatluna-studio-model-request-status-error chatluna-studio-model-request-error-code">
                    {{ detail.error.message }}
                  </Badge>
                  <span class="chatluna-studio-model-request-error-trace">trace {{ detail.error.traceId }}</span>
                </dd>
              </template>
              <template v-if="chatlunaErrorCauses.length">
                <dt>可能的原因</dt>
                <dd>
                  <ul class="chatluna-studio-model-request-error-causes">
                    <li v-for="cause in chatlunaErrorCauses" :key="cause">{{ cause }}</li>
                  </ul>
                </dd>
              </template>
            </dl>
            <p v-if="detail.chatlunaError && !chatlunaErrorCauses.length" class="chatluna-studio-model-request-error-note">
              ChatLuna 文档没有为该错误码列出更具体的原因，请结合原始原因和响应原文排查。
            </p>
          </section>
          <section class="chatluna-studio-model-request-body">
            <div class="chatluna-studio-model-request-body-header">
              <div class="chatluna-studio-model-request-body-tabs" role="tablist" aria-label="模型请求内容">
                <Button
                  size="sm"
                  :variant="bodyView === 'analysis' ? 'secondary' : 'ghost'"
                  role="tab"
                  :aria-selected="bodyView === 'analysis'"
                  @click="bodyView = 'analysis'"
                >
                  分析
                </Button>
                <Button
                  size="sm"
                  :variant="bodyView === 'request' ? 'secondary' : 'ghost'"
                  role="tab"
                  :aria-selected="bodyView === 'request'"
                  @click="bodyView = 'request'"
                >
                  请求
                </Button>
                <Button
                  size="sm"
                  :variant="bodyView === 'response' ? 'secondary' : 'ghost'"
                  role="tab"
                  :aria-selected="bodyView === 'response'"
                  @click="bodyView = 'response'"
                >
                  响应
                </Button>
              </div>
              <div v-if="bodyView !== 'analysis'" class="chatluna-studio-model-request-body-actions">
                <div
                  v-if="bodyView === 'response' && detail.responseBodyStatus === 'complete'"
                  class="chatluna-studio-model-request-response-tabs"
                  role="tablist"
                  aria-label="响应体显示方式"
                >
                  <Button
                    size="xs"
                    :variant="responseView === 'content' ? 'secondary' : 'ghost'"
                    role="tab"
                    :aria-selected="responseView === 'content'"
                    @click="responseView = 'content'"
                  >
                    内容预览
                  </Button>
                  <Button
                    size="xs"
                    :variant="responseView === 'json' ? 'secondary' : 'ghost'"
                    role="tab"
                    :aria-selected="responseView === 'json'"
                    @click="responseView = 'json'"
                  >
                    {{ detail.responseBodyFormat === 'sse' ? '事件原文' : 'JSON 原文' }}
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="!currentBodyText"
                  @click="copyCurrentBody"
                >
                  <IconCopy :size="16" aria-hidden="true" />
                  {{ copyState === 'success' ? '已复制' : copyState === 'error' ? '复制失败' : '复制' }}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="!currentBodyText"
                  @click="downloadCurrentBody"
                >
                  <IconDownload :size="16" aria-hidden="true" />
                  下载
                </Button>
              </div>
            </div>

            <template v-if="bodyView === 'request'">
              <p v-if="!detail.requestBodyAvailable || detail.requestBody === undefined" class="chatluna-studio-model-request-empty">
                请求体不可用
              </p>
              <div v-else class="chatluna-studio-model-request-json-viewer">
                <ModelRequestJsonTree
                  :node="requestTree"
                  :open="true"
                  :root="true"
                  :strings-expanded="true"
                  :images-preview="true"
                />
              </div>
            </template>

            <ModelRequestTrajectory
              v-else-if="bodyView === 'analysis'"
              class="chatluna-studio-model-request-analysis"
              :trajectory="requestTrajectory"
              mode="request"
              :show-mode-switch="false"
              :loading="detailLoading || trajectory?.mode !== 'request'"
              :conversation-available="false"
              :analysis="true"
              :detail="detail"
              :navigation="navigation"
              :external-locate="navigation.locateRequest.value"
              @open-request="openRelatedRequest"
              @locate-result="completeNavigationLocate"
            />

            <template v-else>
              <p class="chatluna-studio-model-request-response-meta">{{ responseBodyLabel }}</p>
              <p v-if="detail.responseBodyStatus === 'pending'" class="chatluna-studio-model-request-empty">
                正在采集响应体…
              </p>
              <p v-else-if="detail.responseBodyStatus === 'error'" class="chatluna-studio-model-request-error">
                响应体采集失败{{ detail.responseBodyError ? `：${detail.responseBodyError}` : '' }}
              </p>
              <p v-else-if="detail.responseBodyStatus !== 'complete'" class="chatluna-studio-model-request-empty">
                响应体不可用
              </p>
              <ModelResponseContentPreview
                v-else-if="responseView === 'content'"
                :response="responseConversation"
              />
              <template v-else>
                <div v-if="responseConversation.raw !== undefined && typeof responseConversation.raw !== 'string'" class="chatluna-studio-model-request-json-viewer">
                  <ModelRequestJsonTree
                    :node="responseTree"
                    :open="true"
                    :root="true"
                    :strings-expanded="true"
                  />
                </div>
                <pre v-else-if="detail.responseBodyRaw" class="chatluna-studio-model-request-response-raw">{{ detail.responseBodyRaw }}</pre>
                <p v-else class="chatluna-studio-model-request-empty">响应体为空</p>
              </template>
            </template>
          </section>
          </template>
        </article>
      </section>
    </div>

    <Dialog v-model:open="clearDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ clearStep === 1 ? '清理未归属记录' : '再次确认清理' }}</DialogTitle>
          <DialogDescription>
            {{ clearStep === 1
              ? '将清理全部未归属模型请求记录，此操作不可恢复。'
              : '再次确认后才会清空未归属分类中的模型请求记录。' }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="cancelClear">取消</Button>
          <Button v-if="clearStep === 1" variant="destructive" @click="advanceClear">继续</Button>
          <Button v-else variant="destructive" :disabled="loading" @click="confirmClear">确认清理</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </main>
</template>

<script setup lang="ts">
import {
  IconAlertCircle,
  IconArrowLeft,
  IconBraces,
  IconCalendarTime,
  IconChartBar,
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconCpu,
  IconCopy,
  IconDownload,
  IconFileCode,
  IconFilter,
  IconFingerprint,
  IconLayoutGrid,
  IconMessages,
  IconRefresh,
  IconRoute,
  IconTools,
  IconTimelineEvent,
  IconTopologyStar3,
  IconTrash,
  IconWorld,
} from '@tabler/icons-vue'
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Badge } from '#client/components/ui/badge'
import { Button } from '#client/components/ui/button'
import { Checkbox } from '#client/components/ui/checkbox'
import { Switch } from '#client/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#client/components/ui/dialog'
import { Input } from '#client/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '#client/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '#client/components/ui/tooltip'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#client/components/ui/select'
import ModelRequestJsonTree from './json-tree.vue'
import ModelRequestTrajectory from './trajectory.vue'
import ModelResponseContentPreview from './response-content-preview.vue'
import ModelRequestAvatar from './request-avatar.vue'
import {
  formatConversationLabel,
  resolveBotIdentity,
  type StudioIdentityDisplay,
} from '#client/shared/qq-identity'
import { CHATLUNA_ERROR_CODE_DOCUMENTATION_URL, getChatLunaErrorPossibleCauses } from '../../src/chatluna/error'
import { formatBytes } from '#client/shared/format-bytes'
import { formatDuration } from '#client/shared/format-duration'
import { formatStudioDateTime } from '#client/shared/format-time'
import {
  buildModelRequestEntityChips,
  buildModelRequestUsageCells,
  formatModelRequestCount,
  formatModelRequestSource,
  formatModelRequestModelName,
} from './overview'
import {
  createModelRequestDetailView,
  modelRequestHeadersToggleLabel,
} from './detail-view'
import {
  buildModelRequestBodyDownload,
  createModelRequestBodyCopy,
  resolveModelRequestBodyText,
} from './body-transfer'
import { createModelRequestClearConfirm } from './clear-confirm'
import { parseModelResponseConversation } from './conversation'
import { buildModelRequestJsonTree } from './json'
import type { EvidenceNavigation } from '#client/shared/evidence-navigation'
import { createScrollRestore } from '#client/shared/scroll-restore'
import {
  createModelRequestEnterRefresh,
  createModelRequestLiveRefresh,
  hasPendingModelRequest,
  resolveModelRequestRefreshLimit,
  shouldPollModelRequests,
} from './live-refresh'
import {
  beginModelRequestListNavigation,
  clearModelRequestListSelection,
  resolveModelRequestListRecords,
  restoreModelRequestListSelection,
  selectModelRequestListRecord,
  type ModelRequestListSelectionState,
} from './list-selection'
import {
  createModelRequestRecordsQuery,
  MODEL_REQUEST_PAGE_SIZE,
  type ModelRequestCategory,
  type ModelRequestRecordQuery,
  type ModelRequestRecordsQuery,
  type ModelRequestTrajectoryQuery,
} from './query'
import { vChatlunaStudioScrollbar } from '#client/shared/scrollbar'
import type {
  StudioModelRequestCapacity,
  StudioModelRequestDetail,
  StudioModelRequestFacets,
  StudioModelRequestListItem,
  StudioModelRequestStatus,
  StudioModelRequestTrajectory,
  StudioModelRequestUsage,
} from '../../src/types'

const props = defineProps<{
  records: readonly StudioModelRequestListItem[]
  detail?: StudioModelRequestDetail
  trajectory?: StudioModelRequestTrajectory
  facets: StudioModelRequestFacets
  useQQAvatars: boolean
  hasMore: boolean
  capacity: StudioModelRequestCapacity
  nextCursor?: number
  nextCreatedAt?: string
  nextId?: string
  loading: boolean
  detailLoading: boolean
  error: string
  visitKey?: number
  navigation: EvidenceNavigation
}>()

const emit = defineEmits<{
  query: [input: ModelRequestRecordsQuery]
  loadMore: [input: ModelRequestRecordsQuery]
  open: [input: ModelRequestRecordQuery]
  trajectory: [input: ModelRequestTrajectoryQuery]
  clear: []
  navigationFailure: [message: string]
  returnToPreset: []
}>()

const category = ref<ModelRequestCategory>('all')
const botId = ref('')
const conversationId = ref('')
/**
 * 「不限」项在下拉里必须带一个非空值。
 *
 * reka-ui 的 SelectItem 收到空串会直接 throw（空串被它保留给「清空选择、显示 placeholder」），
 * 而这一步发生在 Popover 内容挂载途中：异常会打断挂载，浮层停在 reka-ui 定位前的
 * `translate(0, -200%)` 初始位置——面板其实开着，只是整块落在视口上方看不见，表现为点筛选没反应。
 * 因此下拉层用哨兵值，筛选状态本身仍以空串表示「不限」。
 */
const ANY_FILTER_VALUE = '__any__'
const botSelection = computed({
  get: () => botId.value || ANY_FILTER_VALUE,
  set: (value: string) => { botId.value = value === ANY_FILTER_VALUE ? '' : value },
})
const conversationSelection = computed({
  get: () => conversationId.value || ANY_FILTER_VALUE,
  set: (value: string) => { conversationId.value = value === ANY_FILTER_VALUE ? '' : value },
})
const model = ref('')
const errorsOnly = ref(false)
const sortOrder = ref<'asc' | 'desc'>('desc')
const filterOpen = ref(false)
const filterSelectPortalTarget = ref<HTMLElement>()
const liveRefresh = ref(false)
const selectionState = ref<ModelRequestListSelectionState>({ selectedRecordId: '' })
const selectedRecordId = computed({
  get: () => selectionState.value.selectedRecordId,
  set: (value: string) => { selectionState.value.selectedRecordId = value },
})
const {
  detailView,
  bodyView,
  responseView,
  headersExpanded,
  expandedTrajectoryRequestIds,
  trajectoryMode,
  showNewDetail,
  showEvidenceAnalysis,
  showRequestBody,
  expandTrajectoryRequestByDefault,
  snapshot: detailViewSnapshot,
  restore: restoreDetailView,
  toggleHeaders,
} = createModelRequestDetailView()
const {
  open: clearDialogOpen,
  step: clearStep,
  begin: openClearDialog,
  advance: advanceClear,
  cancel: cancelClear,
  confirm: confirmClear,
} = createModelRequestClearConfirm({
  clear: () => {
    emit('clear')
    selectedRecordId.value = ''
  },
})
const navigationStatus = ref('')
const conversationTrajectory = computed(() => props.trajectory?.mode === 'conversation' ? props.trajectory : undefined)
const requestTrajectory = computed(() => props.trajectory?.mode === 'request' ? props.trajectory : undefined)
const displayRecords = computed(() => resolveModelRequestListRecords(
  selectionState.value,
  props.records,
  props.detail,
))
// 选中机器人后会话下拉只留它的会话：跨机器人的会话组合选出来一定是空列表。
const selectableConversations = computed(() => (botId.value
  ? props.facets.conversations.filter((conversation) => conversation.botId === botId.value)
  : props.facets.conversations))
/**
 * 容量水位。条数与体积是两道各自独立的上限，任一超出即从最旧记录开始丢弃，
 * 因此两道各占一环：只看条数会把「体积先到上限」误判成条数上限失效。
 */
const capacityGauge = computed(() => {
  const { recordCount, totalBytes, maxRecords, maxBytes } = props.capacity
  // 满环封顶：超出上限的瞬间就会触发回收，画超过一整圈只会让弧长绕回去。
  const recordRatio = maxRecords > 0 ? Math.min(1, recordCount / maxRecords) : 0
  const byteRatio = maxBytes > 0 ? Math.min(1, totalBytes / maxBytes) : 0
  const recordCircumference = 2 * Math.PI * 9
  const byteCircumference = 2 * Math.PI * 13
  // 达到九成即视为逼近上限：回收发生在超出的那一刻，等到 100% 再提示就已经丢过记录了。
  const recordNearLimit = recordRatio >= 0.9
  const byteNearLimit = byteRatio >= 0.9
  const byteUsed = formatBytes(totalBytes)
  const byteMax = formatBytes(maxBytes)
  const recordUsed = formatModelRequestCount(recordCount)
  const recordMax = formatModelRequestCount(maxRecords)
  return {
    byteUsed,
    byteMax,
    recordUsed,
    recordMax,
    recordNearLimit,
    byteNearLimit,
    nearLimit: recordNearLimit || byteNearLimit,
    recordCircumference: recordCircumference.toFixed(2),
    byteCircumference: byteCircumference.toFixed(2),
    recordArc: (recordCircumference * recordRatio).toFixed(2),
    byteArc: (byteCircumference * byteRatio).toFixed(2),
    ariaLabel: `记录容量：体积 ${byteUsed} / ${byteMax}，条数 ${recordUsed} / ${recordMax}`,
  }
})
const { state: copyState, copy: copyBody, reset: resetCopyState } = createModelRequestBodyCopy({
  clipboardWriter: () => {
    const clipboard = navigator.clipboard
    return clipboard?.writeText ? (text: string) => clipboard.writeText(text) : undefined
  },
  fallbackWrite: copyTextForHttp,
})
const detailElement = ref<HTMLElement>()
// 返回按钮的存在、文案与去向都由导航 module 的 returnTarget 单点派生，不再各自判断一次。
const returnLabel = computed(() => {
  const target = props.navigation.returnTarget.value
  if (target === 'view') return '返回轨迹'
  return target === 'presets' ? '返回预设' : ''
})
// 返回时正文子树会被页签切换与异步数据重建，重建会把详情面板的 scrollTop 清零；
// scroll-restore 负责在有界帧窗口内把位置按回目标，单写一次一定会被后续重建抹掉。
const detailScrollRestore = createScrollRestore({
  measure: () => {
    const element = detailElement.value
    if (!element) return undefined
    return { scrollTop: element.scrollTop, maxScrollTop: element.scrollHeight - element.clientHeight }
  },
  scrollTo: (top) => {
    if (detailElement.value) detailElement.value.scrollTop = top
  },
  nextTick,
  frame: () => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve())
  }),
})
let inspectRecordId: string | undefined

const hasPendingRequest = computed(() => hasPendingModelRequest(props.records, props.detail))
const liveRefreshController = createModelRequestLiveRefresh({
  isEnabled: () => shouldPollModelRequests({
    manualSwitch: liveRefresh.value,
    hasPendingRequest: hasPendingRequest.value,
  }),
  isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
  refresh: () => refresh(resolveModelRequestRefreshLimit(props.records.length, MODEL_REQUEST_PAGE_SIZE)),
})
const enterRefresh = createModelRequestEnterRefresh(() => refresh())

const requestTree = computed(() => buildModelRequestJsonTree(props.detail?.requestBody, 'requestBody'))
const headersTree = computed(() => buildModelRequestJsonTree(props.detail?.headers ?? {}, 'requestHeaders'))
// 响应预览、原文树和用量候选都来自同一份共享模型证据投影，不再各自扫描响应体。
const responseConversation = computed(() => parseModelResponseConversation({
  responseBodyStatus: props.detail?.responseBodyStatus ?? 'unavailable',
  ...(props.detail?.responseBodyRaw !== undefined ? { responseBodyRaw: props.detail.responseBodyRaw } : {}),
  ...(props.detail?.responseBodyFormat ? { responseBodyFormat: props.detail.responseBodyFormat } : {}),
  ...(props.detail?.responseBodyError ? { responseBodyError: props.detail.responseBodyError } : {}),
  ...(props.detail?.usage ? { usage: props.detail.usage } : {}),
}))
const responseTree = computed(() => buildModelRequestJsonTree(responseConversation.value.raw, 'responseBody'))
// ADR-0059 的优先级已经在响应投影 adapter 里应用过：标准化 ChatLuna 用量优先于响应体候选。
const usage = computed<StudioModelRequestUsage | undefined>(() => responseConversation.value.usage)
const chatlunaErrorCauses = computed(() => getChatLunaErrorPossibleCauses(props.detail?.chatlunaError))
const usageItems = computed(() => buildModelRequestUsageCells(usage.value))
const entityChips = computed(() => buildModelRequestEntityChips(props.detail?.entities ?? {}))
const currentBodyText = computed(() => resolveModelRequestBodyText(props.detail, bodyView.value))
const responseBodyLabel = computed(() => {
  const detail = props.detail
  if (!detail) return ''
  const parts = [
    detail.responseStatus !== undefined ? `HTTP ${detail.responseStatus}` : undefined,
    detail.responseBodyFormat?.toUpperCase(),
  ].filter(Boolean)
  return parts.join(' · ') || '响应体'
})
const filtersActive = computed(() => Boolean(
  category.value !== 'all'
  || botId.value
  || conversationId.value
  || model.value.trim()
  || errorsOnly.value,
))
const filterSummary = computed(() => {
  const parts = [categoryLabel(category.value)]
  const bot = props.facets.bots.find(({ id }) => id === botId.value)
  if (bot) parts.push(bot.name || bot.id)
  const conversation = props.facets.conversations.find(({ id }) => id === conversationId.value)
  if (conversation) parts.push(conversation.name || conversation.id)
  if (model.value.trim()) parts.push(model.value.trim())
  if (errorsOnly.value) parts.push('仅错误')
  return parts.join(' · ')
})

// 换机器人后旧会话不再属于它；留着会让列表筛成空且下拉显示一个不存在的选项。
watch(botId, () => {
  if (conversationId.value && !selectableConversations.value.some(({ id }) => id === conversationId.value)) {
    conversationId.value = ''
  }
})

watch([category, botId, conversationId, errorsOnly, sortOrder], () => {
  // 统一进入状态本身声明「这是一次导航选中」；令牌由导航 module 持有，消费一次后失效。
  if (!props.navigation.preserveSelectionOnFilterChange()) {
    clearModelRequestListSelection(selectionState.value)
  }
  refresh()
})

watch(filterOpen, (open, wasOpen) => {
  if (wasOpen && !open) refresh()
})

watch(() => props.detail?.id, () => {
  if (inspectRecordId && props.detail?.id === inspectRecordId) {
    inspectRecordId = undefined
    return
  }
  inspectRecordId = undefined
  showNewDetail()
  restoreSelectionOnEnter()
  applyViewRestore()
  if (props.detail) fetchTrajectory(trajectoryMode.value)
  resetCopyState()
})

watch(detailView, () => {
  // 进入会话账本时播种默认展开的那一条；已有展开清单（例如从原始请求返回）时不动它。
  if (detailView.value === 'trajectory' && props.detail) expandTrajectoryRequestByDefault(props.detail.id)
  fetchTrajectory(trajectoryMode.value)
})

watch(bodyView, resetCopyState)
watch([liveRefresh, hasPendingRequest], () => liveRefreshController.sync(), { immediate: true })
watch(() => props.visitKey, () => {
  enterRefresh.schedule()
})

watch(() => props.navigation.entryState.value?.seq, () => {
  applyEntryState()
}, { immediate: true })

watch([() => props.detail?.id, () => props.trajectory], () => {
  arriveAtNavigationTarget()
})

/**
 * 应用导航 module 交出的进入状态。
 *
 * 预设跳转进来时把范围收到「已归属」并清掉机器人与会话筛选：目标记录一定有归属，而当前筛选
 * 未必包含它那个会话，不清掉的话列表里根本没有可高亮的行。
 */
function applyEntryState() {
  const state = props.navigation.entryState.value
  if (!state) return
  props.navigation.resetLocate()
  navigationStatus.value = state.status
  // 筛选侦听器只在这些值真的变化时触发；没变化时保护必须当场失效，
  // 否则它会留到下一次用户主动改筛选，把那一次的清空也误挡掉。
  const filtersChanged = category.value !== state.category
    || Boolean(botId.value)
    || Boolean(conversationId.value)
    || errorsOnly.value !== state.errorsOnly
  category.value = state.category
  botId.value = ''
  conversationId.value = ''
  model.value = state.model
  errorsOnly.value = state.errorsOnly
  beginModelRequestListNavigation(selectionState.value, state.recordId)
  restoreDetailView(state)
  emit('query', createModelRequestRecordsQuery(state.category, { order: sortOrder.value }))
  emit('open', { recordId: state.recordId })
  emit('trajectory', trajectoryQuery(state.recordId, 'request'))
  props.navigation.applyEntry(state.seq, filtersChanged)
  arriveAtNavigationTarget()
}

function arriveAtNavigationTarget() {
  if (!props.navigation.arrive(props.detail, props.trajectory)) return
  showEvidenceAnalysis()
}

function completeNavigationLocate(result: { seq: number, located: boolean }) {
  const acknowledged = props.navigation.acknowledgeLocate(result.seq, result.located)
  if (!acknowledged) return
  navigationStatus.value = result.located ? '已定位到预设表达式对应的精确文本。' : ''
  if (!result.located) {
    emit('navigationFailure', '已打开匹配的模型请求，但无法定位精确文本标记。')
  }
}

/** 当前筛选。范围与三个筛选值都由这里统一给出，翻页与刷新不各自拼一遍。 */
function currentFilters() {
  return {
    botId: botId.value || undefined,
    conversationId: conversationId.value || undefined,
    model: model.value.trim() || undefined,
    errorsOnly: errorsOnly.value || undefined,
    order: sortOrder.value,
  }
}

function emitQuery(limit = MODEL_REQUEST_PAGE_SIZE) {
  emit('query', createModelRequestRecordsQuery(category.value, { ...currentFilters(), limit }))
}

function refresh(limit = MODEL_REQUEST_PAGE_SIZE) {
  emitQuery(limit)
  if (selectedRecordId.value) {
    emit('open', { recordId: selectedRecordId.value })
    // 同一条记录从进行中变为已完成时 id 不变，不能只靠详情 id watcher 重拉轨迹。
    emit('trajectory', trajectoryQuery(selectedRecordId.value, trajectoryMode.value))
  }
}

function loadMore() {
  if (props.nextCursor === undefined) return
  emit('loadMore', createModelRequestRecordsQuery(category.value, {
    ...currentFilters(),
    beforeSequence: props.nextCursor,
  }))
}

function toggleSortOrder() {
  sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
}

function openRecord(recordId: string) {
  selectModelRequestListRecord(selectionState.value, recordId)
  inspectRecordId = undefined
  props.navigation.selectOtherRecord()
  emit('open', { recordId })
  emit('trajectory', trajectoryQuery(recordId, trajectoryMode.value))
}

/**
 * 一次轨迹读取的完整参数。
 *
 * 六个发起点全部经由这里取参：会话账本的事件行是按已展开清单向服务端取的，
 * 漏掉其中一个发起点不会报错，只会表现为「自动刷新一到就把展开的请求收回去」。
 */
function trajectoryQuery(
  recordId: string,
  mode: 'request' | 'conversation',
): ModelRequestTrajectoryQuery {
  return {
    recordId,
    mode,
    ...(mode === 'conversation' ? { expandedRequestIds: [...expandedTrajectoryRequestIds.value] } : {}),
  }
}

function updateExpandedTrajectoryRequests(requestIds: string[]) {
  expandedTrajectoryRequestIds.value = requestIds
  fetchTrajectory(trajectoryMode.value)
}

function fetchTrajectory(mode: 'request' | 'conversation') {
  const detail = props.detail
  if (!detail) return
  emit('trajectory', trajectoryQuery(detail.id, mode))
}

function inspectRelatedRequest(payload: { recordId: string }) {
  if (props.detail?.id === payload.recordId) return
  // 轨迹检查器点到同会话另一条请求时，只换详情喂分析卡片，不离开轨迹、不重拉账本。
  inspectRecordId = payload.recordId
  selectedRecordId.value = payload.recordId
  emit('open', { recordId: payload.recordId })
}

function openRelatedRequest(payload: {
  recordId: string
  returnState: {
    rowId: string
    scrollTop: number
  }
}) {
  inspectRecordId = undefined
  props.navigation.pushViewSnapshot({
    recordId: selectedRecordId.value,
    ...detailViewSnapshot(),
    trajectoryMode: trajectoryMode.value,
    detailScrollTop: detailElement.value?.scrollTop ?? 0,
    trajectory: payload.returnState,
  })
  showRequestBody()
  selectedRecordId.value = payload.recordId
  emit('open', { recordId: payload.recordId })
  emit('trajectory', trajectoryQuery(payload.recordId, 'request'))
  nextTick(() => {
    if (detailElement.value) detailElement.value.scrollTop = 0
  })
}

function returnFromDetail() {
  if (props.navigation.returnTarget.value === 'view') return returnToTrajectory()
  emit('returnToPreset')
}

function returnToTrajectory() {
  const state = props.navigation.beginViewReturn()
  if (!state) return
  selectedRecordId.value = state.recordId
  restoreDetailView(state)
  emit('open', { recordId: state.recordId })
  emit('trajectory', trajectoryQuery(state.recordId, state.trajectoryMode))
  applyViewRestore()
}

function applyViewRestore() {
  const state = props.navigation.takeViewRestore(props.detail?.id)
  if (!state) return
  // 跨请求返回时 detail.id watcher 会先把页签重置到“分析”；目标详情真正到达后，
  // 必须连同轨迹和滚动位置再次恢复视图快照，否则同请求测试通过但跨请求仍会落回分析页。
  restoreDetailView(state)
  void detailScrollRestore.restore(state.detailScrollTop)
}

function resetFilters() {
  category.value = 'all'
  botId.value = ''
  conversationId.value = ''
  model.value = ''
  errorsOnly.value = false
}

function categoryLabel(value: ModelRequestCategory) {
  if (value === 'unattributed') return '未归属'
  if (value === 'attributed') return '已归属会话'
  return '全部记录'
}

/**
 * 一条请求显示成谁：名字与头像由会话身份模块从记录自带的实体派生。
 *
 * `unattributed` 取记录的归属判定结果而不是「有没有 botId」：归属口径归采集器所有，
 * 视图再推一遍就会出现两份判据，采集端改了归属规则这里不会跟着变。
 */
function resolveRequestBot(
  record: StudioModelRequestListItem | StudioModelRequestDetail,
): StudioIdentityDisplay & { unattributed: boolean } {
  return {
    ...resolveBotIdentity(record.entities, { useQQAvatars: props.useQQAvatars }),
    unattributed: record.attribution === 'unattributed',
  }
}

function statusLabel(status: StudioModelRequestStatus) {
  if (status === 'error') return '错误'
  if (status === 'pending') return '进行中'
  return '已完成'
}

function statusClass(status: StudioModelRequestStatus) {
  if (status === 'error') return 'chatluna-studio-model-request-status-error'
  if (status === 'pending') return 'chatluna-studio-model-request-status-pending'
  return 'chatluna-studio-model-request-complete'
}

function copyCurrentBody() {
  void copyBody(currentBodyText.value)
}

/** 降级路径的 DOM 机械动作：选中一个离屏 textarea 再让浏览器执行复制命令。 */
function copyTextForHttp(text: string) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  Object.assign(textarea.style, {
    position: 'fixed',
    top: '0',
    left: '-9999px',
    opacity: '0',
  })
  document.body.append(textarea)
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('浏览器拒绝复制')
}

function downloadCurrentBody() {
  const download = buildModelRequestBodyDownload(props.detail, bodyView.value)
  if (!download) return
  const url = URL.createObjectURL(new Blob([download.text], { type: download.mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = download.fileName
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function onVisibilityChange() {
  liveRefreshController.sync()
}

function restoreSelectionOnEnter() {
  // 页面切换会销毁工作台组件，但工作区控制器会保留详情；普通返回没有 entryState，
  // 因此需要用这份权威详情恢复左侧选中态。导航进入时已有选择则不覆盖目标。
  if (selectedRecordId.value || props.navigation.entryState.value) return
  restoreModelRequestListSelection(selectionState.value, props.detail)
}

onMounted(() => {
  restoreSelectionOnEnter()
  document.addEventListener('visibilitychange', onVisibilityChange)
  enterRefresh.schedule()
})

onActivated(() => {
  restoreSelectionOnEnter()
  enterRefresh.schedule()
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  liveRefreshController.dispose()
  resetCopyState()
})
</script>
