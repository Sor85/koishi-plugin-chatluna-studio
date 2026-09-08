<template>
  <section class="chatluna-studio-model-analysis" :class="{ 'is-inspector': layout === 'inspector' }" aria-label="模型请求分析">
    <div class="chatluna-studio-model-analysis-main">
      <aside v-if="layout !== 'inspector'" ref="navigationElement" class="chatluna-studio-model-analysis-nav" aria-label="分析导航">
        <button
          type="button"
          class="chatluna-studio-model-analysis-boundary"
          :class="`is-${navigation.boundary.status}`"
          @click="jumpTo(navigation.boundary.target)"
        >
          <span class="chatluna-studio-model-analysis-boundary-title">
            <span class="chatluna-studio-model-analysis-boundary-dot" aria-hidden="true" />
            <strong>{{ navigation.boundary.label }}</strong>
            <small>{{ statusLabel(navigation.boundary.status) }}</small>
          </span>
          <span class="chatluna-studio-model-analysis-boundary-meta">
            {{ [navigation.boundary.provider, navigation.boundary.model].filter(Boolean).join(' / ') || '模型请求' }}
            · {{ formatDuration(navigation.boundary.durationMs) }}
          </span>
        </button>

        <section
          v-for="group in visibleNavigationGroups"
          :key="group.key"
          class="chatluna-studio-model-analysis-nav-group"
          :class="[
            `is-${group.key}`,
            {
              'is-active': !isNavigationGroupCollapsed(group.key),
              'is-collapsed': isNavigationGroupCollapsed(group.key),
              'is-muted': normalizedSearch && !group.items.some(itemMatches),
            },
          ]"
        >
          <button
            type="button"
            class="chatluna-studio-model-analysis-nav-heading"
            :aria-expanded="!isNavigationGroupCollapsed(group.key)"
            @click="toggleNavigationGroup(group.key)"
          >
            <component :is="groupIcon(group.key)" :size="15" aria-hidden="true" />
            <strong><AnalysisHighlightedText :value="group.label" :query="normalizedSearch" /></strong>
            <small>{{ group.count }}</small>
            <IconChevronDown class="chatluna-studio-model-analysis-nav-chevron" :size="15" aria-hidden="true" />
          </button>
          <div v-show="!isNavigationGroupCollapsed(group.key)" class="chatluna-studio-model-analysis-nav-items">
            <button
              v-for="item in group.items"
              :key="item.id"
              type="button"
              class="chatluna-studio-model-analysis-nav-item"
              :class="{
                'is-current': activeNavigationTarget === item.target,
                'is-muted': normalizedSearch && !itemMatches(item),
              }"
              :data-target="item.target"
              @click="jumpTo(item.target)"
            >
              <span class="chatluna-studio-model-analysis-nav-kind" :class="`is-${item.kind}`"><AnalysisHighlightedText :value="item.label" :query="normalizedSearch" /></span>
              <span v-if="item.index !== undefined" class="chatluna-studio-model-analysis-nav-index">#{{ item.index }}</span>
              <span class="chatluna-studio-model-analysis-nav-preview"><AnalysisHighlightedText :value="item.preview" :query="normalizedSearch" /></span>
            </button>
          </div>
        </section>
      </aside>

      <div ref="contentElement" class="chatluna-studio-model-analysis-content">
        <header class="chatluna-studio-model-analysis-heading">
          <h3>Messages <span>({{ visibleMessages.length }})</span></h3>
        </header>

        <!-- 一个 Provider 覆盖整段分析：每张卡片各自挂一个 Provider 会随消息数线性增加组件实例。 -->
        <TooltipProvider :delay-duration="500">
        <div class="chatluna-studio-model-analysis-conversation">
          <div v-if="conversation.parseError && !conversation.messages.length" class="chatluna-studio-model-analysis-empty">
            <p>{{ conversation.parseError }}</p>
          </div>
          <div v-else-if="!visibleMessages.length" class="chatluna-studio-model-analysis-empty">
            <p>当前过滤条件下没有请求消息</p>
          </div>

          <article
            v-for="message in visibleMessages"
            :id="modelAnalysisTargetId(message.evidenceId)"
            :key="message.evidenceId"
            class="chatluna-studio-model-analysis-card"
            :class="[
              `is-${message.kind}`,
              {
                'is-collapsed': isCardCollapsed(modelAnalysisTargetId(message.evidenceId)),
                'is-muted': normalizedSearch && !messageMatches(message),
                'is-located': highlightedTarget === modelAnalysisTargetId(message.evidenceId),
              },
            ]"
          >
            <header
              @mousedown="preventCardHeaderDoubleClickSelection"
              @click="toggleCardFromHeader($event, modelAnalysisTargetId(message.evidenceId))"
            >
              <span class="chatluna-studio-model-analysis-role"><AnalysisHighlightedText :value="evidenceBadgeLabel(message.kind)" :query="normalizedSearch" /></span>
              <span class="chatluna-studio-model-analysis-index">#{{ message.index }}</span>
              <span class="chatluna-studio-model-analysis-path">{{ formatEvidencePath(message.path) }}</span>
              <span class="chatluna-studio-model-analysis-chars">{{ message.characters }} chars</span>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    :aria-label="isMessageRaw(message.evidenceId) ? `查看第 ${message.index} 条消息格式化内容` : `查看第 ${message.index} 条消息原始 JSON`"
                    @click="toggleMessageRaw(message.evidenceId)"
                  >
                    <IconCode :size="16" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{{ isMessageRaw(message.evidenceId) ? '查看格式化内容' : '查看原始 JSON' }}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    class="chatluna-studio-model-analysis-collapse"
                    :aria-expanded="!isCardCollapsed(modelAnalysisTargetId(message.evidenceId))"
                    :aria-label="isCardCollapsed(modelAnalysisTargetId(message.evidenceId)) ? `展开第 ${message.index} 条消息卡片` : `收起第 ${message.index} 条消息卡片`"
                    @click="toggleCard(modelAnalysisTargetId(message.evidenceId))"
                  >
                    <IconChevronDown :size="16" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{{ isCardCollapsed(modelAnalysisTargetId(message.evidenceId)) ? '展开消息卡片' : '收起消息卡片' }}</TooltipContent>
              </Tooltip>
            </header>

            <!-- 原始 JSON 只在第一次真的被切开后才挂载：v-show 会让每条消息的整棵原始树在打开分析页时就进入 DOM。 -->
            <div
              v-if="isMessageRawMounted(message.evidenceId)"
              v-show="!isCardCollapsed(modelAnalysisTargetId(message.evidenceId)) && isMessageRaw(message.evidenceId)"
              class="chatluna-studio-model-analysis-json"
            >
              <div class="chatluna-studio-model-analysis-source-path">{{ formatEvidencePath(message.path) }}</div>
              <ModelRequestJsonTree
                :node="messageJsonTree(message)"
                :open="true"
                :root="true"
                :strings-expanded="true"
                :images-preview="true"
              />
            </div>
            <div v-show="!isCardCollapsed(modelAnalysisTargetId(message.evidenceId)) && !isMessageRaw(message.evidenceId)" class="chatluna-studio-model-analysis-formatted">
              <AnalysisTextBlock
                v-if="occurrenceForMessage(message.evidenceId)"
                :value="message.content"
                :search-query="normalizedSearch"
                :occurrence="occurrenceForMessage(message.evidenceId)"
                :force-expanded="isTextForceExpanded(modelAnalysisTargetId(message.evidenceId))"
              />
              <!-- 精确 occurrence 优先：它的范围是按正文的 UTF-16 偏移量算的，只有原文那一棵
                   pre 能标出来，结构视图里没有对应位置。 -->
              <section v-else-if="messagePayloadTree(message)" class="chatluna-studio-model-analysis-section">
                <div class="chatluna-studio-model-analysis-tool-payload chatluna-studio-model-request-json-viewer">
                  <ModelRequestJsonTree :node="messagePayloadTree(message)!" :open="true" :root="true" />
                </div>
              </section>
              <AnalysisContentParts
                v-else-if="message.contentParts.length"
                :parts="message.contentParts"
                :search-query="normalizedSearch"
                :force-expanded="isTextForceExpanded(modelAnalysisTargetId(message.evidenceId))"
              />
              <AnalysisTextBlock
                v-else-if="message.content"
                :value="message.content"
                :search-query="normalizedSearch"
                :force-expanded="isTextForceExpanded(modelAnalysisTargetId(message.evidenceId))"
              />
              <AnalysisTextBlock
                v-if="message.reasoning"
                label="思考"
                :value="message.reasoning"
                :search-query="normalizedSearch"
                :force-expanded="isTextForceExpanded(modelAnalysisTargetId(message.evidenceId))"
              />
              <section v-if="message.toolCalls.length && requestToolCallsVisible" class="chatluna-studio-model-analysis-section">
                <strong>工具调用</strong>
                <article
                  v-for="(call, callIndex) in message.toolCalls"
                  :id="modelAnalysisTargetId(call.evidenceId)"
                  :key="`${call.id || callIndex}-${call.name}`"
                  class="chatluna-studio-model-analysis-tool-call is-call"
                  :class="{ 'is-located': highlightedTarget === modelAnalysisTargetId(call.evidenceId) }"
                >
                  <div><strong><AnalysisHighlightedText :value="call.name" :query="normalizedSearch" /></strong><span><AnalysisHighlightedText :value="call.id || '无调用 ID'" :query="normalizedSearch" /></span></div>
                  <div v-if="callArgumentsTree(call)" class="chatluna-studio-model-analysis-tool-payload chatluna-studio-model-request-json-viewer">
                    <ModelRequestJsonTree :node="callArgumentsTree(call)!" :open="true" :root="true" :strings-expanded="true" />
                  </div>
                  <AnalysisTextBlock
                    v-else
                    :value="call.arguments || '{}'"
                    :search-query="normalizedSearch"
                    :force-expanded="isTextForceExpanded(modelAnalysisTargetId(call.evidenceId))"
                    compact
                  />
                  <button
                    v-if="hasTool(call.name)"
                    type="button"
                    class="chatluna-studio-model-analysis-link"
                    @click="locateTool(call.name)"
                  >
                    查看工具定义
                  </button>
                </article>
              </section>
            </div>
          </article>

          <section v-if="detail.variables?.length && variablesVisible" class="chatluna-studio-model-analysis-variables">
            <h3>Variables <span>({{ detail.variables.length }})</span></h3>
            <div class="chatluna-studio-model-analysis-variable-list">
              <article
                v-for="variable in detail.variables"
                :id="modelAnalysisVariableTargetId(variable.id)"
                :key="variable.id"
                class="chatluna-studio-model-analysis-variable-card"
                :class="{
                  'is-collapsed': isCardCollapsed(modelAnalysisVariableTargetId(variable.id)),
                  'is-muted': normalizedSearch && !variableMatches(variable),
                  'is-located': highlightedTarget === modelAnalysisVariableTargetId(variable.id),
                }"
              >
                <header
                  @mousedown="preventCardHeaderDoubleClickSelection"
                  @click="toggleCardFromHeader($event, modelAnalysisVariableTargetId(variable.id))"
                >
                  <span class="chatluna-studio-model-analysis-role">{{ evidenceBadgeLabel('variable') }}</span>
                  <strong><AnalysisHighlightedText :value="variable.name" :query="normalizedSearch" /></strong>
                  <span class="chatluna-studio-model-analysis-variable-preset">{{ variable.presetName }}</span>
                  <Tooltip v-if="historyPreview(variable)">
                    <TooltipTrigger as-child>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        :aria-label="isHistoryVariableRaw(variable.id) ? `查看变量 ${variable.name} 的消息预览` : `查看变量 ${variable.name} 的原始 XML`"
                        @click="toggleHistoryVariableRaw(variable.id)"
                      >
                        <IconCode :size="16" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{{ isHistoryVariableRaw(variable.id) ? '查看消息预览' : '查看原始 XML' }}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        class="chatluna-studio-model-analysis-collapse"
                        :aria-expanded="!isCardCollapsed(modelAnalysisVariableTargetId(variable.id))"
                        :aria-label="isCardCollapsed(modelAnalysisVariableTargetId(variable.id)) ? `展开变量 ${variable.name}` : `收起变量 ${variable.name}`"
                        @click="toggleCard(modelAnalysisVariableTargetId(variable.id))"
                      >
                        <IconChevronDown :size="16" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{{ isCardCollapsed(modelAnalysisVariableTargetId(variable.id)) ? '展开变量卡片' : '收起变量卡片' }}</TooltipContent>
                  </Tooltip>
                </header>
                <div v-show="!isCardCollapsed(modelAnalysisVariableTargetId(variable.id))" class="chatluna-studio-model-analysis-variable-body">
                  <p v-if="variable.status === 'observed' && !variable.value" class="chatluna-studio-model-analysis-variable-empty">
                    <span>空值</span>该表达式在本次模型请求中展开为空字符串
                  </p>
                  <ModelRequestHistoryPreview
                    v-else-if="historyPreview(variable) && !isHistoryVariableRaw(variable.id)"
                    :messages="historyPreview(variable)!"
                    :bot-id="detail.entities.botId"
                    :characters="variable.value?.length"
                  />
                  <AnalysisTextBlock
                    v-else-if="variable.status === 'observed'"
                    :value="variable.value ?? ''"
                    :search-query="normalizedSearch"
                    compact
                  />
                  <p v-else class="chatluna-studio-model-analysis-variable-status">{{ modelRequestVariableStatusLabel(variable.status) }}</p>
                </div>
              </article>
            </div>
          </section>

          <template v-if="responseVisible">
          <section class="chatluna-studio-model-analysis-response-heading">
            <h3>Response</h3>
          </section>
          <article
            id="model-analysis-response"
            class="chatluna-studio-model-analysis-card is-response"
            :class="{
              'is-collapsed': isCardCollapsed(MODEL_ANALYSIS_RESPONSE_TARGET),
              'is-muted': normalizedSearch && !responseMatches,
              'is-located': highlightedTarget === MODEL_ANALYSIS_RESPONSE_TARGET,
            }"
          >
            <header
              @mousedown="preventCardHeaderDoubleClickSelection"
              @click="toggleCardFromHeader($event, MODEL_ANALYSIS_RESPONSE_TARGET)"
            >
              <span class="chatluna-studio-model-analysis-role">{{ evidenceBadgeLabel('response') }}</span>
              <span class="chatluna-studio-model-analysis-path">{{ responseFormatLabel }}</span>
              <span class="chatluna-studio-model-analysis-chars">{{ responseCharacters }} chars</span>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    :disabled="response.raw === undefined"
                    :aria-label="responseRaw ? '查看响应格式化内容' : `查看响应原始 ${responseFormatLabel}`"
                    @click="toggleResponseRaw"
                  >
                    <IconCode :size="16" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{{ responseRaw ? '查看格式化内容' : `查看原始 ${responseFormatLabel}` }}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    class="chatluna-studio-model-analysis-collapse"
                    :aria-expanded="!isCardCollapsed(MODEL_ANALYSIS_RESPONSE_TARGET)"
                    :aria-label="isCardCollapsed(MODEL_ANALYSIS_RESPONSE_TARGET) ? '展开响应卡片' : '收起响应卡片'"
                    @click="toggleCard(MODEL_ANALYSIS_RESPONSE_TARGET)"
                  >
                    <IconChevronDown :size="16" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{{ isCardCollapsed(MODEL_ANALYSIS_RESPONSE_TARGET) ? '展开响应卡片' : '收起响应卡片' }}</TooltipContent>
              </Tooltip>
            </header>

            <div
              v-if="responseRawMounted"
              v-show="!isCardCollapsed(MODEL_ANALYSIS_RESPONSE_TARGET) && responseRaw && response.raw !== undefined"
              class="chatluna-studio-model-analysis-json"
            >
              <pre v-if="typeof response.raw === 'string'" class="chatluna-studio-model-analysis-raw-text">{{ response.raw }}</pre>
              <ModelRequestJsonTree
                v-else
                :node="responseJsonTree()"
                :open="true"
                :root="true"
                :strings-expanded="true"
                :images-preview="true"
              />
            </div>
            <div v-show="!isCardCollapsed(MODEL_ANALYSIS_RESPONSE_TARGET) && !responseRaw" class="chatluna-studio-model-analysis-formatted">
              <p v-if="response.status !== 'complete'" class="chatluna-studio-model-analysis-empty">
                {{ response.statusMessage || '响应没有可展示内容' }}
              </p>
              <AnalysisTextBlock
                v-if="response.reasoning.length && responseContentVisible"
                label="思考"
                :value="response.reasoning.join('\n')"
                :search-query="normalizedSearch"
                :force-expanded="isTextForceExpanded(MODEL_ANALYSIS_RESPONSE_TARGET)"
              />
              <AnalysisTextBlock
                v-if="response.content.length && responseContentVisible"
                :value="response.content.join('\n')"
                :search-query="normalizedSearch"
                :force-expanded="isTextForceExpanded(MODEL_ANALYSIS_RESPONSE_TARGET)"
              />
              <section v-if="response.toolCalls.length && responseToolCallsVisible" class="chatluna-studio-model-analysis-section">
                <strong>工具调用</strong>
                <article
                  v-for="(call, callIndex) in response.toolCalls"
                  :id="modelAnalysisTargetId(call.evidenceId)"
                  :key="`${call.id || callIndex}-${call.name}`"
                  class="chatluna-studio-model-analysis-tool-call is-call"
                  :class="{ 'is-located': highlightedTarget === modelAnalysisTargetId(call.evidenceId) }"
                >
                  <div><strong><AnalysisHighlightedText :value="call.name" :query="normalizedSearch" /></strong><span><AnalysisHighlightedText :value="call.id || '无调用 ID'" :query="normalizedSearch" /></span></div>
                  <!-- 参数解析不出结构时退回原文：模型流式吐出的参数可能被截断，硬套 JSON 树只会
                       画出一棵空树，把「参数不完整」这条事实藏掉。 -->
                  <div v-if="callArgumentsTree(call)" class="chatluna-studio-model-analysis-tool-payload chatluna-studio-model-request-json-viewer">
                    <ModelRequestJsonTree
                      :node="callArgumentsTree(call)!"
                      :open="true"
                      :root="true"
                      :strings-expanded="true"
                    />
                  </div>
                  <AnalysisTextBlock
                    v-else
                    :value="call.arguments || '{}'"
                    :search-query="normalizedSearch"
                    :force-expanded="isTextForceExpanded(modelAnalysisTargetId(call.evidenceId))"
                    compact
                  />
                  <button v-if="hasTool(call.name)" type="button" class="chatluna-studio-model-analysis-link" @click="locateTool(call.name)">
                    查看工具定义
                  </button>
                </article>
              </section>
              <section v-if="response.toolResults.length && responseToolResultsVisible" class="chatluna-studio-model-analysis-section">
                <strong>工具结果</strong>
                <article
                  v-for="(result, resultIndex) in response.toolResults"
                  :id="modelAnalysisTargetId(result.evidenceId)"
                  :key="`${result.id || resultIndex}-${result.name || ''}`"
                  class="chatluna-studio-model-analysis-tool-call is-result"
                  :class="{ 'is-located': highlightedTarget === modelAnalysisTargetId(result.evidenceId) }"
                >
                  <div><strong><AnalysisHighlightedText :value="result.name || '工具结果'" :query="normalizedSearch" /></strong><span><AnalysisHighlightedText :value="result.id || '无调用 ID'" :query="normalizedSearch" /></span></div>
                  <div v-if="toolResultTree(result)" class="chatluna-studio-model-analysis-tool-payload chatluna-studio-model-request-json-viewer">
                    <ModelRequestJsonTree :node="toolResultTree(result)!" :open="true" :root="true" />
                  </div>
                  <AnalysisTextBlock
                    v-else
                    :value="result.content"
                    :search-query="normalizedSearch"
                    :force-expanded="isTextForceExpanded(modelAnalysisTargetId(result.evidenceId))"
                    compact
                  />
                </article>
              </section>
              <div v-if="response.finishReasons.length || response.usage" class="chatluna-studio-model-analysis-response-meta">
                <span v-if="response.finishReasons.length">结束原因：{{ response.finishReasons.join('、') }}</span>
                <span v-if="response.usage?.inputTokens !== undefined">输入：{{ response.usage.inputTokens }}</span>
                <span v-if="response.usage?.outputTokens !== undefined">输出：{{ response.usage.outputTokens }}</span>
                <span v-if="response.usage?.reasoningTokens !== undefined">推理：{{ response.usage.reasoningTokens }}</span>
                <span v-if="response.usage?.totalTokens !== undefined">总 Token：{{ response.usage.totalTokens }}</span>
              </div>
            </div>
          </article>
          </template>

          <section v-if="toolDefinitionsVisible" :id="MODEL_ANALYSIS_TOOLS_TARGET" class="chatluna-studio-model-analysis-tools" :class="{ 'is-located': highlightedTarget === MODEL_ANALYSIS_TOOLS_TARGET }">
            <h3>Tools <span>({{ conversation.tools.length }})</span></h3>
            <p v-if="!conversation.tools.length" class="chatluna-studio-model-analysis-empty">请求未声明工具定义</p>
            <article
              v-for="tool in conversation.tools"
              :id="modelAnalysisTargetId(tool.evidenceId)"
              :key="tool.evidenceId"
              class="chatluna-studio-model-analysis-tool-card"
              :class="{
                'is-expanded': isToolExpanded(tool.evidenceId),
                'is-muted': normalizedSearch && !toolMatches(tool),
                'is-located': highlightedTarget === modelAnalysisTargetId(tool.evidenceId),
              }"
            >
              <button
                type="button"
                class="chatluna-studio-model-analysis-tool-summary"
                :aria-expanded="isToolExpanded(tool.evidenceId)"
                @pointerdown="startToolPointer"
                @pointerup="finishToolPointer"
                @click="toggleToolFromSummary(tool.evidenceId)"
              >
                <IconTool :size="18" aria-hidden="true" />
                <span class="chatluna-studio-model-analysis-tool-copy">
                  <strong><AnalysisHighlightedText :value="tool.name" :query="normalizedSearch" /></strong>
                  <span class="chatluna-studio-model-analysis-tool-desc">
                    <AnalysisHighlightedText :value="compactAnalysisText(tool.description || '无描述')" :query="normalizedSearch" />
                  </span>
                  <small>
                    {{ tool.propertyCount }} props
                    <span v-if="tool.requiredFields.length"> · required: {{ tool.requiredFields.join(', ') }}</span>
                  </small>
                </span>
                <IconChevronDown class="chatluna-studio-model-analysis-tool-chevron" :size="18" aria-hidden="true" />
              </button>
              <div v-if="isToolExpanded(tool.evidenceId)" class="chatluna-studio-model-analysis-tool-detail">
                <p><AnalysisHighlightedText :value="tool.description || '无描述'" :query="normalizedSearch" /></p>
                <h4>Parameters (JSON Schema) <small>{{ formatEvidencePath(tool.path) }}</small></h4>
                <div class="chatluna-studio-model-analysis-tool-schema chatluna-studio-model-request-json-viewer">
                  <ModelRequestJsonTree
                    :node="toolParametersJsonTree(tool)"
                    :open="true"
                    :root="true"
                    :strings-expanded="true"
                  />
                </div>
              </div>
            </article>
          </section>
        </div>
        </TooltipProvider>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  IconBraces,
  IconChevronDown,
  IconCode,
  IconMessage,
  IconRobot,
  IconSettings,
  IconTool,
  IconUser,
} from '@tabler/icons-vue'
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { Button } from '#client/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '#client/components/ui/tooltip'
import ModelRequestHistoryPreview from './history-preview.vue'
import ModelRequestJsonTree from './json-tree.vue'
import { formatDuration } from '#client/shared/format-duration'
import {
  buildModelRequestAnalysisNavigation,
  compactAnalysisText,
  exceedsAnalysisLineLimit,
  formatEvidencePath,
  isPreviewableConversationImage,
  matchesAnalysisSearch,
  MODEL_ANALYSIS_RESPONSE_TARGET,
  MODEL_ANALYSIS_TOOLS_TARGET,
  modelAnalysisTargetId,
  modelAnalysisVariableTargetId,
  normalizeAnalysisQuery,
  resolveActiveAnalysisTarget,
  shouldExpandAnalysisText,
  type ModelRequestAnalysisGroupKey,
  type ModelRequestAnalysisNavigationItem,
} from './analysis'
import { createAnalysisExpansion } from './analysis-expansion'
import { createEvidenceLocator, type LocateRequest } from '#client/shared/evidence-locator'
import {
  isHistoryVariableName,
  parseModelRequestHistory,
  type ModelRequestHistoryMessage,
} from './history'
import {
  renderModelRequestOccurrence,
  type ModelRequestOccurrence,
} from './occurrence'
import { buildModelRequestJsonTree, type ModelRequestJsonNode } from './json'
import {
  EMPTY_MODEL_EVIDENCE_FILTER,
  isEvidenceVisible,
  type ModelEvidenceFilter,
} from './filter'
import {
  parseModelRequestConversationDetail,
  type ModelConversationContentPart,
  type ModelConversationMessage,
  type ModelConversationTool,
  type ModelConversationToolCall,
  type ModelConversationToolResult,
  type ModelRequestConversation,
} from './conversation'
import { resolveModelRequestToolPayload } from './tool-payload'
import { studioEvidenceLabels, type StudioEvidenceKind } from '../../src/evidence-kind'
import { modelRequestVariableStatusLabel } from '../../src/model-request-variables'
import type { StudioModelRequestDetail, StudioModelRequestStatus, StudioModelRequestTrajectory, StudioModelRequestVariable } from '../../src/types'

