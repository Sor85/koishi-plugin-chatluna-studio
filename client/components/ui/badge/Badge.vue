<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { BadgeVariants } from '.'
import { cn } from '#client/lib/utils'
import { badgeVariants } from '.'

interface Props {
  variant?: BadgeVariants['variant']
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <span
    data-slot="badge"
    :data-variant="variant ?? 'default'"
    class="studio-badge"
    :class="cn(badgeVariants({ variant }), props.class)"
  >
    <slot />
  </span>
</template>

<style scoped>
.studio-badge {
  display: inline-flex;
  flex-shrink: 0;
  height: 18px;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  border: 0;
  border-radius: 5px;
  font-size: var(--chatluna-studio-font-2xs);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

.studio-badge[data-variant='secondary'] {
  color: #64748b;
  background: #e2e8f0;
}

:global(.dark) .studio-badge[data-variant='secondary'] {
  color: #cbd5e1;
  background: #334155;
}
</style>
