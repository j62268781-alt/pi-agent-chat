<!--
  Transient overlays: toasts, the modal dialog pi asks for through
  `extension_ui_request`, the info panel, and the message context menu.
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { post } from "@/lib/bridge.ts";
import { renderMarkdown } from "@/lib/markdown.ts";
import { t } from "@/lib/i18n.ts";
import { useOverlaysStore } from "@/stores/overlays";
import { useSessionStore } from "@/stores/session";

const overlays = useOverlaysStore();
const session = useSessionStore();

// ------------------------------------------------------------------ dialog

const dialogValue = ref("");

const dialogRequest = computed(() => overlays.dialog);

watch(dialogRequest, () => {
  dialogValue.value = String((overlays.dialog?.defaultValue as string | undefined) ?? "");
});

function respondDialog(payload: {
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}): void {
  const request = overlays.dialog;
  if (!request) return;
  overlays.dialog = null;
  post({ type: "dialogResponse", id: request.id, ...payload });
}

const dialogTitle = computed(() => String((overlays.dialog?.title as string | undefined) ?? ""));
const dialogMessage = computed(() =>
  String((overlays.dialog?.message as string | undefined) ?? ""),
);
const dialogOptions = computed<string[]>(() =>
  Array.isArray(overlays.dialog?.options) ? (overlays.dialog.options as string[]) : [],
);
/**
 * pi's permission gate asks via `ui.select(title, ["Allow", "Block"])` — a
 * safety decision that deserves real buttons, not a native `<select>`. Small
 * option sets (≤3) render as a button group; the negative choice ("Block")
 * is styled as the danger action so "allow" is never the accidental default.
 */
const isChoiceDialog = computed(
  () => overlays.dialog?.method === "select" && dialogOptions.value.length > 0,
);
const isDangerous = computed(() => /danger/i.test(dialogTitle.value));

/** Focus the first action button when a choice dialog opens. */
const actionsEl = ref<HTMLElement | null>(null);
watch(dialogRequest, async () => {
  if (!overlays.dialog) return;
  dialogValue.value = String((overlays.dialog?.defaultValue as string | undefined) ?? "");
  await nextTick();
  actionsEl.value?.querySelector<HTMLElement>("button")?.focus();
});

function onDialogKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Escape") {
    ev.preventDefault();
    respondDialog({ cancelled: true });
  }
}

// ------------------------------------------------------------- info panel

function closeInfoPanel(): void {
  overlays.infoPanel = null;
}

// ----------------------------------------------------------- context menu

function onDocumentMouseDown(): void {
  overlays.closeContextMenu();
}

onMounted(() => document.addEventListener("mousedown", onDocumentMouseDown));
onUnmounted(() => document.removeEventListener("mousedown", onDocumentMouseDown));

function menuCopy(): void {
  const menu = overlays.contextMenu;
  if (menu) post({ type: "copy", text: menu.text });
  overlays.closeContextMenu();
}

async function menuFork(): Promise<void> {
  const menu = overlays.contextMenu;
  overlays.closeContextMenu();
  if (!menu || menu.ts == null || session.isStreaming) return;
  const accepted = await overlays.askConfirmation(
    t("Fork from this message?"),
    t("Create a new branch from this message. Current file changes are kept."),
    t("Fork"),
  );
  if (accepted) post({ type: "fork", ts: menu.ts });
}

function menuRevert(): void {
  const menu = overlays.contextMenu;
  overlays.closeContextMenu();
  if (!menu || menu.ts == null || session.isStreaming) return;
  post({ type: "revert", ts: menu.ts });
}
</script>

<template>
  <!-- toasts -->
  <div id="toast-host">
    <div
      v-for="entry in overlays.toasts"
      :key="entry.id"
      class="toast"
      :class="`toast-${entry.kind}`"
      @click="overlays.dismissToast(entry.id)"
    >
      {{ entry.text }}
    </div>
  </div>

  <!-- info panel -->
  <div v-if="overlays.infoPanel" class="overlay" @click.self="closeInfoPanel">
    <div class="info-panel">
      <header class="info-panel-head">
        <span class="info-panel-title">{{ overlays.infoPanel.title }}</span>
        <button class="info-panel-close" type="button" :title="t('Close')" @click="closeInfoPanel">
          <span class="codicon codicon-close"></span>
        </button>
      </header>
      <div
        class="info-panel-body md-body"
        v-html="renderMarkdown(overlays.infoPanel.markdown)"
      ></div>
    </div>
  </div>

  <!-- dialog requested by pi -->
  <div v-if="overlays.dialog" class="overlay">
    <div
      class="dialog"
      :class="{ 'dialog-danger': isDangerous }"
      role="dialog"
      aria-modal="true"
      :data-method="overlays.dialog.method"
      @keydown="onDialogKeydown"
    >
      <h3 v-if="dialogTitle" class="dialog-title">
        <span v-if="isDangerous" class="codicon codicon-warning dialog-warn-icon"></span>
        <span class="dialog-title-text">{{ dialogTitle }}</span>
      </h3>
      <p v-if="dialogMessage" class="dialog-message">{{ dialogMessage }}</p>

      <select
        v-if="overlays.dialog.method === 'select' && !isChoiceDialog"
        v-model="dialogValue"
        class="dialog-select"
      >
        <option v-for="option in dialogOptions" :key="option" :value="option">{{ option }}</option>
      </select>

      <input
        v-else-if="overlays.dialog.method === 'input' || overlays.dialog.method === 'editor'"
        ref="actionsEl"
        v-model="dialogValue"
        class="dialog-input"
        type="text"
        @keydown.enter.prevent="respondDialog({ value: dialogValue, confirmed: true })"
      />

      <footer ref="actionsEl" class="dialog-actions" :class="{ 'choice-group': isChoiceDialog }">
        <template v-if="isChoiceDialog">
          <button
            v-for="(option, index) in dialogOptions"
            :key="option"
            class="btn choice-btn"
            :class="{
              'choice-allow': /allow|yes|accept/i.test(option),
              'choice-block':
                /block|no|deny|cancel/i.test(option) || index === dialogOptions.length - 1,
            }"
            type="button"
            @click="respondDialog({ value: option, confirmed: true })"
          >
            {{ option }}
          </button>
        </template>
        <template v-else>
          <button class="btn" type="button" @click="respondDialog({ cancelled: true })">
            {{ t("Cancel") }}
          </button>
          <button
            class="btn btn-primary"
            type="button"
            @click="
              respondDialog(
                overlays.dialog.method === 'confirm'
                  ? { confirmed: true }
                  : { value: dialogValue, confirmed: true },
              )
            "
          >
            {{ overlays.dialog.method === "confirm" ? t("Confirm") : t("OK") }}
          </button>
        </template>
      </footer>
    </div>
  </div>

  <!-- message context menu -->
  <div
    v-if="overlays.contextMenu"
    id="ctx-menu"
    :style="{ left: `${overlays.contextMenu.x}px`, top: `${overlays.contextMenu.y}px` }"
  >
    <button class="ctx-item" type="button" @click="menuCopy">{{ t("Copy") }}</button>
    <button class="ctx-item" type="button" @click="menuFork">{{ t("Fork from here") }}</button>
    <button class="ctx-item" type="button" @click="menuRevert">{{ t("Revert here") }}</button>
  </div>
</template>
