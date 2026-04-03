import { homedir } from "node:os";

export function slugify(text: string, maxLength = 50): string {
  const slug = text
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) return "note";
  return slug.slice(0, maxLength).replace(/-+$/, "");
}

export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${h}${min}`;
}

export function generateFilename(title: string, date = new Date()): string {
  const slug = slugify(title);
  return `${formatDate(date)}-${formatTime(date)}-${slug}.md`;
}

export function expandHome(filepath: string): string {
  if (filepath.startsWith("~/")) {
    return filepath.replace("~", homedir());
  }
  if (filepath === "~") {
    return homedir();
  }
  return filepath;
}
