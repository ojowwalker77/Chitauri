// FILE: measure-critical-path.mjs
// Purpose: Measure the static-import closure (bytes a browser must download and
//          parse before an entry can run) for the web app's boot path and key
//          routes, so bundle regressions are caught with a number instead of a
//          vibe. Run `bun run build` in apps/web first.
// Usage: node scripts/measure-critical-path.mjs
import fs from "node:fs";
import path from "node:path";
const dir = path.join(process.cwd(), "apps/web/dist/assets");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
const size = new Map(files.map((f) => [f, fs.statSync(path.join(dir, f)).size]));
// rolldown emits `from"./x.js"` and bare `import"./x.js"`; dynamic is `import("./x.js")`
function staticImports(code) {
  const out = new Set();
  let m;
  const a = /from"\.\/([^"]+\.js)"/g;
  while ((m = a.exec(code))) out.add(m[1]);
  const b = /(?:^|[;\n}])import"\.\/([^"]+\.js)"/g;
  while ((m = b.exec(code))) out.add(m[1]);
  return [...out];
}
const importsOf = new Map(
  files.map((f) => [f, staticImports(fs.readFileSync(path.join(dir, f), "utf8"))]),
);
function closure(entries) {
  const seen = new Set();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop();
    if (!f || seen.has(f) || !size.has(f)) continue;
    seen.add(f);
    for (const n of importsOf.get(f) ?? []) stack.push(n);
  }
  return seen;
}
const results = {};
function report(label, entries) {
  const present = entries.filter((f) => size.has(f));
  if (!present.length) return console.log(`${label.padEnd(24)} (not found)`);
  const set = closure(present);
  const bytes = [...set].reduce((s, f) => s + size.get(f), 0);
  results[label] = bytes;
  console.log(
    `${label.padEnd(24)} ${(bytes / 1024).toFixed(0).padStart(6)} kB  ${set.size} chunks`,
  );
}
const find = (p) => files.filter((f) => f.startsWith(p));
const html = fs.readFileSync(path.join(process.cwd(), "apps/web/dist/index.html"), "utf8");
const entry = [...html.matchAll(/\/assets\/([^"]+\.js)/g)].map((m) => m[1]);
report("boot", entry);
report("/_chat layout", [...entry, ...find("_chat-")]);
report("/_chat/$threadId", [...entry, ...find("_chat-"), ...find("_chat._threadId-")]);
report("/_chat/github", [...entry, ...find("_chat-"), ...find("_chat.github-")]);
report("/_chat/settings", [...entry, ...find("_chat-"), ...find("_chat.settings-")]);
// Match the actual <link>, not a mention of the host in a comment.
const blockingWebfont = /<link[^>]+fonts\.googleapis\.com/.test(html);
console.log(`${"webfont CDN link".padEnd(24)} ${blockingWebfont ? "BLOCKING" : "none"}`);