const props = defineProps<{
  detail: StudioModelRequestDetail
  trajectory?: StudioModelRequestTrajectory
  searchQuery?: string
  layout?: 'page' | 'inspector'
  /** 跨视图定位信号；轨迹账本与组成分段都发这个形状。 */
  locateRequest?: LocateRequest
  /** 与轨迹账本共用的显示过滤；同一条证据在两个视图里必须同时出现或同时隐藏。 */
  filter?: ModelEvidenceFilter
}>()
const emit = defineEmits<{
  locate: [target: string]
  locateResult: [result: { seq: number, located: boolean }]
}>()

const normalizedSearch = computed(() => normalizeAnalysisQuery(props.searchQuery))
const conversation = computed<ModelRequestConversation>(() => parseModelRequestConversationDetail(props.detail))
const response = computed(() => conversation.value.response!)
const navigation = computed(() => buildModelRequestAnalysisNavigation(conversation.value, props.detail))
const evidenceFilter = computed(() => props.filter ?? EMPTY_MODEL_EVIDENCE_FILTER)
const visibleNavigationGroups = computed(() => navigation.value.groups.flatMap((group) => {
  // 导航项的种类就是基础证据种类，可以直接参与过滤判定，不需要先翻译一次。
  const items = group.items.filter(item => isEvidenceVisible(evidenceFilter.value, item.kind))
  return items.length ? [{ ...group, count: items.length, items }] : []
}))
const visibleMessages = computed(() => conversation.value.messages.filter(message => isEvidenceVisible(
  evidenceFilter.value,
  message.kind,
)))
const variablesVisible = computed(() => isEvidenceVisible(evidenceFilter.value, 'variable'))
const requestToolCallsVisible = computed(() => isEvidenceVisible(evidenceFilter.value, 'tool-call'))
const toolDefinitionsVisible = computed(() => isEvidenceVisible(evidenceFilter.value, 'tool-definition'))
const responseContentVisible = computed(() => isEvidenceVisible(evidenceFilter.value, 'assistant'))
const responseToolCallsVisible = computed(() => isEvidenceVisible(evidenceFilter.value, 'tool-call'))
const responseToolResultsVisible = computed(() => isEvidenceVisible(evidenceFilter.value, 'tool-result'))
const responseVisible = computed(() => (
  responseContentVisible.value || responseToolCallsVisible.value || responseToolResultsVisible.value
))
// 展开态与原文态住在 analysis-expansion 里；这里只是它的渲染面。
const {
  activeNavigationTarget,
  expandCard,
  expandSearchMatches,
  expandTool,
  focusNavigationTarget,
  getExpandedText,
  isCardCollapsed,
  isHistoryVariableRaw,
  isMessageRaw,
  isMessageRawMounted,
  isNavigationGroupCollapsed,
  isTextForceExpanded,
  isToolExpanded,
  reset: resetExpansion,
  responseRaw,
  responseRawMounted,
  setExpandedText,
  setMessageRaw,
  setResponseRaw,
  toggleCard,
  toggleHistoryVariableRaw,
  toggleMessageRaw,
  toggleNavigationGroup: toggleNavigationGroupCollapsed,
  toggleResponseRaw,
  toggleTool,
} = createAnalysisExpansion()
const historyPreviewCache = new Map<string, readonly ModelRequestHistoryMessage[] | undefined>()
// 原始 JSON 树按证据身份缓存。模板里直接调用 buildModelRequestJsonTree 会让每次重渲染
// （搜索输入、折叠、定位高亮）都重建整棵树；缓存随会话投影一起失效。
let jsonTrees = new Map<string, ModelRequestJsonNode>()
const contentElement = ref<HTMLElement>()
const navigationElement = ref<HTMLElement>()
const highlightedTarget = ref('')
const activeOccurrence = ref<ModelRequestOccurrence>()
// 搜索文本按会话投影预先折叠成小写一次。逐次渲染或逐个按键都重新 toLocaleLowerCase 整段会话，
// 代价随请求体大小线性增长，而这些文本在同一条记录内不变。
const messageSearchTexts = computed(() => new Map(
  conversation.value.messages.map(message => [message.evidenceId, message.searchText.toLocaleLowerCase('zh-CN')]),
))
const toolSearchTexts = computed(() => new Map(
  conversation.value.tools.map(tool => [tool.evidenceId, tool.searchText.toLocaleLowerCase('zh-CN')]),
))
const responseSearchText = computed(() => response.value.searchText.toLocaleLowerCase('zh-CN'))
const responseMatches = computed(() => !normalizedSearch.value || responseSearchText.value.includes(normalizedSearch.value))
const responseCharacters = computed(() => [
  ...response.value.content,
  ...response.value.reasoning,
  ...response.value.toolCalls.map(call => call.arguments || ''),
  ...response.value.toolResults.map(result => result.content),
].join('').length)
const NAVIGATION_TARGET_SCROLL_TOP_MARGIN = 12
const NAVIGATION_TARGET_SCROLL_BOTTOM_MARGIN = 32
let pointerStart: { x: number, y: number } | undefined
let suppressToolSummary = false
let navigationScroller: HTMLElement | undefined
let navigationResizeObserver: ResizeObserver | undefined
let navigationFrame = 0
// 导航锚点的 DOM 解析结果按可见分组缓存；分组变化或节点被卸载时才重新解析。
let navigationTargetElements: Array<{ target: string, element: HTMLElement }> = []
let navigationTargetsDirty = true

