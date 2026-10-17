import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DB } from "./db.js";
import { createSqliteRepo } from "./repo/index.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

export function buildApp(db: DB) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  const repo = createSqliteRepo(db);
  app.decorate("repo", repo);

  app.get("/healthz", async () => {
    db.prepare("SELECT 1").get();
    return { status: "ok" };
  });

  app.register(fastifyStatic, { root: publicDir });
  return app;
}
