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
          <div class="chatluna-studio-model-response-tool-header">
            <strong>{{ tool.name }}</strong>
            <small v-if="tool.id">{{ tool.id }}</small>
          </div>
          <div v-if="payloadTree(`call:${tool.evidenceId}`, 'arguments', tool.arguments)" class="chatluna-studio-model-response-tool-payload">
            <ModelRequestJsonTree :node="payloadTree(`call:${tool.evidenceId}`, 'arguments', tool.arguments)!" :open="true" :root="true" :strings-expanded="true" />
          </div>
          <pre v-else-if="tool.arguments">{{ tool.arguments }}</pre>
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
          <div class="chatluna-studio-model-response-tool-header">
            <strong>{{ result.name || '工具结果' }}</strong>
            <small v-if="result.id">{{ result.id }}</small>
          </div>
          <div v-if="payloadTree(`result:${result.evidenceId}`, 'result', result.content)" class="chatluna-studio-model-response-tool-payload">
            <ModelRequestJsonTree :node="payloadTree(`result:${result.evidenceId}`, 'result', result.content)!" :open="true" :root="true" :strings-expanded="true" />
          </div>
          <pre v-else-if="result.content">{{ result.content }}</pre>
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
import { computed, watch } from 'vue'
import { Badge } from '#client/components/ui/badge'
import ModelRequestJsonTree from './json-tree.vue'
import type { ModelConversationResponse } from './conversation'
import { buildModelRequestJsonTree, type ModelRequestJsonNode } from './json'
import { resolveModelRequestToolPayload } from './tool-payload'

const props = defineProps<{
  response: ModelConversationResponse
}>()

/**
 * 工具载荷的结构树按证据身份缓存，与分析视图同一套判定：解析不出结构时给 undefined，
 * 调用处退回原文。每次重渲染现算会换掉节点引用，JSON 树内部的展开态会随之丢失。
 */
let payloadTrees = new Map<string, ModelRequestJsonNode>()
watch(() => props.response, () => { payloadTrees = new Map() })

function payloadTree(cacheKey: string, rootKey: string, value: string | undefined): ModelRequestJsonNode | undefined {
  const cached = payloadTrees.get(cacheKey)
  if (cached) return cached
  const payload = resolveModelRequestToolPayload(value)
  if (payload.kind !== 'json') return undefined
  const tree = buildModelRequestJsonTree(payload.value, rootKey)
  payloadTrees.set(cacheKey, tree)
  return tree
}

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
