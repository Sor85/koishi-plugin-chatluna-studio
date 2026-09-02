<script setup lang="ts">
import type { DialogDescriptionProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { DialogDescription } from 'reka-ui'
import { cn } from '#client/lib/utils'

const props = defineProps<DialogDescriptionProps & { class?: HTMLAttributes['class'] }>()
const delegatedProps = reactiveOmit(props, 'class')
</script>

<template>
  <DialogDescription data-slot="dialog-description" class="studio-dialog-description" v-bind="delegatedProps" :class="cn('text-sm leading-5 text-slate-500 dark:text-slate-400', props.class)">
    <slot />
  </DialogDescription>
</template>

<style scoped>
.studio-dialog-description {
  margin: 0;
}
</style>
