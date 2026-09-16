<!--
  One list row: bold name plus badges on the first line, a muted description on
  the second, and an icon-button group on the right.

  Extra attributes (a click handler for expandable rows, a cursor style) fall
  through to the `.item-row` root, which is how the provider rows stay
  clickable without turning the row itself into a button.
-->
<script setup lang="ts">
defineProps<{
  name: string;
  description?: string;
  /** Paints the brand-tinted `.item-row.selected` state. */
  selected?: boolean;
}>();
</script>

<template>
  <div class="item-row" :class="{ selected }">
    <div class="item-main">
      <div class="item-title">
        <span class="item-name">{{ name }}</span>
        <slot name="badges" />
      </div>
      <div v-if="description" class="item-desc">{{ description }}</div>
    </div>
    <div class="item-actions">
      <slot name="actions" />
    </div>
  </div>
</template>
