// 展示格式化工具

/** 字节数 → 可读大小 */
export function fmtSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

/** 时间戳 → MM-DD HH:mm */
export function fmtTime(ms: number | string | null | undefined): string {
  if (!ms) return "—";
  const d = typeof ms === "number" ? new Date(ms) : new Date(ms);
  if (isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** ISO 时间 → YYYY-MM-DD */
export function fmtDate(iso: string | number | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 哈希缩略：前 8 位 */
export function shortHash(h: string | undefined): string {
  return h ? h.slice(0, 8) + "…" : "—";
}
