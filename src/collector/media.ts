import { checkInstagramResponse } from "./pacing";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
const execute = promisify(execFile);
export function validateMediaUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !["cdninstagram.com", "fbcdn.net"].some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  )
    throw new Error("Image is not on an allowed Instagram media host");
  return url.href;
}
export async function downloadImage(
  value: string,
  path: string,
): Promise<void> {
  const response = await fetch(validateMediaUrl(value), {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  checkInstagramResponse(response.status);
  if (
    !response.ok ||
    !/^image\/(jpeg|png|webp)(;|$)/i.test(
      response.headers.get("content-type") ?? "",
    )
  )
    throw new Error(
      "Instagram image download failed or returned unsupported media",
    );
  const max = 15 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > max)
    throw new Error("Image exceeds 15 MB");
  if (!response.body) throw new Error("Image response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > max) throw new Error("Image exceeds 15 MB");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  await writeFile(path, Buffer.concat(chunks), { mode: 0o600 });
}
export async function recognizeImage(path: string): Promise<string> {
  const language = process.env.OCR_LANG ?? "eng";
  if (!/^[a-z0-9_]+(?:\+[a-z0-9_]+)*$/i.test(language))
    throw new Error("Invalid OCR_LANG");
  try {
    const { stdout } = await execute(
      process.env.TESSERACT_BIN ?? "tesseract",
      [path, "stdout", "-l", language, "--psm", "11"],
      { timeout: 30000, maxBuffer: 256000 },
    );
    return stdout.trim();
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    const signal =
      typeof error === "object" && error !== null && "signal" in error
        ? error.signal
        : undefined;
    const killed =
      typeof error === "object" && error !== null && "killed" in error
        ? error.killed
        : undefined;
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? error.stderr
        : undefined;
    const details: string[] = [];
    if (code === "ENOENT") details.push("executable not found");
    else if (code === "ENOSPC") details.push("disk full");
    else if (typeof code === "number") details.push(`exit code ${code}`);
    if (typeof signal === "string") details.push(`signal ${signal}`);
    if (killed === true) details.push("process timed out");
    if (typeof stderr === "string") {
      const diagnostic = stderr
        .replace(/[\x00-\x1f\x7f]+/g, " ")
        .trim()
        .slice(0, 300);
      if (diagnostic) details.push(diagnostic);
    }
    throw new Error(
      `Tesseract OCR failed${details.length ? ` (${details.join("; ")})` : ""}; verify TESSERACT_BIN, OCR_LANG and image readability`,
      { cause: error },
    );
  }
}
