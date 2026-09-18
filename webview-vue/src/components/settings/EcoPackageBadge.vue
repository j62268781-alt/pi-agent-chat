<!--
  Install-state banner for an optional pi ecosystem package (pi-subagents,
  pi-mcp-adapter). Both tabs manage config files that only take effect when
  their package is installed, so each tab states that dependency up front.
-->
<script setup lang="ts">
import { computed } from "vue";
import type { EcosystemPackage } from "@protocol/settings";
import { t } from "@/lib/i18n.ts";

const props = defineProps<{ pkg: EcosystemPackage }>();

const text = computed(() =>
  props.pkg.installed
    ? t("Ecosystem package {0} installed — the config below is active.", props.pkg.name)
    : t(
        "Ecosystem package {0} is NOT installed — the config below is inert. Install with: {1}",
        props.pkg.name,
        props.pkg.installCommand,
      ),
);
</script>

<template>
  <div class="eco-package" :class="{ missing: !pkg.installed }">
    <span class="eco-dot"></span>
    <span class="eco-text">
      {{ text }}
      <code v-if="!pkg.installed" class="eco-cmd">{{ pkg.installCommand }}</code>
    </span>
  </div>
</template>
