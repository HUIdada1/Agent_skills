// 全局应用状态：当前页面 / 双主题 / 版本号。
// 沿用参考项目模式：不引入 vue-router，页面切换由 Pinia 驱动。
import { defineStore } from "pinia";
import { getAppVersion } from "../api/ipc";

export type PageName =
  | "dashboard"
  | "library"
  | "skill-detail"
  | "sync"
  | "dedup"
  | "settings"
  | "updater";

export type Theme = "dark" | "light";

const THEME_KEY = "as-theme";

function loadTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" ? "light" : "dark"; // D8：默认深色
  } catch {
    return "dark";
  }
}

export const useAppStore = defineStore("app", {
  state: () => ({
    activePage: "dashboard" as PageName,
    theme: loadTheme(),
    version: "",
    skillDetailName: "", // 从技能库进入详情页时携带
  }),
  actions: {
    applyTheme() {
      document.documentElement.dataset.theme = this.theme;
    },
    toggleTheme() {
      this.theme = this.theme === "light" ? "dark" : "light";
      try {
        localStorage.setItem(THEME_KEY, this.theme);
      } catch {
        /* 隐私模式等场景忽略 */
      }
      this.applyTheme();
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
      try {
        this.version = await getAppVersion();
      } catch {
        this.version = "";
      }
    },
  },
});
