import { expect, test } from "vitest";
import { videoSampleTimes } from "../src/collector/video";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recognizeImage } from "../src/collector/media";

test("sample schedule includes early flyer frames and clamps/deduplicates short clips", () => {
  expect(videoSampleTimes(5)).toEqual([0, 1, 2, 2.5, 4.85]);
  expect(videoSampleTimes(0.4)).toEqual([0, 0.2, 0.36]);
  expect(videoSampleTimes(1.5)).toEqual([0, 0.75, 1, 1.35]);
  for (const invalid of [0, -1, Infinity, NaN])
    expect(() => videoSampleTimes(invalid)).toThrow();
});

test("OCR failure reports the Tesseract exit reason", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "evryvibe-bad-image-"));
  try {
    const image = join(temporary, "invalid.png");
    await writeFile(image, "not an image");
    await expect(recognizeImage(image)).rejects.toThrow(
      /exit code 1.*(Error|image|file)/i,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("actual tsx captures 1s/2s flyer OCR from scoped posterless reel and video carousel without unrelated frames", async () => {
  const videoModule = pathToFileURL(resolve("src/collector/video.ts")).href;
  const postModule = pathToFileURL(resolve("src/collector/instagram.ts")).href;
  const storyModule = pathToFileURL(resolve("src/collector/stories.ts")).href;
  const clip = resolve("tests/fixtures/video/intro-flyer.webm");
  const short = resolve("tests/fixtures/video/short.webm");
  const script = `
 import {chromium} from 'playwright';import {readFile} from 'node:fs/promises';
 import {capturePost} from ${JSON.stringify(postModule)};
 import {sampleVideoFrames} from ${JSON.stringify(videoModule)};
 import {captureStories} from ${JSON.stringify(storyModule)};
 import {mkdtemp,rm} from "node:fs/promises";import {tmpdir} from "node:os";import {join} from "node:path";
 const browser=await chromium.launch({headless:true});
 try {
  const context=await browser.newContext({viewport:{width:1000,height:1000}});await context.route('**/*',route=>route.abort());const page=await context.newPage();let extraRequests=0;page.request.get=async()=>{extraRequests++;throw new Error('Extra Instagram request prohibited');};
  const intro='data:video/webm;base64,'+(await readFile(${JSON.stringify(clip)})).toString('base64');
  const short='data:video/webm;base64,'+(await readFile(${JSON.stringify(short)})).toString('base64');
  const html='<article><header><a href="/testroom/">testroom</a></header><a href="/p/CLIP/">timestamp</a><h1>Original source caption</h1><div style="width:640px;height:360px;overflow:hidden"><div id="rail" style="display:flex;width:1280px;height:360px"><video id="first" preload="auto" muted width="640" height="360" style="flex-shrink:0" src="'+intro+'"></video><video id="second" preload="auto" muted width="640" height="360" style="flex-shrink:0" src="'+short+'"></video></div></div><button aria-label="Next" onclick="document.getElementById(&quot;rail&quot;).style.transform=&quot;translateX(-640px)&quot;;this.remove()">Next</button></article><article><a href="/p/UNRELATED/">other post</a><video id="recommendation" preload="auto" muted width="640" height="360" src="'+intro+'"></video></article>';
  await page.route('https://www.instagram.com/p/CLIP/',route=>route.fulfill({contentType:'text/html',body:html}));
  const result=await capturePost(page,'https://www.instagram.com/reel/CLIP/','https://www.instagram.com/testroom/');
  const labels=result.videoOcrText.split('[Post slide ').slice(1).map(piece=>'[Post slide '+piece);
  const early=labels.filter(piece=>piece.includes('at 1.00s')||piece.includes('at 2.00s'));
  const later=labels.filter(piece=>piece.includes('at 0.00s of 5.00s')||piece.includes('at 2.50s')||piece.includes('at 4.85s'));
  const untouched=await page.locator('#recommendation').evaluate(video=>video.currentTime===0);
  const callbacks=[];
  const callbackPieces=await sampleVideoFrames(page.locator('#second'),{sourceUrl:'https://www.instagram.com/reel/CLIP/',label:'Callback check',assertSource:async()=>{},onFrame:async(frame,second,ocrText)=>{const bytes=await readFile(frame);callbacks.push({second,ocrText,validPng:bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))});}});
  // The same source identifier must remain current after seeking, too.
  const active=page.locator('#second');let checks=0;let rejected='';
  try{await sampleVideoFrames(active,{sourceUrl:'https://www.instagram.com/stories/testroom/123/',label:'Story 123',assertSource:async()=>{checks++;if(checks>=3)throw new Error('Story advanced while sampling');}});}catch(error){rejected=error.message;}
  const storyPage=await context.newPage();await storyPage.setContent('<div style="width:640px;height:360px;background:black"></div>');const poster=await storyPage.locator('div').screenshot();
  globalThis.fetch=async()=>new Response(poster,{headers:{'content-type':'image/png'}});
  const inventory={user:{username:'testroom'},items:[{pk:'123',media_type:2,image_versions2:{candidates:[{url:'https://s.cdninstagram.com/poster.png',width:640,height:360}]} }]};
  await storyPage.route('https://www.instagram.com/stories/testroom/',route=>route.fulfill({contentType:'text/html',body:'<script type="application/json">'+JSON.stringify(inventory)+'</script><main>stories</main>'}));
  await storyPage.route('https://www.instagram.com/stories/testroom/123/',route=>route.fulfill({contentType:'text/html',body:'<video preload="auto" muted width="640" height="360" src="'+intro+'"></video>'}));
  const temporary=await mkdtemp(join(tmpdir(),'story-video-fixture-'));const storyPieces=[];
  try{for await(const pack of captureStories(storyPage,'https://www.instagram.com/testroom/',{temporary,beforePost:async()=>{},checkAccess:async()=>{},checkRestriction:()=>{}}))storyPieces.push(pack.ocrText);}finally{await rm(temporary,{recursive:true,force:true});}
  const storyEarly=storyPieces.join('').split('[Story 123:').filter(piece=>piece.includes('at 1.00s')||piece.includes('at 2.00s'));
  const swapPage=await context.newPage();
  const swapHtml='<article><header><a href="/testroom/">testroom</a></header><a href="/p/SWAP/">date</a><h1>In-place video carousel</h1><video id="player" preload="auto" muted width="640" height="360" src="'+short+'" data-next="'+intro+'"></video><button aria-label="Next" onclick="const player=document.getElementById(&quot;player&quot;);player.src=player.dataset.next;this.remove()">Next</button></article>';
  await swapPage.route('https://www.instagram.com/p/SWAP/',route=>route.fulfill({contentType:'text/html',body:swapHtml}));
  const swapped=await capturePost(swapPage,'https://www.instagram.com/p/SWAP/','https://www.instagram.com/testroom/');
  const swappedLabels=swapped.videoOcrText.split('[Post slide ').slice(1).map(piece=>'[Post slide '+piece);
  console.log(JSON.stringify({caption:result.caption,imageUrls:result.imageUrls,extraRequests,early,later,labels:labels.map(piece=>piece.split('\\n')[0]),callbacks,callbackPieces,untouched,rejected,storyEarly,swappedLabels,}));
 }finally{await browser.close();}
 `;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { timeout: 60000 },
  );
  const result = JSON.parse(stdout);
  expect(result.caption).toBe("Original source caption");
  expect(result.imageUrls).toEqual([]);
  expect(result.extraRequests).toBe(0);
  expect(result.early).toHaveLength(2);
  for (const text of result.early) {
    expect(text).toContain("FRIDAY 25 SEPTEMBER");
    expect(text).toContain("DJ ALPHA");
    expect(text).toContain("DOORS 23:00");
  }
  for (const text of result.later) expect(text).not.toContain("DJ ALPHA");
  expect(result.labels).toHaveLength(8);
  expect(
    result.callbacks.map((callback: { second: number }) => callback.second),
  ).toEqual([0, 0.2, 0.36]);
  expect(
    result.callbacks.every(
      (callback: { validPng: boolean }) => callback.validPng,
    ),
  ).toBe(true);
  expect(result.callbackPieces).toHaveLength(3);
  expect(
    result.labels.filter((text: string) => text.includes("Post slide 2")),
  ).toHaveLength(3);
  expect(
    result.labels.every((text: string) =>
      text.includes("source https://www.instagram.com/reel/CLIP/"),
    ),
  ).toBe(true);
  expect(result.storyEarly).toHaveLength(2);
  for (const text of result.storyEarly) {
    expect(text).toContain("DJ ALPHA");
    expect(text).toContain("DOORS 23:00");
  }
  expect(result.swappedLabels).toHaveLength(8);
  expect(
    result.swappedLabels.filter((piece: string) =>
      piece.includes("Post slide 1"),
    ),
  ).toHaveLength(3);
  expect(
    result.swappedLabels.filter((piece: string) =>
      piece.includes("Post slide 2"),
    ),
  ).toHaveLength(5);
  expect(
    result.swappedLabels.find(
      (piece: string) =>
        piece.includes("Post slide 2") && piece.includes("at 1.00s"),
    ),
  ).toContain("DJ ALPHA");
  expect(result.untouched).toBe(true);
  expect(result.rejected).toContain("Story advanced");
}, 65000);