// 定位的全部决策与帧时序都在 evidence-locator 里；这里只交出 DOM、渲染状态与计时出口。
const locator = createEvidenceLocator({
  getConversation: () => conversation.value,
  getNavigation: () => navigation.value,
  setOccurrenceTarget: (occurrence) => {
    activeOccurrence.value = occurrence
  },
  measure: (target) => {
    const element = findTarget(target)
    const scroller = findScroller()
    if (!element || !scroller) return undefined
    return {
      elementTop: element.getBoundingClientRect().top,
      scrollerTop: scroller.getBoundingClientRect().top,
      scrollTop: scroller.scrollTop,
    }
  },
  scrollTo: (top, behavior) => {
    findScroller()?.scrollTo({ top, behavior })
  },
  expandCard,
  setToolExpanded: expandTool,
  isMessageRaw,
  setMessageRaw,
  isResponseRaw: () => responseRaw.value,
  setResponseRaw,
  getExpandedText,
  setExpandedText,
  setHighlight: (target) => {
    highlightedTarget.value = target ?? ''
  },
  nextTick,
  frame: () => new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  }),
  observeResize: (callback) => {
    const content = contentElement.value
    const scroller = findScroller()
    if (!content || typeof ResizeObserver === 'undefined') return () => {}
    const observer = new ResizeObserver(callback)
    observer.observe(content)
    if (scroller && scroller !== content) observer.observe(scroller)
    return () => observer.disconnect()
  },
  schedule: (delayMs, callback) => {
    const timer = setTimeout(callback, delayMs)
    return () => clearTimeout(timer)
  },
})

