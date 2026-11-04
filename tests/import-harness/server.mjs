// Local regression fixture only. This file is not an application route or deployed artifact.
import http from "node:http";
import path from "node:path";
import { createServer } from "vite";
const root = process.cwd();
const shim = path.join(root, "tests/import-harness/shims.ts");
const vite = await createServer({
  root,
  configFile: false,
  server: { middlewareMode: true },
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      { find: "@/lib/session", replacement: path.join(root, "tests/import-harness/database.ts") },
      { find: "next/cache", replacement: shim },
      { find: "next/navigation", replacement: shim },
      { find: "server-only", replacement: shim },
      {
        find: "@/app/app/knowledge/import-actions",
        replacement: path.join(root, "tests/import-harness/client-actions.ts"),
      },
      {
        find: "@/app/app/actions",
        replacement: path.join(root, "tests/import-harness/client-actions.ts"),
      },
      { find: "@", replacement: path.join(root, "src") },
    ],
  },
});
const database = await vite.ssrLoadModule("/tests/import-harness/database.ts");
await database.initialize();
const actions = await vite.ssrLoadModule("/src/app/app/knowledge/import-actions.ts");
const review = await vite.ssrLoadModule("/src/app/app/actions.ts");
const templates = await vite.ssrLoadModule("/src/app/app/knowledge/templates/route.ts");
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1:3347");
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        await vite.transformIndexHtml(
          url.pathname,
          '<html lang="en"><head><title>Local import fixture</title></head><body><div id="root"></div><script type="module" src="/tests/import-harness/app.tsx"></script></body></html>',
        ),
      );
      return;
    }
    if (url.pathname.startsWith("/fixture/")) {
      const who = url.pathname.split("/").at(-1);
      if (!database.identities[who]) {
        res.writeHead(400);
        res.end();
        return;
      }
      res.setHeader("Set-Cookie", `fixture=${who}; HttpOnly; SameSite=Strict; Path=/`);
      res.end("fixture selected");
      return;
    }
    if (
      url.pathname.startsWith("/action/") ||
      url.pathname === "/records" ||
      url.pathname === "/app/knowledge/templates"
    ) {
      const who = /fixture=([\w-]+)/.exec(req.headers.cookie ?? "")?.[1];
      if (!database.identities[who]) {
        res.writeHead(401);
        res.end();
        return;
      }
      const result = await database.withIdentity(who, async () => {
        if (url.pathname === "/records") return Response.json(await database.records());
        if (url.pathname === "/app/knowledge/templates") return templates.GET(new Request(url));
        let size = 0;
        const chunks = [];
        for await (const part of req) {
          size += part.length;
          if (size > 3 * 1024 * 1024) throw Error("Body limit");
          chunks.push(part);
        }
        const form = await new Request(url, {
          method: "POST",
          headers: { "Content-Type": req.headers["content-type"] },
          body: Buffer.concat(chunks),
        }).formData();
        const name = url.pathname.split("/").at(-1);
        let data;
        if (name === "inspect") data = await actions.inspectKnowledgeUpload(form);
        else if (name === "validate") data = await actions.validateKnowledgeUpload(form);
        else if (name === "academy") data = await actions.previewAcademy();
        else if (name === "review") data = await review.updateKnowledge({}, form);
        else throw Error("Unknown fixture action");
        return Response.json(data);
      });
      res.writeHead(result.status, Object.fromEntries(result.headers));
      res.end(Buffer.from(await result.arrayBuffer()));
      return;
    }
    vite.middlewares(req, res, () => {
      res.writeHead(404);
      res.end();
    });
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end("Local fixture failure");
  }
});
server.listen(3347, "127.0.0.1", () => console.log("Local isolated import fixture ready"));
