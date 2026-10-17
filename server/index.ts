import { buildApp } from "./app.js";
import { openDb } from "./db.js";

const db = openDb();
const app = buildApp(db);
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => app.close().finally(() => { db.close(); process.exit(0); }));
}
