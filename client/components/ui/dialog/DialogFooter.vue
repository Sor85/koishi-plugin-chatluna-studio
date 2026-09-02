<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '#client/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <footer data-slot="dialog-footer" class="studio-dialog-footer" :class="cn(props.class)">
    <slot />
  </footer>
</template>

<style scoped>
.studio-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--chatluna-studio-secondary-row-gap, 8px);
  padding-top: var(--chatluna-studio-secondary-row-gap, 8px);
}
</style>
