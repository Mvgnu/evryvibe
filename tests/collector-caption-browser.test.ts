import { test, expect } from "vitest";
import { chromium } from "playwright";
import { capturePost } from "../src/collector/instagram";

test("caption hydration and self-mentions preserve the original row; replies cannot replace it", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1000, height: 800 },
    });
    await page.setContent(
      '<div style="width:600px;height:350px;background:white">Flyer</div>',
    );
    const png = await page.locator("div").screenshot();
    await page.route("https://s.cdninstagram.com/flyer.png", (route) =>
      route.fulfill({ contentType: "image/png", body: png }),
    );
    const postUrl = "https://www.instagram.com/p/CAPTION/";
    const accountUrl = "https://www.instagram.com/testroom/";
    let content = "";
    await page.route(postUrl, (route) =>
      route.fulfill({ contentType: "text/html", body: content }),
    );
    const source = (caption: string) =>
      `<article><header><a href="/testroom/">testroom</a></header><a href="/p/CAPTION/"><time>Today</time></a><img src="https://s.cdninstagram.com/flyer.png" width="600" height="350">${caption}</article>`;

    content =
      source('<div id="caption"></div>') +
      '<script>setTimeout(()=>document.getElementById("caption").innerHTML="<h1>Hydrated original caption</h1>",700)</script>';
    expect(
      (await capturePost(page, postUrl, accountUrl, { sampleVideo: false }))
        .caption,
    ).toBe("Hydrated original caption");

    content = source(
      '<ul><li><a href="/testroom/">testroom</a><span dir="auto">Tonight at <a href="/testroom/">testroom</a><br>Doors 23:00</span></li><li><a href="/testroom/">testroom</a><span dir="auto">Later author comment</span></li></ul>',
    );
    expect(
      (await capturePost(page, postUrl, accountUrl, { sampleVideo: false }))
        .caption,
    ).toBe("Tonight at testroom\nDoors 23:00");

    content = source(
      '<ul><li><a href="/testroom/">testroom</a><span dir="auto">Original caption</span><ul><li><a href="/other/">other</a><span dir="auto">Visitor reply</span></li></ul></li></ul>',
    );
    expect(
      (await capturePost(page, postUrl, accountUrl, { sampleVideo: false }))
        .caption,
    ).toBe("Original caption");

    content = source(
      '<ul><li><a href="/testroom/">testroom</a><ul><li><a href="/other/">other</a><span dir="auto">Visitor reply cannot fill an absent caption</span></li></ul></li></ul>',
    );
    await expect(
      capturePost(page, postUrl, accountUrl, { sampleVideo: false }),
    ).rejects.toThrow("Cannot isolate the original caption");

    content = source(
      '<ul><li><span dir="auto">Unattributed text</span><ul><li><a href="/testroom/">testroom</a><span dir="auto">Nested author reply</span></li></ul></li></ul>',
    );
    await expect(
      capturePost(page, postUrl, accountUrl, { sampleVideo: false }),
    ).rejects.toThrow("Cannot isolate the original caption");

    content = source(
      '<ul><li><a href="/other/">other</a><span dir="auto">Visitor comment</span><ul><li><a href="/testroom/">testroom</a><span dir="auto">Author reply is not the caption</span></li></ul></li></ul>',
    );
    await expect(
      capturePost(page, postUrl, accountUrl, { sampleVideo: false }),
    ).rejects.toThrow("Cannot isolate the original caption");

    content =
      source(
        '<ul><li><a href="/other/">other</a><span dir="auto">Visitor comment</span></li></ul>',
      ) +
      '<script type="application/json">{"media":{"code":"CAPTION","user":{"username":"testroom"},"caption":null}}</script>';
    expect(
      (await capturePost(page, postUrl, accountUrl, { sampleVideo: false }))
        .caption,
    ).toBe("");
  } finally {
    await browser.close();
  }
}, 45000);
