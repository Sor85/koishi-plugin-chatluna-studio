<template>
  <div class="chatluna-studio-model-response-preview">
    <section v-for="(content, index) in response.content" :key="`content:${index}`" class="chatluna-studio-model-response-section is-content">
      <header>
        <IconMessage :size="16" aria-hidden="true" />
        <strong>模型输出</strong>
      </header>
      <pre>{{ content }}</pre>
    </section>

    <section v-for="(reasoning, index) in response.reasoning" :key="`reasoning:${index}`" class="chatluna-studio-model-response-section is-reasoning">
      <header>
        <IconBrain :size="16" aria-hidden="true" />
        <strong>思考内容</strong>
      </header>
      <pre>{{ reasoning }}</pre>
    </section>

    <section v-if="response.toolCalls.length" class="chatluna-studio-model-response-section is-tools">
      <header>
        <IconTool :size="16" aria-hidden="true" />
        <strong>工具调用</strong>
        <Badge variant="outline">{{ response.toolCalls.length }}</Badge>
      </header>
      <div class="chatluna-studio-model-response-tool-list">
        <article v-for="tool in response.toolCalls" :key="tool.evidenceId" class="chatluna-studio-model-response-tool">
          <div>
            <strong>{{ tool.name }}</strong>
            <small v-if="tool.id">{{ tool.id }}</small>
          </div>
          <pre v-if="tool.arguments">{{ tool.arguments }}</pre>
        </article>
      </div>
    </section>

    <section v-if="response.toolResults.length" class="chatluna-studio-model-response-section is-tools">
      <header>
        <IconTool :size="16" aria-hidden="true" />
        <strong>工具结果</strong>
        <Badge variant="outline">{{ response.toolResults.length }}</Badge>
      </header>
      <div class="chatluna-studio-model-response-tool-list">
        <article v-for="result in response.toolResults" :key="result.evidenceId" class="chatluna-studio-model-response-tool">
          <div>
            <strong>{{ result.name || '工具结果' }}</strong>
            <small v-if="result.id">{{ result.id }}</small>
          </div>
          <pre v-if="result.content">{{ result.content }}</pre>
        </article>
      </div>
    </section>

    <footer v-if="response.finishReasons.length || usageEntries.length" class="chatluna-studio-model-response-footer">
      <span v-if="response.finishReasons.length">结束原因：{{ response.finishReasons.join('、') }}</span>
      <span v-for="entry in usageEntries" :key="entry[0]">{{ entry[0] }}：{{ entry[1] }}</span>
    </footer>

    <p v-if="response.unrecognizedCount" class="chatluna-studio-model-request-empty">
      有 {{ response.unrecognizedCount }} 个响应事件未被识别，请查看原文核对
    </p>
    <p v-else-if="!hasContent" class="chatluna-studio-model-request-empty">
      未识别到可预览内容，请查看 JSON 原文
    </p>
  </div>
</template>

<script setup lang="ts">
import { IconBrain, IconMessage, IconTool } from '@tabler/icons-vue'
import { computed } from 'vue'
import { Badge } from '#client/components/ui/badge'
import type { ModelConversationResponse } from './conversation'

const props = defineProps<{
  response: ModelConversationResponse
}>()

const USAGE_LABELS = [
  ['inputTokens', '输入'],
  ['outputTokens', '输出'],
  ['reasoningTokens', '推理'],
  ['cachedTokens', '缓存'],
  ['totalTokens', '总 Token'],
] as const

const hasContent = computed(() => Boolean(
  props.response.content.length
  || props.response.reasoning.length
  || props.response.toolCalls.length
  || props.response.toolResults.length
  || props.response.finishReasons.length
  || props.response.usage,
))
const usageEntries = computed(() => USAGE_LABELS.flatMap(([key, label]) => {
  const value = props.response.usage?.[key]
  return value === undefined ? [] : [[label, value] as const]
}))
</script>
