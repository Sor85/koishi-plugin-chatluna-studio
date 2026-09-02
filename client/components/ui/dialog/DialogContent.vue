<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { IconX } from '@tabler/icons-vue'
import { reactiveOmit } from '@vueuse/core'
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, useForwardPropsEmits } from 'reka-ui'
import { cn } from '#client/lib/utils'
import { vStudioScrollbar } from '#client/shared/scrollbar'

defineOptions({ inheritAttrs: false })

const props = defineProps<DialogContentProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<DialogContentEmits>()
const delegatedProps = reactiveOmit(props, 'class')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DialogPortal>
    <DialogOverlay data-slot="dialog-overlay" class="fixed inset-0 z-[150] bg-slate-950/35 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out" />
    <DialogContent
      v-chatluna-studio-scrollbar="{ showOverlay: false, zIndex: 160 }"
      data-slot="dialog-content"
      class="studio-dialog-content chatluna-studio-solid-secondary-surface"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="cn(
        'fixed inset-x-0 top-4 z-[151] mx-auto grid max-h-[calc(100vh-32px)] w-[min(520px,calc(100vw-24px))] overflow-y-auto rounded-2xl border p-5 shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out',
        props.class,
      )"
    >
      <slot />
      <DialogClose aria-label="关闭" class="studio-dialog-close absolute right-4 top-4 rounded-md p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--chatluna-studio-accent)]">
        <IconX :size="18" aria-hidden="true" />
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>

<style scoped>
.studio-dialog-content {
  gap: var(--chatluna-studio-secondary-row-gap, 8px);
}
</style>
