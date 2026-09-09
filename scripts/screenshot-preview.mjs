import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Documentation fixtures only: never load a user's Store or proxy API requests.
const root = fileURLToPath(new URL("../dist/web/", import.meta.url));
const skills = [
  ["code-review", "Review changes for correctness, clarity, and maintainability.", "engineering", "main", false],
  ["api-design", "Design clear interfaces with practical request and response examples.", "engineering", "draft", true],
  ["web-research", "Compare sources and collect evidence for a research question.", "research", "main", false],
  ["source-check", "Verify claims against primary sources and record citations.", "research", "main", false],
  ["technical-writing", "Write concise guides with runnable examples and clear structure.", "writing", "main", false],
  ["project-notes", "Keep a small, useful record of project decisions and next steps.", "local", "main", true],
].map(([id, description, group, activeBranch, dirty]) => ({
  id, name: id, description, activeBranch, dirty,
  groupKey: group === "local" ? "本地" : `${group}/demo-skills`,
  groupLabel: group === "local" ? "本地" : `${group}/demo-skills`,
}));
const members = [
  { skill: "web-research", mode: "live", ref: "main" },
  { skill: "source-check", mode: "pin", ref: "ver_20260901_abcdef12" },
  { skill: "technical-writing", mode: "live", ref: "main" },
].map(member => ({
  ...member,
  description: skills.find(skill => skill.id === member.skill).description,
  dirty: false,
  missing: false,
}));
const overview = {
  home: "~/.skillcoffer",
  skills,
  bundles: [{ name: "research", memberCount: members.length, dirtyLiveCount: 0 }],
};
const bundle = {
  name: "research",
  path: "~/.skillcoffer/bundles/research",
  members,
  dirtyLiveCount: 0,
  availableSkills: skills.filter(skill => !members.some(member => member.skill === skill.id)).map(skill => skill.id),
  piCommand: "skillcoffer pi research",
  piPrintCommand: "skillcoffer pi research --print",
};
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer(async (req, res) => {
  const json = (status, value) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(value));
  };
  if (req.method !== "GET") return json(405, { error: "This documentation preview is read-only." });
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/api/overview") return json(200, overview);
  if (pathname === "/api/bundles/research") return json(200, bundle);
  if (pathname.startsWith("/api/")) return json(404, { error: "This page is not included in the documentation preview." });
  try {
    const path = resolve(root, `.${decodeURIComponent(pathname)}`);
    if (path !== resolve(root) && !path.startsWith(root.endsWith(sep) ? root : root + sep)) return json(404, { error: "Not found" });
    const file = extname(path) ? path : resolve(root, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    json(404, { error: "Not found. Run npm run build:ui before starting the preview." });
  }
});
server.listen(Number(process.env.SCREENSHOT_PORT ?? 17529), "127.0.0.1", () => {
  console.log(`Documentation preview: http://127.0.0.1:${server.address().port}`);
  console.log("Synthetic fixtures only. Pages: /, /bundles, /bundles/research");
});
