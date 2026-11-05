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
      { find: "next/link", replacement: path.join(root, "tests/import-harness/link.tsx") },
      { find: "server-only", replacement: shim },
      {
        find: "@/app/app/knowledge/import-actions",
        replacement: path.join(root, "tests/import-harness/client-actions.ts"),
      },
      {
        find: "@/app/app/actions",
        replacement: path.join(root, "tests/import-harness/client-actions.ts"),
      },
      {
        find: "@/app/app/knowledge/gateway-actions",
        replacement: path.join(root, "tests/import-harness/client-actions.ts"),
      },
      {
        find: "@/app/app/learning/knowledge-actions",
        replacement: path.join(root, "tests/import-harness/client-actions.ts"),
      },
      {
        find: "@/app/app/learning/progress-actions",
        replacement: path.join(root, "tests/import-harness/client-actions.ts"),
      },
      {
        find: "@/app/app/fetch-actions",
        replacement: path.join(root, "tests/import-harness/client-actions.ts"),
      },
      {
        find: "@/app/app/knowledge/draft-actions",
        replacement: path.join(root, "tests/import-harness/client-actions.ts"),
      },
      {
        find: "@/app/(auth)/actions",
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
const gateway = await vite.ssrLoadModule("/src/app/app/knowledge/gateway-actions.ts");
const learning = await vite.ssrLoadModule("/src/app/app/learning/knowledge-actions.ts");
const pathData = await vite.ssrLoadModule("/src/lib/knowledge/learning.ts");
const progress = await vite.ssrLoadModule("/src/app/app/learning/progress-actions.ts");
const learningData = await vite.ssrLoadModule("/src/lib/learning/read-model.ts");
const workspaceData = await vite.ssrLoadModule("/src/lib/workspace-data.ts");
const knowledgeFetch = await vite.ssrLoadModule("/src/app/app/fetch-actions.ts");
const memberData = await vite.ssrLoadModule("/src/lib/member-management.ts");
const draftData = await vite.ssrLoadModule("/src/lib/knowledge/draft-manager.ts");
const drafts = await vite.ssrLoadModule("/src/app/app/knowledge/draft-actions.ts");
const recordData = await vite.ssrLoadModule("/src/lib/knowledge/record.ts");
const templates = await vite.ssrLoadModule("/src/app/app/knowledge/templates/route.ts");
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1:3347");
    if (url.pathname === "/home") {
      const who = /fixture=([\w-]+)/.exec(req.headers.cookie ?? "")?.[1];
      res.writeHead(307, { Location: database.identities[who] ? "/app" : "/marketing" });
      res.end();
      return;
    }
    if (
      url.pathname === "/" ||
      url.pathname === "/universal" ||
      url.pathname === "/marketing" ||
      url.pathname === "/app" ||
      url.pathname === "/app/knowledge" ||
      url.pathname === "/app/learning" ||
      url.pathname === "/app/progression" ||
      url.pathname === "/app/analytics" ||
      /^\/app\/(knowledge|learning)\/[\da-f-]+$/.test(url.pathname)
    ) {
      res.setHeader("Content-Type", "text/html");
      res.end(
        await vite.transformIndexHtml(
          url.pathname,
          '<html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Local import fixture</title></head><body><div id="root"></div><script type="module" src="/tests/import-harness/app.tsx"></script></body></html>',
        ),
      );
      return;
    }
    if (url.pathname.startsWith("/fixture/")) {
      const who = url.pathname.split("/").at(-1);
      if (who === "logout") {
        res.setHeader("Set-Cookie", "fixture=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
        res.end("synthetic fixture signed out");
        return;
      }
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
      [
        "/records",
        "/paths",
        "/me",
        "/record-data",
        "/path-data",
        "/learning-data",
        "/progress-data",
        "/analytics-data",
        "/draft-data",
        "/recent-uploads",
      ].includes(url.pathname) ||
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
        if (url.pathname === "/paths") return Response.json(await database.paths());
        if (url.pathname === "/me") return Response.json({ role: await database.fixtureRole() });
        if (url.pathname === "/record-data")
          return Response.json(await recordData.loadKnowledgeRecord(url.searchParams.get("id")));
        if (url.pathname === "/path-data")
          return Response.json(await pathData.loadLearningPath(url.searchParams.get("id")));
        if (url.pathname === "/learning-data")
          return Response.json(
            await learningData.loadLearningWorkspace(url.searchParams.get("id")),
          );
        if (url.pathname === "/progress-data")
          return Response.json(await workspaceData.readWorkspaceProgress());
        if (url.pathname === "/draft-data")
          return Response.json(await draftData.loadDraftManager());
        if (url.pathname === "/analytics-data") {
          const ws = await database.requireWorkspace();
          if (ws.role !== "owner") return new Response("Owner access required", { status: 403 });
          const filters = Object.fromEntries(
            ["from", "to", "member", "path"].map((key) => [key, url.searchParams.get(key) ?? ""]),
          );
          const result = await workspaceData.readWorkspaceProgress(filters);
          const options = await workspaceData.readWorkspaceProgress();
          const settings = await memberData.getAccountSettings();
          return Response.json({
            ...result,
            options: options.rows,
            members: settings.members,
            filters,
            events: [],
            governance: url.searchParams.get("tab") === "governance",
          });
        }
        if (url.pathname === "/recent-uploads")
          return Response.json(await gateway.listGatewayUploads());
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
        else if (name === "course-create") data = await review.createCourse({}, form);
        else if (name === "gateway-upload") data = await gateway.uploadGatewaySource(form);
        else {
          const input = JSON.parse(form.get("payload"));
          if (name === "gateway-load") data = await gateway.loadGatewayUpload(input);
          else if (name === "gateway-review") data = await gateway.saveGatewayReview(input);
          else if (name === "gateway-save") data = await gateway.commitGatewayUpload(input);
          else if (name === "gateway-edit") data = await gateway.updateGatewayKnowledge(input);
          else if (name === "gateway-approve") data = await gateway.approveGatewayKnowledge(input);
          else if (name === "gateway-discard") data = await gateway.discardGatewayUpload(input);
          else if (name === "path-add") data = await learning.addApprovedKnowledge(input);
          else if (name === "learning-publish")
            data = await progress.publishLearningRevision(input);
          else if (name === "learning-draft") data = await progress.beginLearningRevision(input);
          else if (name === "learning-progress")
            data = await progress.recordLearningProgress(input);
          else if (name === "knowledge-fetch") data = await knowledgeFetch.fetchKnowledge(input);
          else if (name === "draft-discard") data = await drafts.discardDraftGroup(input);
          else throw Error("Unknown fixture action");
        }
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
