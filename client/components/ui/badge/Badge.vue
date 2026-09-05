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

/* 暗色钩子照仓库统一的两个作用域写（同 tailwind.source.css 里 dark 变体的定义）：宿主控制台
   没有 .dark 类，只挂 .dark 的规则永远选不中。
   这里也不能用 `:global(.dark) …`：scoped 块里 @vue/compiler-sfc 遇到 :global() 会把整条选择器
   替换成括号里的第一段，编译产物是裸的 `.dark { color; background }`——既漏成全局规则去染控制台里
   任何带 .dark 的元素，又完全丢掉了徽标那一段，暗色配色静默失效。详见 docs/adr/0026。 */
:is([data-color-mode='dark'], body[data-chatluna-studio-color-scheme='dark']) .studio-badge[data-variant='secondary'] {
  color: #cbd5e1;
  background: #334155;
}
</style>
