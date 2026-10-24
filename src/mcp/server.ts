import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { database, closeDatabase } from "../db/client";
import { createMcpServer } from "./tools";
const server = createMcpServer(database());
await server.connect(new StdioServerTransport());

// SSH clients end stdin without killing their remote process. Release connections
// on EOF as well as signals so disconnected agents cannot leave idle DB pools.
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  try {
    await server.close();
    await closeDatabase();
  } finally {
    clearTimeout(deadline);
  }
}
process.stdin.once("end", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
process.once("SIGINT", () => {
  void shutdown();
});
