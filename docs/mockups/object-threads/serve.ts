import { readdirSync } from "node:fs";

const dir = import.meta.dir;

function routes(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of readdirSync(dir).sort()) {
    const m = f.match(/^0?(\d+)-.*\.html$/);
    if (m) map[String(Number(m[1]))] = f;
  }
  return map;
}

Bun.serve({
  port: 4599,
  fetch(req) {
    const map = routes();
    const path = new URL(req.url).pathname.replace(/\/$/, "").slice(1);
    if (path === "") {
      const index = `<!doctype html><meta charset="utf-8"><title>Object Threads mockups</title>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0e0e0e;color:#eee;font:14px/1.6 system-ui">
<div><h1 style="font-size:15px;font-weight:600">Object Threads mockups</h1><ol style="padding-left:18px">
${Object.entries(map).map(([k, f]) => `<li><a style="color:#8faefc" href="/${k}">${f}</a></li>`).join("")}
</ol></div>`;
      return new Response(index, { headers: { "content-type": "text/html" } });
    }
    const file = map[path];
    if (file) return new Response(Bun.file(`${dir}/${file}`));
    return Response.redirect("/", 302);
  },
});

console.log("mockups on http://localhost:4599");
