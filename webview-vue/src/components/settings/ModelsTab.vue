<!--
  Models tab: a secondary tab row (Providers / OAuth / API Keys) over one body.

  Unlike the legacy module-level `provState`, each pane owns its own editing
  state — but all three stay mounted (`v-show`) so switching between them never
  throws away a half-filled form.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import { t } from "@/lib/i18n.ts";
import { useSettingsStore } from "@/stores/settings.ts";
import ApiKeysPane from "./models/ApiKeysPane.vue";
import OAuthPane from "./models/OAuthPane.vue";
import ProvidersPane from "./models/ProvidersPane.vue";

type ModelsPane = "providers" | "oauth" | "apikeys";

const store = useSettingsStore();
const data = computed(() => store.tabData("models"));

/** `providers` first, matching the legacy default. */
const pane = ref<ModelsPane>("providers");

const panes: ReadonlyArray<{ id: ModelsPane; label: string }> = [
  { id: "providers", label: t("Providers") },
  { id: "oauth", label: t("OAuth") },
  { id: "apikeys", label: t("API Keys") },
];
</script>

<template>
  <div class="models-tabs">
    <div
      v-for="entry in panes"
      :key="entry.id"
      class="models-tab"
      :class="{ active: pane === entry.id }"
      @click="pane = entry.id"
    >
      {{ entry.label }}
    </div>
  </div>
  <div id="models-body">
    <ProvidersPane v-if="data" v-show="pane === 'providers'" :data="data" />
    <OAuthPane v-if="data" v-show="pane === 'oauth'" :data="data" />
    <ApiKeysPane v-if="data" v-show="pane === 'apikeys'" :data="data" />
  </div>
</template>
