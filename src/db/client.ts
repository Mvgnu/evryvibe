import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
export function connectDatabase(url: string) {
  const client = postgres(url, { max: 5 });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}
export type Database = ReturnType<typeof connectDatabase>["db"];
let connection: ReturnType<typeof connectDatabase> | undefined;
export function database(): Database {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required for database access");
  connection ??= connectDatabase(process.env.DATABASE_URL);
  return connection.db;
}

export async function closeDatabase(): Promise<void> {
  const active = connection;
  connection = undefined;
  await active?.close();
}
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
