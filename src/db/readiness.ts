import postgres from "postgres";

// Use a short-lived connection so a stalled probe cannot occupy the app pool.
export async function databaseReady(): Promise<boolean> {
  if (!process.env.DATABASE_URL || process.env.EVRYVIBE_DEMO === "1")
    return false;
  const client = postgres(process.env.DATABASE_URL, {
    max: 1,
    connect_timeout: 2,
    fetch_types: false,
    prepare: false,
    connection: {
      statement_timeout: 2000,
      application_name: "evryvibe-readiness",
    },
  });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      // An empty migrated catalogue is ready; missing tables or permissions are not.
      client`
        SELECT venues.id, venues.translations, events.id, events.translations,
               events.source_account_url, djs.id, djs.translations, event_djs.event_id
        FROM venues, events, djs, event_djs
        LIMIT 0
      `.then(() => true),
      new Promise<false>((resolve) => {
        deadline = setTimeout(() => resolve(false), 3000);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(deadline);
    await client.end({ timeout: 0 });
  }
}
