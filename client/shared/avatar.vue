<template>
  <span :class="['chatluna-studio-identity-avatar', { 'is-bot': kind === 'bot', 'is-group': kind === 'group' }]">
    <img v-if="usableAvatar && !imageFailed" :src="usableAvatar" :alt="alt || name" @error="imageFailed = true">
    <template v-else>{{ initial }}</template>
  </span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  kind: 'user' | 'bot' | 'group'
  name?: string
  avatar?: string
  alt?: string
}>(), {
  name: '',
  avatar: '',
  alt: '',
})

const imageFailed = ref(false)
const usableAvatar = computed(() => {
  const avatar = props.avatar
  // studio-media 不是浏览器可加载的 URL；交给调用方解析成 data URL 后再渲染，避免永久卡在 error 态。
  if (!avatar || avatar.startsWith('studio-media:')) return ''
  return avatar
})
const initial = computed(() => props.name.trim().slice(0, 1).toUpperCase() || '?')

watch(usableAvatar, () => {
  imageFailed.value = false
})
</script>
