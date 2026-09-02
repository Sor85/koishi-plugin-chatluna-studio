<template>
  <div
    ref="nodeElement"
    class="chatluna-studio-model-request-json-node"
    :class="{ 'is-root': root, 'is-nested': !root, 'is-highlighted': isHighlighted }"
    :data-kind="node.kind"
    :data-value-kind="node.valueKind"
    :data-json-path="node.path.join('.')"
  >
    <template v-if="node.kind === 'value'">
      <template v-if="imageSource && imageView === 'image'">
        <div class="chatluna-studio-model-request-json-image-node">
          <div class="chatluna-studio-model-request-json-image-row">
            <span v-if="showKey" class="chatluna-studio-model-request-json-key">{{ node.key }}</span>
            <span v-if="showKey" class="chatluna-studio-model-request-json-sep">:</span>
            <span class="chatluna-studio-model-request-json-image-summary">image - {{ formatModelRequestJsonImageSize(imageSource.source) }}</span>
            <button
              type="button"
              class="chatluna-studio-model-request-json-image-mode"
              aria-label="切换为原始 Base64"
              @click.stop="imageView = 'raw'"
            >raw</button>
            <button
              v-if="isHighlighted && highlightActionLabel"
              type="button"
              class="chatluna-studio-model-request-json-image-mode"
              @click.stop="$emit('highlight-action')"
            >{{ highlightActionLabel }}</button>
          </div>
          <figure class="chatluna-studio-model-request-json-image-preview">
            <img
              class="chatluna-studio-model-request-json-image"
              :src="imageSource.source"
              :alt="`${node.key} 图片预览`"
              loading="lazy"
              decoding="async"
              @error="imageView = 'raw'"
            >
          </figure>
        </div>
      </template>
      <div
        v-else
        class="chatluna-studio-model-request-json-row chatluna-studio-model-request-json-leaf"
        @pointerdown="startRowPointer"
        @pointerup="finishRowPointer"
        @click.stop="toggleStringFromRow"
      >
        <span v-if="showKey" class="chatluna-studio-model-request-json-key">{{ node.key }}</span>
        <span v-if="showKey" class="chatluna-studio-model-request-json-sep">:</span>
        <span
          v-if="node.valueKind === 'string'"
          class="chatluna-studio-model-request-json-string"
          :class="{ 'is-expanded': stringExpanded }"
        >
          <span v-if="stringExpanded" class="chatluna-studio-model-request-json-string-expanded">{{ expandedString }}</span>
          <span v-else>{{ node.preview }}</span>
        </span>
        <span v-else class="chatluna-studio-model-request-json-value">{{ node.preview }}</span>
        <button
          v-if="node.valueKind === 'string'"
          type="button"
          class="chatluna-studio-model-request-json-toggle chatluna-studio-model-request-json-string-toggle"
          :aria-label="stringExpanded ? '收起字符串' : '展开字符串'"
          :aria-expanded="stringExpanded"
          @click.stop="toggleString"
        >
          <IconChevronDown v-if="stringExpanded" :size="14" aria-hidden="true" />
          <IconChevronRight v-else :size="14" aria-hidden="true" />
        </button>
        <button
          v-if="imageSource"
          type="button"
          class="chatluna-studio-model-request-json-image-mode"
          aria-label="切换为图片"
          @click.stop="imageView = 'image'"
        >image</button>
        <button
          v-if="isHighlighted && highlightActionLabel"
          type="button"
          class="chatluna-studio-model-request-json-image-mode"
          @click.stop="$emit('highlight-action')"
        >{{ highlightActionLabel }}</button>
      </div>
    </template>

    <template v-else>
      <div
        class="chatluna-studio-model-request-json-row chatluna-studio-model-request-json-branch"
        @pointerdown="startRowPointer"
        @pointerup="finishRowPointer"
        @click.stop="toggleBranchFromRow"
      >
        <button
          type="button"
          class="chatluna-studio-model-request-json-toggle"
          :aria-label="expanded ? '收起结构' : '展开结构'"
          :aria-expanded="expanded"
          @click.stop="expanded = !expanded"
        >
          <IconChevronDown v-if="expanded" :size="14" aria-hidden="true" />
          <IconChevronRight v-else :size="14" aria-hidden="true" />
        </button>
        <span v-if="showKey" class="chatluna-studio-model-request-json-key">{{ node.key }}</span>
        <span v-if="showKey" class="chatluna-studio-model-request-json-sep">:</span>
        <span class="chatluna-studio-model-request-json-bracket">{{ openingBracket }}</span>
        <span v-if="!expanded" class="chatluna-studio-model-request-json-preview">{{ node.preview }}</span>
        <span v-if="!expanded" class="chatluna-studio-model-request-json-bracket">{{ closingBracket }}</span>
        <button
          v-if="isHighlighted && highlightActionLabel"
          type="button"
          class="chatluna-studio-model-request-json-image-mode"
          @click.stop="$emit('highlight-action')"
        >{{ highlightActionLabel }}</button>
      </div>

      <div v-if="expanded" class="chatluna-studio-model-request-json-content">
        <div v-if="node.children.length" class="chatluna-studio-model-request-json-children">
          <ModelRequestJsonTree
            v-for="child in node.children"
            :key="`${node.key}:${child.key}`"
            :node="child"
            :open="open"
            :parent-kind="node.kind"
            :strings-expanded="stringsExpanded"
            :images-preview="imagesPreview"
            :highlight-path="highlightPath"
            :highlight-action-label="highlightActionLabel"
            @highlight-action="$emit('highlight-action')"
          />
        </div>
        <span class="chatluna-studio-model-request-json-closing">{{ closingBracket }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { IconChevronDown, IconChevronRight } from '@tabler/icons-vue'
import { computed, nextTick, ref, watch } from 'vue'
import type { ModelRequestJsonKind, ModelRequestJsonNode } from './json'
import {
  createModelRequestJsonRow,
  formatModelRequestJsonImageSize,
} from './json-row'

defineOptions({ name: 'ModelRequestJsonTree' })

const props = withDefaults(defineProps<{
  node: ModelRequestJsonNode
  open?: boolean
  parentKind?: ModelRequestJsonKind
  root?: boolean
  stringsExpanded?: boolean
  imagesPreview?: boolean
  highlightPath?: readonly string[]
  highlightActionLabel?: string
}>(), {
  open: true,
  root: false,
  stringsExpanded: false,
  imagesPreview: false,
})

defineEmits<{
  'highlight-action': []
}>()

const nodeElement = ref<HTMLElement>()

const showKey = computed(() => !props.root && props.parentKind !== 'array')
const openingBracket = computed(() => props.node.kind === 'array' ? '[' : '{')
const closingBracket = computed(() => props.node.kind === 'array' ? ']' : '}')
const imageSource = computed(() => props.imagesPreview ? props.node.imageSource : undefined)
const isHighlighted = computed(() => {
  const target = props.highlightPath
  return Boolean(target)
    && target?.length === props.node.path.length
    && target.every((part, index) => part === props.node.path[index])
})

const {
  expanded,
  imageView,
  stringExpanded,
  expandedString,
  toggleString,
  startPointer: startRowPointer,
  finishPointer: finishRowPointer,
  toggleStringFromRow,
  toggleBranchFromRow,
} = createModelRequestJsonRow({
  value: () => props.node.value,
  valueKind: () => props.node.valueKind,
  stringsExpanded: () => props.stringsExpanded,
  hasImage: () => Boolean(imageSource.value),
  open: () => props.open,
})

watch(isHighlighted, async (highlighted) => {
  if (!highlighted) return
  await nextTick()
  window.requestAnimationFrame(() => {
    // 消息对象可能比可视区更高，使用 start 才能稳定露出 role/user 和正文开头；
    // center 会把超高节点的中段居中，看起来像没有定位到目标字段。
    nodeElement.value?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
  })
}, { immediate: true })
</script>