watch(normalizedSearch, async (query) => {
  if (!query) return
  expandSearchMatches({
    cardTargets: [
      ...conversation.value.messages
        .filter(messageMatches)
        .map(message => modelAnalysisTargetId(message.evidenceId)),
      ...(responseSearchText.value.includes(query) ? [MODEL_ANALYSIS_RESPONSE_TARGET] : []),
      ...props.detail.variables
        .filter(variableMatches)
        .map(variable => modelAnalysisVariableTargetId(variable.id)),
    ],
    toolEvidenceIds: conversation.value.tools.filter(toolMatches).map(tool => tool.evidenceId),
  })
  // 轨迹检查器已经选中了具体账本行，搜索只高亮匹配卡片，不再抢走当前定位。
  if (props.layout === 'inspector') return
  const first = visibleNavigationGroups.value.flatMap(group => group.items).find(itemMatches)
  if (first) await jumpTo(first.target, false)
})

watch(() => props.locateRequest?.seq, () => {
  void locateRequestedEvidence()
})

watch(conversation, () => {
  jsonTrees = new Map()
})

onMounted(() => {
  void locateRequestedEvidence()
  nextTick(setupNavigationTracking)
})

watch(visibleNavigationGroups, () => {
  navigationTargetsDirty = true
  nextTick(scheduleNavigationTracking)
}, { flush: 'post' })

