import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("Set DATABASE_URL before running migrations.");
const client = postgres(databaseUrl, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("EVRYVIBE migrations applied.");
} finally {
  await client.end();
}
