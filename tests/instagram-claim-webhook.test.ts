import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  processInstagramClaim,
  validSignature,
  type ClaimIssuer,
} from "../src/lib/instagram-claim-service";
import type { InstagramClaimConfig } from "../src/lib/instagram-claim-config";

const config: InstagramClaimConfig = {
  appSecret: "app-secret",
  verifyToken: "verify",
  accessToken: "token",
  businessId: "111",
  apiVersion: "v25.0",
  claimSecret: "a".repeat(32),
};
const delivery = (text = "CLAIM", sender = "222", recipient = "111") => ({
  object: "instagram",
  entry: [
    {
      id: "111",
      messaging: [
        {
          sender: { id: sender },
          recipient: { id: recipient },
          message: { mid: "mid-1", text },
        },
      ],
    },
  ],
});
const issuer = () =>
  vi
    .fn<ClaimIssuer>()
    .mockResolvedValue({
      kind: "issued",
      token: "safe_token",
      djSlug: "artist",
    });

describe("Instagram claim DM", () => {
  it("authenticates the exact webhook bytes", () => {
    const body = Buffer.from('{"object":"instagram"}');
    const signature = `sha256=${createHmac("sha256", config.appSecret).update(body).digest("hex")}`;
    expect(validSignature(body, signature, config.appSecret)).toBe(true);
    expect(
      validSignature(Buffer.from("changed"), signature, config.appSecret),
    ).toBe(false);
    expect(validSignature(body, "sha256=01", config.appSecret)).toBe(false);
  });
  it("uses Meta's sender identity and follow response, then sends a fragment claim link only to that sender", async () => {
    const issue = issuer();
    const urls: string[] = [];
    let outbound = "";
    const request: typeof fetch = async (input, init) => {
      urls.push(String(input));
      if (init?.method === "POST") {
        outbound = String(init.body);
        return Response.json({ message_id: "sent" });
      }
      return Response.json({
        username: "Artist.Name",
        is_user_follow_business: true,
      });
    };
    await processInstagramClaim(delivery(" claim "), config, issue, request);
    expect(issue).toHaveBeenCalledWith(
      {
        instagramUsername: "Artist.Name",
        instagramScopedId: "222",
        messageId: "mid-1",
        follows: true,
      },
      config.claimSecret,
    );
    expect(urls[0]).toContain(
      "graph.instagram.com/v25.0/222?fields=username%2Cis_user_follow_business",
    );
    expect(JSON.parse(outbound)).toEqual({
      recipient: { id: "222" },
      message: {
        text: expect.stringContaining(
          "https://evryvibe.com/artist/claim#token=safe_token",
        ),
      },
    });
  });
  it("ignores unrelated messages, echoes, and messages to another account", async () => {
    const issue = issuer();
    const request = vi.fn<typeof fetch>();
    await processInstagramClaim(delivery("hello"), config, issue, request);
    await processInstagramClaim(
      delivery("CLAIM", "222", "333"),
      config,
      issue,
      request,
    );
    await processInstagramClaim(
      delivery("CLAIM", "111"),
      config,
      issue,
      request,
    );
    expect(issue).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
  it("never issues a claim when the follow response is missing or unavailable", async () => {
    const issue = issuer();
    await expect(
      processInstagramClaim(delivery(), config, issue, async () =>
        Response.json({ username: "someone" }),
      ),
    ).rejects.toThrow();
    await expect(
      processInstagramClaim(
        delivery(),
        config,
        issue,
        async () => new Response("", { status: 500 }),
      ),
    ).rejects.toThrow();
    expect(issue).not.toHaveBeenCalled();
  });
  it("asks a nonfollower to follow and send CLAIM again", async () => {
    const issue = vi
      .fn<ClaimIssuer>()
      .mockResolvedValue({ kind: "not_following" });
    let outbound = "";
    const request: typeof fetch = async (_input, init) => {
      if (init?.method === "POST") {
        outbound = String(init.body);
        return Response.json({ message_id: "sent" });
      }
      return Response.json({
        username: "artist",
        is_user_follow_business: false,
      });
    };
    await processInstagramClaim(delivery(), config, issue, request);
    expect(issue).toHaveBeenCalledWith(
      expect.objectContaining({ follows: false }),
      config.claimSecret,
    );
    expect(outbound).toContain("@evryvibe");
    expect(outbound).not.toContain("#token=");
  });
});