watch(() => props.detail.id, (next, previous) => {
  if (next === previous) return
  resetExpansion()
  historyPreviewCache.clear()
  jsonTrees = new Map()
  navigationTargetsDirty = true
  locator.reset()
  const scroller = findScroller()
  if (scroller) scroller.scrollTop = 0
})

onBeforeUnmount(() => {
  locator.dispose()
  teardownNavigationTracking()
})

function setupNavigationTracking() {
  teardownNavigationTracking()
  if (props.layout === 'inspector') return
  navigationScroller = findScroller()
  if (!navigationScroller) return
  navigationScroller.addEventListener('scroll', scheduleNavigationTracking, { passive: true })
  if (typeof ResizeObserver !== 'undefined' && contentElement.value) {
    navigationResizeObserver = new ResizeObserver(scheduleNavigationTracking)
    navigationResizeObserver.observe(contentElement.value)
    navigationResizeObserver.observe(navigationScroller)
    if (navigationElement.value) navigationResizeObserver.observe(navigationElement.value)
  }
  updateActiveNavigationTarget()
}

function teardownNavigationTracking() {
  navigationScroller?.removeEventListener('scroll', scheduleNavigationTracking)
  navigationScroller = undefined
  navigationResizeObserver?.disconnect()
  navigationResizeObserver = undefined
  navigationTargetElements = []
  navigationTargetsDirty = true
  if (navigationFrame) cancelAnimationFrame(navigationFrame)
  navigationFrame = 0
}

