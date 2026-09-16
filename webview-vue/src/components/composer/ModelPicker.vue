<!--
  Model popup body: the search box, the provider-grouped list with favourite
  stars, and the thinking-effort row as its last entry.

  Rendered inside `#model-popup` (see `Composer.vue`), so it is a fragment — the
  popup's flex column layout expects these nodes as direct children.
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { RpcModel } from "@protocol/rpc";
import { post } from "@/lib/bridge.ts";
import { t } from "@/lib/i18n.ts";
import { getModelIcon, modelIconHtml } from "@/lib/model-icons.ts";
import { useComposerStore } from "@/stores/composer.ts";
import { useSessionStore } from "@/stores/session.ts";
import ThinkingPicker from "./ThinkingPicker.vue";

const composer = useComposerStore();
const session = useSessionStore();

const searchEl = ref<HTMLInputElement | null>(null);
const listEl = ref<HTMLElement | null>(null);
const highlight = ref(0);

/** `provider/id`, lowercased — the host writes favourites in that form. */
function favoriteKey(model: RpcModel): string {
  return `${model.provider}/${model.id}`.toLowerCase();
}

function isFavorite(model: RpcModel): boolean {
  return session.enabledModelKeys.includes(favoriteKey(model));
}

function label(model: RpcModel): string {
  const name = model.name || model.id;
  return model.provider ? `${name} · ${model.provider}` : name;
}

/** Provider-grouped, matching the legacy `computeFilteredModels`. */
const groups = computed<
  Array<{ provider: string; models: Array<{ model: RpcModel; index: number }> }>
>(() => {
  const query = composer.modelSearch.trim().toLowerCase();
  const matched = session.models
    .map((model, order) => ({ model, order }))
    .filter(({ model }) => {
      if (!query) return true;
      return (
        String(model.name ?? model.id)
          .toLowerCase()
          .includes(query) ||
        model.id.toLowerCase().includes(query) ||
        model.provider.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      const pa = a.model.provider;
      const pb = b.model.provider;
      if (pa !== pb) return pa.localeCompare(pb);
      return a.order - b.order;
    })
    .map((entry) => entry.model);

  // A non-empty favourites list is pi's `enabledModels` allowlist: show only those.
  const visible =
    session.enabledModelKeys.length > 0 ? matched.filter((model) => isFavorite(model)) : matched;

  const out: Array<{ provider: string; models: Array<{ model: RpcModel; index: number }> }> = [];
  visible.forEach((model, index) => {
    const provider = model.provider || t("Other");
    const last = out[out.length - 1];
    if (last && last.provider === provider) last.models.push({ model, index });
    else out.push({ provider, models: [{ model, index }] });
  });
  return out;
});

const visibleCount = computed(() =>
  groups.value.reduce((total, group) => total + group.models.length, 0),
);

function scrollActive(): void {
  listEl.value
    ?.querySelector<HTMLElement>(".model-item.active")
    ?.scrollIntoView({ block: "nearest" });
}

/** Landing highlight: the current model when it is listed, else the first row. */
watch(
  groups,
  () => {
    const current = session.model;
    let index = -1;
    if (current) {
      let position = 0;
      for (const group of groups.value) {
        for (const entry of group.models) {
          if (entry.model.provider === current.provider && entry.model.id === current.id)
            index = position;
          position += 1;
        }
      }
    }
    highlight.value = index >= 0 ? index : 0;
    void nextTick(scrollActive);
  },
  { immediate: true },
);

onMounted(() => {
  searchEl.value?.focus();
});

function choose(model: RpcModel): void {
  post({ type: "setModel", provider: model.provider, modelId: model.id });
  composer.closePopups();
}

function toggleFavorite(model: RpcModel): void {
  post({ type: "toggleFavorite", provider: model.provider, modelId: model.id });
}

function onSearchKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Escape") {
    ev.preventDefault();
    composer.closePopups();
    return;
  }
  const total = visibleCount.value;
  if (total === 0) return;
  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    highlight.value = (highlight.value + 1) % total;
    void nextTick(scrollActive);
  } else if (ev.key === "ArrowUp") {
    ev.preventDefault();
    highlight.value = (highlight.value - 1 + total) % total;
    void nextTick(scrollActive);
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    for (const group of groups.value) {
      const entry = group.models.find((candidate) => candidate.index === highlight.value);
      if (entry) {
        choose(entry.model);
        return;
      }
    }
  }
}
</script>

<template>
  <input
    id="model-search"
    ref="searchEl"
    v-model="composer.modelSearch"
    class="model-search"
    type="text"
    :placeholder="t('Search models…')"
    autocomplete="off"
    @keydown="onSearchKeydown"
  />
  <div id="model-list" ref="listEl" class="model-list">
    <div v-if="session.models.length === 0" class="model-empty">
      {{ t("No models configured") }}
    </div>
    <div v-else-if="visibleCount === 0" class="model-empty">{{ t("No matching models") }}</div>
    <template v-else>
      <template v-for="group in groups" :key="group.provider">
        <div class="model-group-title">{{ group.provider }}</div>
        <div
          v-for="entry in group.models"
          :key="favoriteKey(entry.model)"
          class="model-item"
          :class="{ active: entry.index === highlight }"
          @click="choose(entry.model)"
        >
          <span
            class="model-item-icon"
            v-html="modelIconHtml(getModelIcon(entry.model.name || entry.model.id))"
          ></span>
          <span class="model-item-label">{{ label(entry.model) }}</span>
          <button
            class="model-star"
            :class="{ 'is-on': isFavorite(entry.model) }"
            type="button"
            :title="isFavorite(entry.model) ? t('Remove from favorites') : t('Add to favorites')"
            @click.stop="toggleFavorite(entry.model)"
          >
            <span
              class="codicon"
              :class="isFavorite(entry.model) ? 'codicon-star-full' : 'codicon-star-empty'"
            ></span>
          </button>
        </div>
      </template>
    </template>
  </div>
  <ThinkingPicker />
</template>
