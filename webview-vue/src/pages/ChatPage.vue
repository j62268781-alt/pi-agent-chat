<!--
  Chat webview page.

  NOTE: baseline scaffold. The transcript, composer and popups are ported from
  the legacy vanilla implementation next; this page currently proves the
  host <-> webview protocol round trip.
-->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { onHostMessage, post } from "@/lib/bridge";
import { t } from "@/lib/i18n";
import "@/styles/chat.css";

const connected = ref(false);
const bootError = ref("");

let dispose: (() => void) | undefined;

onMounted(() => {
  dispose = onHostMessage((message) => {
    switch (message.type) {
      case "state":
        connected.value = true;
        break;
      case "sessionFailed":
      case "error":
        bootError.value = message.message;
        break;
      default:
        break;
    }
  });
  post({ type: "webviewReady" });
});

onUnmounted(() => dispose?.());
</script>

<template>
  <div class="app">
    <div class="messages-wrap">
      <div id="messages">
        <div id="messages-inner">
          <p v-if="bootError" class="boot-error-msg">{{ bootError }}</p>
          <p v-else-if="!connected">{{ t("Connecting…") }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