function scheduleNavigationTracking() {
  if (navigationFrame) return
  navigationFrame = requestAnimationFrame(() => {
    navigationFrame = 0
    updateActiveNavigationTarget()
  })
}

function updateActiveNavigationTarget() {
  const content = contentElement.value
  const scroller = navigationScroller ?? findScroller()
  if (!content || !scroller) return
  const scrollerRect = scroller.getBoundingClientRect()
  const scrollerTop = scrollerRect.top
  navigationElement.value?.style.setProperty('--chatluna-studio-model-analysis-nav-height', `${scroller.clientHeight}px`)
  // 只量导航条目真正指向的那些锚点。滚动的每一帧都重新扫一遍 content 的 [id] 子树，
  // 会随消息数与原始 JSON 树的节点数一起变慢，而锚点集合只在过滤变化时才变。
  const targetPositions = resolveNavigationTargetElements(content)
    .map(({ target, element }) => ({ target, top: element.getBoundingClientRect().top }))
    .sort((left, right) => left.top - right.top)
  const nextTarget = resolveActiveAnalysisTarget(targetPositions, scrollerTop, scroller.clientHeight)
  // 只有当前目标真的变了才把左侧条目滚进视野；要滚的就是刚写进去的那个当前目标。
  if (focusNavigationTarget(nextTarget)) {
    nextTick(() => scrollNavigationTargetIntoView(activeNavigationTarget.value))
  }
}

function resolveNavigationTargetElements(content: HTMLElement) {
  if (!navigationTargetsDirty && navigationTargetElements.every(({ element }) => element.isConnected)) {
    return navigationTargetElements
  }
  navigationTargetsDirty = false
  navigationTargetElements = visibleNavigationGroups.value
    .flatMap(group => group.items)
    .flatMap((item) => {
      // 属性选择器而不是 #id：证据身份里的 : 和 . 在 id 选择器里是语法字符。
      const element = content.querySelector<HTMLElement>(`[id="${item.target}"]`)
      return element ? [{ target: item.target, element }] : []
    })
  return navigationTargetElements
}

function scrollNavigationTargetIntoView(target: string) {
  const navigation = navigationElement.value
  if (!navigation) return
  const item = [...navigation.querySelectorAll<HTMLElement>('.chatluna-studio-model-analysis-nav-item')]
    .find(element => element.dataset.target === target)
  if (!item) return
  const navigationRect = navigation.getBoundingClientRect()
  const itemRect = item.getBoundingClientRect()
  const visibleTop = navigationRect.top + NAVIGATION_TARGET_SCROLL_TOP_MARGIN
  const visibleBottom = navigationRect.bottom - NAVIGATION_TARGET_SCROLL_BOTTOM_MARGIN
  if (itemRect.top < visibleTop) {
    navigation.scrollTo({ top: navigation.scrollTop + itemRect.top - visibleTop, behavior: 'smooth' })
  } else if (itemRect.bottom > visibleBottom) {
    navigation.scrollTo({ top: navigation.scrollTop + itemRect.bottom - visibleBottom, behavior: 'smooth' })
  }
}

// 折叠一个分组改变左侧条目的布局，跟随因此要重新量一次；跟随本身是 DOM 的事，留在视图。
function toggleNavigationGroup(group: ModelRequestAnalysisGroupKey) {
  toggleNavigationGroupCollapsed(group)
  nextTick(scheduleNavigationTracking)
}

