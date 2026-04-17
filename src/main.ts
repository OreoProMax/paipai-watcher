import { createApp } from "vue";
import "element-plus/dist/index.css";
import "./style.css";
import App from "./App.vue";

const ROOT_ID = "paipai-watcher-root";

function ensureMountElement(): HTMLElement {
  const existed = document.getElementById(ROOT_ID);
  if (existed !== null) {
    return existed;
  }

  const mountElement = document.createElement("div");
  mountElement.id = ROOT_ID;
  document.body.append(mountElement);
  return mountElement;
}

createApp(App).mount(ensureMountElement());
