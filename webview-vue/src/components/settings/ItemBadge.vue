<!--
  A `.badge` chip. `variant` picks one of the soft-fill palettes declared in
  `settings.css` (`user`, `project`, `builtin`, `package`, `cli`, `stdio`,
  `http`, `other`, `disabled`).
-->
<script setup lang="ts">
defineProps<{ label: string; variant?: string }>();
</script>

<template>
  <span class="badge" :class="variant ? `badge-${variant}` : undefined">{{ label }}</span>
</template>