function itemMatches(item: ModelRequestAnalysisNavigationItem) {
  return matchesAnalysisSearch(navigation.value, item.id, normalizedSearch.value)
}

function messageMatches(message: ModelConversationMessage) {
  return !normalizedSearch.value || Boolean(messageSearchTexts.value.get(message.evidenceId)?.includes(normalizedSearch.value))
}

/** 变量卡片与左侧导航项读同一张搜索文本表；卡片自己重算一份会让两侧对同一个查询词给出相反结论。 */
function variableMatches(variable: StudioModelRequestVariable) {
  return matchesAnalysisSearch(navigation.value, variable.id, normalizedSearch.value)
}

function toolMatches(tool: ModelConversationTool) {
  return !normalizedSearch.value || Boolean(toolSearchTexts.value.get(tool.evidenceId)?.includes(normalizedSearch.value))
}

function historyPreview(variable: StudioModelRequestVariable): readonly ModelRequestHistoryMessage[] | undefined {
  if (variable.status !== 'observed' || !variable.value || !isHistoryVariableName(variable.name)) return undefined
  const cacheKey = `${variable.id}\u0000${variable.value}`
  if (!historyPreviewCache.has(cacheKey)) historyPreviewCache.set(cacheKey, parseModelRequestHistory(variable.value))
  return historyPreviewCache.get(cacheKey)
}

function cachedJsonTree(cacheKey: string, rootKey: string, read: () => unknown): ModelRequestJsonNode {
  const cached = jsonTrees.get(cacheKey)
  if (cached) return cached
  const tree = buildModelRequestJsonTree(read(), rootKey)
  jsonTrees.set(cacheKey, tree)
  return tree
}

function messageJsonTree(message: ModelConversationMessage): ModelRequestJsonNode {
  return cachedJsonTree(`message:${message.evidenceId}`, `message-${message.index}`, () => message.raw)
}

function responseJsonTree(): ModelRequestJsonNode {
  return cachedJsonTree('response', 'response', () => response.value.raw)
}

/**
 * 一段工具载荷的结构树，解析不出结构时给 undefined 让调用处退回原文。
 *
 * 树按证据身份缓存在同一张表里：判定要在每次重渲染时给模板一个稳定引用，
 * 每次现算会让 JSON 查看器的展开态随搜索输入一起被丢掉。
 */
function toolPayloadTree(
  cacheKey: string,
  rootKey: string,
  value: string | undefined,
  revealText = false,
): ModelRequestJsonNode | undefined {
  // 退回原文的判定必须先做：缓存只存树，命中搜索时读缓存会把已经建好的那棵又摆回来。
  if (resolveModelRequestToolPayload(value, { revealText }).kind !== 'json') return undefined
  const cached = jsonTrees.get(cacheKey)
  if (cached) return cached
  const payload = resolveModelRequestToolPayload(value)
  if (payload.kind !== 'json') return undefined
  const tree = buildModelRequestJsonTree(payload.value, rootKey)
  jsonTrees.set(cacheKey, tree)
  return tree
}

function callArgumentsTree(call: ModelConversationToolCall): ModelRequestJsonNode | undefined {
  return toolPayloadTree(
    `arguments:${call.evidenceId}`,
    'arguments',
    call.arguments,
    payloadMatchesSearch(call.arguments),
  )
}

function toolResultTree(result: ModelConversationToolResult): ModelRequestJsonNode | undefined {
  return toolPayloadTree(
    `result:${result.evidenceId}`,
    'result',
    result.content,
    payloadMatchesSearch(result.content),
  )
}

/** 当前查询词是否落在这段载荷里。命中的载荷退回原文，让高亮标出具体位置。 */
function payloadMatchesSearch(value: string | undefined) {
  const query = normalizedSearch.value
  if (!query || !value) return false
  return value.toLocaleLowerCase('zh-CN').includes(query)
}

/**
 * 请求里携带的工具结果消息同样按结构显示。
 *
 * 它在证据投影里是一条 tool 角色的消息，正文就是上一轮工具返回的那段 JSON；
 * 只有工具结果这一档走这条路，其余角色的正文是自然语言，套上结构树反而更难读。
 */
function messagePayloadTree(message: ModelConversationMessage): ModelRequestJsonNode | undefined {
  if (message.kind !== 'tool-result') return undefined
  return toolPayloadTree(
    `message-payload:${message.evidenceId}`,
    'result',
    message.content,
    payloadMatchesSearch(message.content),
  )
}

function toolParametersJsonTree(tool: ModelConversationTool): ModelRequestJsonNode {
  return cachedJsonTree(`parameters:${tool.evidenceId}`, 'parameters', () => tool.parameters || {})
}

async function locateRequestedEvidence() {
  const request = props.locateRequest
  if (!request) return
  const located = request.range
    ? await locator.locateOccurrence(request.evidenceId, request.range)
    : await locator.locateEvidence(request.evidenceId)
  if (located) emit('locate', located)
  emit('locateResult', { seq: request.seq, located: Boolean(located) })
}

function occurrenceForMessage(evidenceId: string) {
  return activeOccurrence.value?.evidenceId === evidenceId ? activeOccurrence.value : undefined
}

async function jumpTo(target?: string, emphasize = true) {
  const located = await locator.locate(target, { emphasize })
  if (located) emit('locate', located)
}

function locateTool(name: string) {
  void locator.locateTool(name).then((located) => {
    if (located) emit('locate', located)
  })
}

function findScroller(): HTMLElement | undefined {
  const content = contentElement.value
  if (!content) return undefined
  // 检查器真正滚动的是 inspector-body。工作台分析真正滚动的是外层详情卡片：
  // analysis-content 在这两处都应 overflow:visible，否则只会滚内层卡片，外层详情停在顶部。
  if (props.layout === 'inspector') {
    return content.closest<HTMLElement>('.chatluna-studio-model-trajectory-inspector-body') ?? content
  }
  return content.closest<HTMLElement>('.chatluna-studio-model-request-detail') ?? content
}

function findTarget(target: string): HTMLElement | null {
  const candidates = contentElement.value?.querySelectorAll<HTMLElement>('[id]') ?? []
  return [...candidates].find(element => element.id === target) ?? null
}

function hasTool(name: string) {
  // 工具定义整段被过滤掉时不给跳转入口，否则会定位到一个当前不存在的目标。
  if (!toolDefinitionsVisible.value) return false
  return conversation.value.tools.some(tool => tool.name === name)
}

// 第二次按下时阻止浏览器按单词选中，但保留单击折叠和拖选复制。
function preventCardHeaderDoubleClickSelection(event: MouseEvent) {
  if (event.detail < 2) return
  if (event.target instanceof Element && event.target.closest('button')) return
  event.preventDefault()
}

