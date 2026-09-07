import fs from "node:fs";
import path from "node:path";
import express from "express";
import { describe, expect, it } from "vitest";

const SOURCE_DIRS = ["server", "api"];
const ROUTE_CALL = /\b(?:app|router)\s*\.\s*(?:get|post|put|patch|delete|all|use)\(\s*"([^"]*)"/g;

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.isFile() && full.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

function collectRoutePaths(): Array<{ file: string; routePath: string }> {
  const found: Array<{ file: string; routePath: string }> = [];
  for (const dir of SOURCE_DIRS) {
    const root = path.resolve(process.cwd(), dir);
    if (!fs.existsSync(root)) {
      continue;
    }
    for (const file of collectTsFiles(root)) {
      const source = fs.readFileSync(file, "utf-8");
      for (const match of source.matchAll(ROUTE_CALL)) {
        found.push({ file: path.relative(process.cwd(), file), routePath: match[1] });
      }
    }
  }
  return found;
}

const routePaths = collectRoutePaths();

describe("express route patterns", () => {
  it("discovers the registered route paths", () => {
    expect(routePaths.length).toBeGreaterThan(50);
  });

  it("registers every route path on the installed express version", () => {
    const rejected: string[] = [];
    for (const { file, routePath } of routePaths) {
      const router = express.Router();
      try {
        router.get(routePath, (_req, res) => {
          res.end();
        });
      } catch (err) {
        rejected.push(`${file}: "${routePath}" (${(err as Error).message})`);
      }
    }
    expect(rejected).toEqual([]);
  });

  it("keeps a SPA fallback in server/index.ts that matches the root and nested paths", async () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "server/index.ts"), "utf-8");
    const match = source.match(
      /app\.get\(\s*"([^"]*)",\s*\(req, res\) => \{\s*\n\s*if \(indexTemplate/,
    );
    expect(match).not.toBeNull();

    const app = express();
    app.get(match![1], (req, res) => {
      res.status(200).type("text/plain").send(req.path);
    });

    const server = app.listen(0);
    try {
      const address = server.address();
      expect(address).not.toBeNull();
      const port = (address as { port: number }).port;
      for (const requestPath of ["/", "/search", "/acme/loc-1", "/business/reservations"]) {
        const response = await fetch(`http://127.0.0.1:${port}${requestPath}`);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(requestPath);
      }
    } finally {
      server.close();
    }
  });
});
