import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import monkey, { cdn, util } from "vite-plugin-monkey";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const iconPath = path.resolve(__dirname, "src/assets/favicon.ico");
const iconBase64 = fs.readFileSync(iconPath, "base64");
const iconDataUrl = `data:image/x-icon;base64,${iconBase64}`;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    monkey({
      entry: "src/main.ts",
      userscript: {
        name: "paipai-watcher",
        version: "1.0",
        icon: iconDataUrl,
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
        fileName: "paipai-watcher.min.user.js",
        externalGlobals: {
          vue: cdn
            .jsdelivr("Vue", "dist/vue.global.prod.js")
            .concat(util.dataUrl(";window.Vue=Vue;")),
          "element-plus": cdn.jsdelivr("ElementPlus", "dist/index.full.min.js"),
        },
      },
    }),
  ],
  build: {
    minify: true,
  },
});