// 头部空白也折叠。JSON / 箭头是独立按钮，closest('button') 避免点它们时再切一次。
function toggleCardFromHeader(event: MouseEvent, target: string) {
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed) return
  if (event.target instanceof Element && event.target.closest('button')) return
  toggleCard(target)
}

// 工具摘要同时允许复制文本；拖选结束会触发 click，必须区分位移和折叠操作，避免选中文字时意外收起卡片。
function startToolPointer(event: PointerEvent) {
  pointerStart = { x: event.clientX, y: event.clientY }
  suppressToolSummary = false
}

function finishToolPointer(event: PointerEvent) {
  if (!pointerStart) return
  suppressToolSummary = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 3
  pointerStart = undefined
}

function toggleToolFromSummary(path: string) {
  const selection = window.getSelection()
  if (suppressToolSummary || selection && !selection.isCollapsed) {
    suppressToolSummary = false
    return
  }
  toggleTool(path)
}

function evidenceBadgeLabel(kind: StudioEvidenceKind) {
  // 徽标语境统一取全大写变体；`.chatluna-studio-model-analysis-role` 自己做小写排版。
  return studioEvidenceLabels(kind).badge
}

function groupIcon(group: ModelRequestAnalysisGroupKey): Component {
  if (group === 'system') return IconSettings
  if (group === 'user') return IconUser
  if (group === 'assistant') return IconRobot
  if (group === 'tool') return IconTool
  if (group === 'variable') return IconBraces
  return IconMessage
}

function statusLabel(status: StudioModelRequestStatus) {
  if (status === 'pending') return '进行中'
  if (status === 'error') return '错误'
  return '已完成'
}

const responseFormatLabel = computed(() => response.value.format?.toUpperCase() || response.value.status.toUpperCase())

const AnalysisHighlightedText = defineComponent({
  props: {
    value: { type: String, default: '' },
    query: { type: String, default: '' },
  },
  setup(highlightProps) {
    return () => h('span', highlightText(highlightProps.value, highlightProps.query))
  },
})

const AnalysisTextBlock = defineComponent({
  props: {
    label: String,
    value: { type: String, default: '' },
    searchQuery: { type: String, default: '' },
    maxLines: { type: Number, default: 12 },
    forceExpanded: Boolean,
    occurrence: Object as () => ModelRequestOccurrence | undefined,
    compact: Boolean,
  },
  setup(blockProps) {
    const expanded = ref(false)
    const collapsible = ref(false)
    const collapsedHeight = ref('')
    const textElement = ref<HTMLElement>()
    let resizeObserver: ResizeObserver | undefined

    function measureLines() {
      const element = textElement.value
      if (!element) return
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight)
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
        collapsible.value = false
        return
      }
      collapsedHeight.value = `${lineHeight * blockProps.maxLines}px`
      collapsible.value = exceedsAnalysisLineLimit(element.scrollHeight, lineHeight, blockProps.maxLines)
    }

    watch(
      [() => blockProps.value, () => blockProps.maxLines],
      async () => {
        await nextTick()
        measureLines()
      },
    )
    watch(
      [() => blockProps.searchQuery, () => blockProps.forceExpanded],
      ([query, forceExpanded]) => {
        if (shouldExpandAnalysisText(expanded.value, forceExpanded, query, blockProps.value)) expanded.value = true
      },
      { immediate: true },
    )
    onMounted(async () => {
      await nextTick()
      measureLines()
      if (typeof ResizeObserver === 'undefined' || !textElement.value) return
      resizeObserver = new ResizeObserver(measureLines)
      resizeObserver.observe(textElement.value)
    })
    onBeforeUnmount(() => resizeObserver?.disconnect())

    return () => h('section', {
      class: ['chatluna-studio-model-analysis-section', { 'is-collapsed': collapsible.value && !expanded.value, 'is-compact': blockProps.compact }],
    }, [
      blockProps.label && h('strong', blockProps.label),
      h('div', { class: 'chatluna-studio-model-analysis-text-wrap' }, [
        h('pre', {
          ref: textElement,
          style: { '--chatluna-studio-model-analysis-collapse-height': collapsedHeight.value },
        }, blockProps.occurrence
          ? renderModelRequestOccurrence(blockProps.value, blockProps.occurrence)
          : highlightText(blockProps.value, blockProps.searchQuery)),
        collapsible.value && h('button', {
          type: 'button',
          class: 'chatluna-studio-model-analysis-expand',
          onClick: () => { expanded.value = !expanded.value },
        }, [
          expanded.value ? '收起' : `展开全部（${blockProps.value.length} 字符）`,
          h(IconChevronDown, { size: 12, 'aria-hidden': 'true' }),
        ]),
      ]),
    ])
  },
})

const AnalysisContentParts = defineComponent({
  props: {
    parts: { type: Array as () => readonly ModelConversationContentPart[], required: true },
    searchQuery: { type: String, default: '' },
    forceExpanded: Boolean,
  },
  setup(contentProps) {
    const failedImages = ref(new Set<number>())
    const failImage = (index: number) => {
      failedImages.value = new Set([...failedImages.value, index])
    }
    return () => h('div', { class: 'chatluna-studio-model-analysis-parts' }, contentProps.parts.map((part, index) => {
      if (part.kind === 'image' && isPreviewableConversationImage(part.value) && !failedImages.value.has(index)) {
        return h('figure', { key: index, class: 'chatluna-studio-model-analysis-image' }, [
          h('img', {
            src: part.value,
            alt: `请求图片 ${index + 1}`,
            onError: () => failImage(index),
          }),
          h('figcaption', part.mimeType || 'image'),
        ])
      }
      const label = part.kind === 'text' ? undefined : part.kind === 'image' ? '图片加载失败' : part.kind
      return h(AnalysisTextBlock, {
        key: index,
        label,
        value: part.value,
        searchQuery: contentProps.searchQuery,
        forceExpanded: contentProps.forceExpanded,
      })
    }))
  },
})

function highlightText(value: string, query: string) {
  if (!query) return value
  const lower = value.toLocaleLowerCase('zh-CN')
  const nodes: Array<string | ReturnType<typeof h>> = []
  let offset = 0
  while (offset < value.length) {
    const index = lower.indexOf(query, offset)
    if (index < 0) {
      nodes.push(value.slice(offset))
      break
    }
    if (index > offset) nodes.push(value.slice(offset, index))
    nodes.push(h('mark', value.slice(index, index + query.length)))
    offset = index + query.length
  }
  return nodes
}
</script>
