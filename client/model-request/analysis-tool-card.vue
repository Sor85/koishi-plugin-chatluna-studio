<template>
  <article
    :id="id"
    class="chatluna-studio-model-analysis-card is-tool-call"
    :class="{
      'is-collapsed': isCollapsed,
      'is-located': isLocated,
      'is-muted': isMuted,
    }"
  >
    <header
      @mousedown="preventHeaderDoubleClickSelection"
      @click="toggleFromHeader"
    >
      <span class="chatluna-studio-model-analysis-role">TOOL CALL</span>
      <span class="chatluna-studio-model-analysis-tool-card-name">
        <AnalysisHighlightedText :value="title" :query="query" />
      </span>
      <span class="chatluna-studio-model-analysis-tool-card-id">
        <AnalysisHighlightedText :value="callId || '无调用 ID'" :query="query" />
      </span>
      <span class="chatluna-studio-model-analysis-chars">{{ characters }} chars</span>
      <!-- 定义入口属于卡片操作，不在正文下方另起一行，避免抬高底部的展开按钮。 -->
      <Button
        v-if="showLocateTool"
        variant="ghost"
        size="xs"
        class="chatluna-studio-model-analysis-locate-tool"
        aria-label="查看工具定义"
        title="查看工具定义"
        @click.stop="emit('locate-tool')"
      >
        <IconFileCode data-icon="inline-start" aria-hidden="true" />
        <span>查看工具定义</span>
      </Button>
      <button
        type="button"
        :aria-expanded="!isCollapsed"
        :aria-label="isCollapsed ? '展开工具调用卡片' : '收起工具调用卡片'"
        @click.stop="emit('toggle')"
      >
        <IconChevronDown :size="16" aria-hidden="true" />
      </button>
    </header>
    <div v-show="!isCollapsed" class="chatluna-studio-model-analysis-formatted">
      <AnalysisContentBlock
        v-if="payload"
        :value="text"
        :force-expanded="forceExpanded"
        compact
      >
        <div class="chatluna-studio-model-analysis-tool-payload">
          <ModelRequestJsonTree :node="payload" :open="true" :root="true" :strings-expanded="treeStringsExpanded" />
        </div>
      </AnalysisContentBlock>
      <AnalysisContentBlock
        v-else
        :value="text"
        :search-query="query"
        :force-expanded="forceExpanded"
        compact
      />
    </div>
  </article>
</template>

<script setup lang="ts">
import { IconChevronDown, IconFileCode } from '@tabler/icons-vue'
import { Button } from '../components/ui/button'
import ModelRequestJsonTree from './json-tree.vue'
import { AnalysisContentBlock, AnalysisHighlightedText } from './analysis-content-block'
import type { ModelRequestJsonNode } from './json'

defineProps<{
  id: string
  title: string
  callId?: string
  characters: number
  text: string
  query: string
  payload?: ModelRequestJsonNode
  treeStringsExpanded?: boolean
  forceExpanded?: boolean
  isLocated?: boolean
  isCollapsed?: boolean
  isMuted?: boolean
  showLocateTool?: boolean
}>()

const emit = defineEmits<{
  toggle: []
  'locate-tool': []
}>()

function preventHeaderDoubleClickSelection(event: MouseEvent) {
  if (event.detail < 2) return
  if (event.target instanceof Element && event.target.closest('button')) return
  event.preventDefault()
}

function toggleFromHeader(event: MouseEvent) {
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed) return
  if (event.target instanceof Element && event.target.closest('button')) return
  emit('toggle')
}
</script>
