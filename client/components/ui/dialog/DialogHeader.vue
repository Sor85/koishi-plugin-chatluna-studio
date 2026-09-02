<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '#client/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <header data-slot="dialog-header" class="studio-dialog-header" :class="cn(props.class)">
    <slot />
  </header>
</template>

<style scoped>
.studio-dialog-header {
  display: grid;
  gap: var(--chatluna-studio-secondary-title-gap, 4px);
  padding-right: 32px;
}
</style>
