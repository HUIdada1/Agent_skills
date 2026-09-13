// 全局状态：当前页面 / 双主题 / 版本。没用 vue-router，切页就靠这个
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
    return t === "light" ? "light" : "dark"; // 默认深色
  } catch {
    return "dark";
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
    },
    toggleTheme() {
      this.theme = this.theme === "light" ? "dark" : "light";
      try {
        localStorage.setItem(THEME_KEY, this.theme);
      } catch {}
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
