// 全局状态：当前页面 / 双主题 / 版本。没用 vue-router，切页就靠这个
import { defineStore } from "pinia";
import { getAppVersion, setTitlebarTheme } from "../api/ipc";

export type PageName =
  | "dashboard"
  | "library"
  | "skill-detail"
  | "sync"
  | "dedup"
  | "webdav"
  | "settings"
  | "updater";

export type Theme = "dark" | "light";

const THEME_KEY = "as-theme";

function loadTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "dark" ? "dark" : "light"; // 默认亮色
  } catch {
    return "light";
  }
}

export const useAppStore = defineStore("app", {
  state: () => ({
    activePage: "dashboard" as PageName,
    theme: loadTheme(),
    version: "",
    skillDetailName: "", // 进详情页时带上技能名
  }),
  actions: {
    applyTheme() {
      document.documentElement.dataset.theme = this.theme;
      // Element Plus 的暗色方案认 html.dark，跟项目主题一起切
      document.documentElement.classList.toggle("dark", this.theme === "dark");
    },
    toggleTheme() {
      this.theme = this.theme === "light" ? "dark" : "light";
      try {
        localStorage.setItem(THEME_KEY, this.theme);
      } catch {}
      this.applyTheme();
      setTitlebarTheme(this.theme);
    },
    go(page: PageName) {
      this.activePage = page;
    },
    openSkillDetail(name: string) {
      this.skillDetailName = name;
      this.activePage = "skill-detail";
    },
    async load() {
      this.applyTheme();
      setTitlebarTheme(this.theme); // 启动时把本地记住的主题同步给窗口 overlay
      try {
        this.version = await getAppVersion();
      } catch {
        this.version = "";
      }
    },
  },
});
