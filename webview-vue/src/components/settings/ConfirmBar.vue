<!--
  Inline delete confirmation (legacy `.confirm-bar`): the row becomes a warning
  strip with a solid destructive button, so nothing is ever deleted on the
  first click.
-->
<script setup lang="ts">
import { t } from "@/lib/i18n.ts";

defineProps<{ message: string; confirmLabel: string }>();
defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <div class="confirm-bar">
    <span class="codicon codicon-error confirm-icon"></span>{{ message }}
    <span>
      <button class="btn-sm btn-danger" type="button" @click="$emit('confirm')">
        {{ confirmLabel }}
      </button>
      <button class="btn-icon" type="button" :title="t('Cancel')" @click="$emit('cancel')">
        <span class="codicon codicon-close"></span>
      </button>
    </span>
  </div>
</template>
