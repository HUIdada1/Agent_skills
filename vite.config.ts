import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// 端口 1420 跟 main.cjs 里保持一致；base 相对路径，Electron 用 file:// 加载
export default defineConfig({
  plugins: [vue()],
  base: "./",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: ["es2021", "chrome100"],
    minify: "esbuild",
    sourcemap: false,
    outDir: "dist",
  },
});
