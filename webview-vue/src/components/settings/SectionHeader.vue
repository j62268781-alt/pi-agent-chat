<!--
  Page/section header: a 14px title on the left and an action group on the
  right. Mirrors the legacy `.section-header` markup so `settings.css` applies
  unchanged. The first `h3` of a tab is promoted to 16px by CSS.
-->
<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
  <div class="section-header">
    <h3>{{ title }}</h3>
    <div class="header-actions">
      <slot />
    </div>
  </div>
</template>
