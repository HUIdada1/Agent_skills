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

// 滚动位置是文档级一份、KeepAlive 不存它。切页不归零的话，旧页的滚动量会
// 残留在新页上：矮页面被浏览器截断滚动量，高页面直接从中间开始显示，看起来
// 就是"页面往上缩、下方错乱"。
function scrollPageTop() {
  window.scrollTo(0, 0);
}

export const useAppStore = defineStore("app", {
  state: () => ({
    activePage: "dashboard" as PageName,
    theme: loadTheme(),
    version: "",
    skillDetailName: "", // 进详情页时带上技能名
    helpOpen: false,     // 全局帮助对话框
    helpSection: "",     // 打开时定位到的帮助小节 id
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
      scrollPageTop();
    },
    openSkillDetail(name: string) {
      this.skillDetailName = name;
      this.activePage = "skill-detail";
      scrollPageTop();
    },
    showHelp(section = "") {
      this.helpSection = section;
      this.helpOpen = true;
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
