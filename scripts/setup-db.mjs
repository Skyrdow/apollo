import { createClient } from "@libsql/client";
import { readFile } from "node:fs/promises";

const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error("Define TURSO_DATABASE_URL before setting up the database.");

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const schema = await readFile(new URL("../turso/schema.sql", import.meta.url), "utf8");
for (const statement of schema.split(";").map(part => part.trim()).filter(Boolean)) {
  await client.execute(statement);
}
await client.close();
console.log("Turso schema ready.");
