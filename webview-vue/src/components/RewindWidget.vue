<!--
  Rewind card: the host sends the modified-file list as a `rewind-files` widget
  (`widgetLines[0]` is the JSON payload) and this component turns it into the
  accept / revert surface.

  Ported from the vanilla-TS bundle (`rewind.ts`: `applyRewindWidget`). The
  parsed rows are written back into `overlays.rewindFiles` so the store stays
  the single source of truth for the card's contents.
-->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { post } from "@/lib/bridge.ts";
import { t } from "@/lib/i18n.ts";
import { basenameOf } from "@/lib/paths.ts";
import { parseRewindWidget } from "@/lib/rewind-parse.ts";
import { useOverlaysStore } from "@/stores/overlays.ts";
import { useSessionStore } from "@/stores/session.ts";

const overlays = useOverlaysStore();
const session = useSessionStore();

/** The card starts collapsed, exactly like the original `rewindCollapsed`. */
const collapsed = ref(true);

const parsed = computed(() => {
  const widget = overlays.widget;
  if (!widget || widget.key !== "rewind-files") return null;
  return parseRewindWidget(widget.lines);
});

watch(
  parsed,
  (value) => {
    overlays.rewindFiles = value ? value.files : [];
    overlays.rewindSessionId = value ? value.sessionId : "";
    // The payload carries one hash per file; the scalar mirrors the first row.
    overlays.rewindBaselineHash = value?.files[0]?.baselineHash ?? null;
  },
  { immediate: true },
);

async function acceptAll(): Promise<void> {
  if (session.isStreaming) {
    overlays.toast(t("Stop the agent before changing files."), "error");
    return;
  }
  post({ type: "rewindAccept" });
}

async function revertAll(): Promise<void> {
  if (session.isStreaming) {
    overlays.toast(t("Stop the agent before reverting."), "error");
    return;
  }
  const count = overlays.rewindFiles.length;
  const accepted = await overlays.askConfirmation(
    t("Revert all {0} file{1}?", count, count === 1 ? "" : "s"),
    t("Files will be restored to their last accepted state. Conversation history is not affected."),
    t("Confirm revert"),
  );
  if (accepted) post({ type: "rewindRevert" });
}

function acceptFile(id: number): void {
  if (session.isStreaming) {
    overlays.toast(t("Stop the agent before changing files."), "error");
    return;
  }
  post({ type: "rewindAcceptFile", id });
}

function revertFile(id: number): void {
  if (session.isStreaming) {
    overlays.toast(t("Stop the agent before reverting."), "error");
    return;
  }
  post({ type: "rewindRevertFile", id });
}

function openDiff(file: { absPath: string; baselineHash: string | null; path: string }): void {
  post({
    type: "rewindDiff",
    absPath: file.absPath,
    baselineHash: file.baselineHash,
    sessionId: overlays.rewindSessionId,
    basename: basenameOf(file.path),
  });
}
</script>

<template>
  <div v-if="parsed" class="rewind-widget" :class="{ 'is-collapsed': collapsed }">
    <div class="widget-card rewind-card">
      <div class="rewind-head">
        <span
          class="rewind-chevron"
          role="button"
          :title="collapsed ? t('Expand') : t('Collapse')"
          @click="collapsed = !collapsed"
        >
          <span class="codicon codicon-chevron-right"></span>
        </span>

        <span class="rewind-title">{{ t("Modified files ({0})", parsed.files.length) }}</span>

        <span class="rewind-totals">
          <span v-if="parsed.totals.added > 0" class="rewind-add">+{{ parsed.totals.added }}</span>
          <span v-if="parsed.totals.removed > 0" class="rewind-removed">
            -{{ parsed.totals.removed }}
          </span>
          <span v-if="parsed.totals.added <= 0 && parsed.totals.removed <= 0">-</span>
        </span>

        <span class="rewind-head-actions">
          <button type="button" class="rewind-btn rewind-accept" @click="acceptAll">
            <span class="codicon codicon-check"></span>
            <span>{{ t("Accept all") }}</span>
          </button>
          <button type="button" class="rewind-btn rewind-revert" @click="revertAll">
            <span class="codicon codicon-discard"></span>
            <span>{{ t("Revert all") }}</span>
          </button>
        </span>
      </div>

      <div v-if="!collapsed" class="rewind-body">
        <div v-for="file in overlays.rewindFiles" :key="file.id" class="rewind-row">
          <span class="rewind-file" :title="file.path" @click="openDiff(file)">
            {{ basenameOf(file.path) }}
          </span>

          <span class="rewind-counts">
            <span v-if="file.added > 0" class="rewind-add">+{{ file.added }}</span>
            <span v-if="file.removed > 0" class="rewind-removed">-{{ file.removed }}</span>
            <span v-if="file.added <= 0 && file.removed <= 0">-</span>
          </span>

          <span class="rewind-row-actions">
            <button
              type="button"
              class="rewind-btn rewind-accept"
              :title="t('Accept')"
              :aria-label="t('Accept')"
              @click="acceptFile(file.id)"
            >
              <span class="codicon codicon-check"></span>
            </button>
            <button
              type="button"
              class="rewind-btn rewind-revert"
              :title="t('Revert')"
              :aria-label="t('Revert')"
              @click="revertFile(file.id)"
            >
              <span class="codicon codicon-discard"></span>
            </button>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
