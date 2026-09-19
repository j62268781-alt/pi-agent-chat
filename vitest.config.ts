import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      // configDefaults.exclude 在 vitest 4 里只有 node_modules 与 .git，
      // 必须 spread 保留再追加，否则会把默认排除项覆盖掉。
      ...configDefaults.exclude,
      // webview-vue 是 workspace 里的独立包，测试由它自己的
      // `webview-vue/vitest.config.ts` 跑（要 vue 插件与它的别名表）。在这里
      // 排除，否则同一份用例会以「宿主侧 node 环境」被再跑一遍。
      "webview-vue/**",
    ],
  },
});
