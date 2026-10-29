import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { POST } from "../src/app/api/artist-events/route";
import { getArtistSession } from "../src/db/claims";
import { createArtistEvent } from "../src/db/artist-event";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "session" }) }),
}));
vi.mock("../src/db/client", () => ({ database: () => ({}) }));
vi.mock("../src/db/claims", () => ({ getArtistSession: vi.fn() }));
vi.mock("../src/db/artist-event", () => ({ createArtistEvent: vi.fn() }));
const venueId = "00000000-0000-4000-8000-000000000003";
function form() {
  const data = new FormData();
  data.set("title", "Test");
  data.set("startsAt", "2027-05-01T23:00:00+02:00");
  data.set("description", "line one\nline two");
  data.set("venueId", venueId);
  return data;
}
function request(data: FormData, origin = "http://localhost:3100") {
  return new Request("http://localhost:3100/api/artist-events", {
    method: "POST",
    headers: { origin },
    body: data,
  });
}

describe("artist event endpoint", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.DATABASE_URL = "postgres://test";
    delete process.env.EVRYVIBE_DEMO;
    vi.mocked(getArtistSession).mockResolvedValue({
      djId: "dj",
      djSlug: "artist",
    });
    vi.mocked(createArtistEvent).mockResolvedValue({ slug: "test" });
  });
  it("rejects cross-origin and unauthorized writes", async () => {
    expect(
      (await POST(request(form(), "https://attacker.example"))).status,
    ).toBe(403);
    vi.mocked(getArtistSession).mockResolvedValue(null);
    expect((await POST(request(form()))).status).toBe(401);
    expect(createArtistEvent).not.toHaveBeenCalled();
  });
  it("requires upload rights and sanitizes a real image to webp", async () => {
    const image = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const data = form();
    data.set(
      "cover",
      new File([new Uint8Array(image)], "cover.png", { type: "image/png" }),
    );
    expect((await POST(request(data))).status).toBe(400);
    data.set("rightsConfirmed", "true");
    expect((await POST(request(data))).status).toBe(201);
    const args = vi.mocked(createArtistEvent).mock.calls[0];
    expect(args?.[2]).toMatchObject({
      description: "line one\nline two",
      lineupNames: [],
      djIds: [],
    });
    const encodedCover = args?.[3];
    if (!encodedCover) throw new Error("Expected a sanitized image");
    expect((await sharp(encodedCover).metadata()).format).toBe("webp");
  });
  it("rejects spoofed, corrupt and oversized covers", async () => {
    const corrupt = form();
    corrupt.set("rightsConfirmed", "true");
    corrupt.set(
      "cover",
      new File(["not an image"], "fake.png", { type: "image/png" }),
    );
    expect((await POST(request(corrupt))).status).toBe(400);
    const oversized = new Request("http://localhost:3100/api/artist-events", {
      method: "POST",
      headers: {
        origin: "http://localhost:3100",
        "content-type": "multipart/form-data; boundary=abc",
      },
      body: new Uint8Array(6 * 1024 * 1024 + 1),
    });
    expect((await POST(oversized)).status).toBe(413);
    expect(createArtistEvent).not.toHaveBeenCalled();
  });
});
