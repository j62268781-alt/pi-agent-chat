<!--
  Boot splash: covers the empty transcript until the first history/event lands,
  and doubles as the failure card when the sidebar cannot start a session (the
  retry button asks the host to spawn one).
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import piLogoSvg from "../../../resources/icon.svg?raw";
import { post } from "@/lib/bridge.ts";
import { t } from "@/lib/i18n.ts";
import { bootFailure, isBooting } from "@/composables/useHostLink.ts";

const retrying = ref(false);

/** Once the failure card is up it stays up until a retry succeeds. */
const failed = computed(() => bootFailure.value.length > 0);
const visible = computed(() => failed.value || isBooting.value);

function retry(): void {
  retrying.value = true;
  bootFailure.value = "";
  post({ type: "startSession" });
}
</script>

<template>
  <div
    id="boot-splash"
    :class="{ 'is-done': !visible }"
    :style="{ display: visible ? 'flex' : 'none' }"
  >
    <div class="boot-card" :class="{ 'is-failed': failed }">
      <div class="boot-logo" v-html="piLogoSvg"></div>
      <div v-if="!failed" class="boot-dots"><span></span><span></span><span></span></div>
      <div v-if="failed" id="boot-error">
        <p id="boot-error-msg">{{ bootFailure || t("Failed to start the session.") }}</p>
        <button id="boot-retry" type="button" :disabled="retrying" @click="retry">
          {{ t("Retry") }}
        </button>
      </div>
    </div>
  </div>
</template>
