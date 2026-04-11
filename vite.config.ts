import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import monkey, { cdn } from "vite-plugin-monkey";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    monkey({
      entry: "src/main.ts",
      userscript: {
        name: "paipai-watcher",
        version: "0.1",
        icon: "https://ydcx.360buyimg.com/favicon.ico",
        match: ["https://paipai.m.jd.com/ppinspect/*"],
        author: "OreoProMax",
        license: "GLWTPL",
        namespace: "https://github.com/OreoProMax/paipai-watcher",
        updateURL:
          "https://raw.githubusercontent.com/OreoProMax/paipai-watcher/master/dist/paipai-watcher.min.user.js",
        downloadURL:
          "https://raw.githubusercontent.com/OreoProMax/paipai-watcher/master/dist/paipai-watcher.min.user.js",
        supportURL: "https://github.com/OreoProMax/paipai-watcher/issues",
      },
      build: {
        externalGlobals: {
          vue: cdn.jsdelivr("Vue", "dist/vue.global.prod.js"),
          "element-plus": cdn.jsdelivr("ElementPlus", "dist/index.full.min.js"),
        },
      },
    }),
  ],
});
