import { isAbsolute } from "node:path";
import { z } from "zod";
import { database, closeDatabase } from "../db/client";
import { createMcpServer } from "./tools";
import { createRemoteServer } from "./http";
import { OperatorOAuth } from "./oauth";

const config = z
  .object({
    EVRYVIBE_MCP_ORIGIN: z.url(),
    EVRYVIBE_MCP_STATE_FILE: z
      .string()
      .refine(isAbsolute, "Use an absolute private state file path"),
    EVRYVIBE_OPERATOR_PASSWORD: z.string().min(16),
    EVRYVIBE_MCP_PORT: z.coerce
      .number()
      .int()
      .min(1024)
      .max(65535)
      .default(3301),
  })
  .parse(process.env);
const auth = new OperatorOAuth(
  config.EVRYVIBE_MCP_ORIGIN,
  config.EVRYVIBE_MCP_STATE_FILE,
  config.EVRYVIBE_OPERATOR_PASSWORD,
);
const db = database();
const server = createRemoteServer(auth, () => createMcpServer(db));
server.listen(config.EVRYVIBE_MCP_PORT, "127.0.0.1", () =>
  console.error("[evryvibe] authenticated remote MCP listening on loopback"),
);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  server.close();
  server.closeAllConnections();
  await closeDatabase();
  clearTimeout(deadline);
}
process.once("SIGTERM", () => {
  void shutdown();
});
process.once("SIGINT", () => {
  void shutdown();
});
