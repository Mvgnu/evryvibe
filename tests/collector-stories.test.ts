import { expect, test } from "vitest";
import { storyInventory, storyCaption } from "../src/collector/stories";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const account = "https://www.instagram.com/testroom/";
const item = (pk: string) => ({
  pk,
  media_type: 1,
  image_versions2: {
    candidates: [
      { url: `https://s.cdninstagram.com/${pk}.png`, width: 600, height: 350 },
    ],
  },
  expiring_at: Date.now() / 1000 + 300,
});
test("story inventory covers every attributable active item, dedupes and retains failed media for per-item handling", () => {
  const data = {
    nested: [
      { user: { username: "other" }, items: [item("99")] },
      {
        user: { username: "testroom" },
        items: [
          item("1"),
          { ...item("2"), media_type: 3 },
          { ...item("3"), expiring_at: 1 },
        ],
      },
    ],
  };
  expect(storyInventory([data, data], account)?.map((item) => item.pk)).toEqual(
    ["1", "2"],
  );
  expect(
    storyInventory([{ user: { username: "testroom" }, items: [] }], account),
  ).toEqual([]);
  expect(storyInventory([], account)).toBeNull();
  expect(() =>
    storyInventory(
      [
        {
          user: { username: "testroom" },
          items: [{ ...item("1"), pk: "bad" }],
        },
      ],
      account,
    ),
  ).toThrow();
  expect(
    storyCaption({
      ...item("4"),
      media_type: 1,
      caption: { text: "Original story" },
      story_link_stickers: [
        {
          story_link: {
            url: "https://tickets.example/event",
            title: "Tickets",
          },
        },
      ],
    }),
  ).toContain("Story link: https://tickets.example/event");
  expect(
    storyCaption({
      ...item("4"),
      media_type: 1,
      story_link_stickers: [{ url: "https://s.cdninstagram.com/story.jpg" }],
    }),
  ).not.toContain("cdninstagram.com");
});
test("tsx browser processes later stories after failure and picks six recent grid posts rather than six unseen posts", async () => {
  const storyModule = pathToFileURL(resolve("src/collector/stories.ts")).href;
  const postModule = pathToFileURL(resolve("src/collector/instagram.ts")).href;
  const data = {
    user: { username: "testroom" },
    items: [item("1"), item("2"), item("3")],
  };
  const script = `
 import {chromium} from 'playwright';
 import {captureStories} from ${JSON.stringify(storyModule)};
 import {latestProfilePosts,captureProfile} from ${JSON.stringify(postModule)};
 import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
 const browser=await chromium.launch({headless:true});const temporary=await mkdtemp(join(tmpdir(),'story-fixture-'));
 try{
 const context=await browser.newContext();const page=await context.newPage();await page.setContent('<div style="background:white;color:black;font:60px Arial;width:650px;height:350px">STORY NIGHT<br>FRIDAY DOORS 23:00</div>');const png=await page.locator('div').screenshot();
 const downloads=[];globalThis.fetch=async(url)=>{downloads.push(String(url));return String(url).endsWith('/1.png')?new Response('failed',{status:500}):new Response(png,{headers:{'content-type':'image/png'}});};
 await page.route('https://www.instagram.com/stories/testroom/',route=>route.fulfill({contentType:'text/html',body:'<script type="application/json">'+JSON.stringify(${JSON.stringify(data)})+'</script><main>testroom stories</main>'}));
 const packages=[];let failure='';try{for await(const pack of captureStories(page,${JSON.stringify(account)},{temporary,beforePost:async()=>{},shouldCapture:async(url)=>!url.endsWith('/2/'),checkAccess:async()=>{},checkRestriction:()=>{}}))packages.push({url:pack.postUrl,ocr:pack.ocrText});}catch(error){failure=error.message;}
 await page.setContent('<main>'+[...Array.from({length:3},(_,i)=>'<a href="/p/PIN'+i+'/"><svg aria-label="Pinned post"></svg></a>'),...Array.from({length:9},(_,i)=>'<a href="/p/RECENT'+i+'/"></a>')].join('')+'</main>');
 const latest=await latestProfilePosts(page,${JSON.stringify(account)});
 await page.setContent('<main><a href="/p/LATE0/"></a><a href="/p/LATE1/"></a><a href="/p/LATE2/"></a></main>');
 await page.evaluate(()=>{setTimeout(()=>{document.querySelector('main').insertAdjacentHTML('beforeend','<a href="/p/LATE3/"></a><a href="/p/LATE4/"></a><a href="/p/LATE5/"></a>');},4000);});
 const delayed=await latestProfilePosts(page,${JSON.stringify(account)});
 await context.route('https://s.cdninstagram.com/**',route=>route.fulfill({contentType:'image/png',body:png}));
 await context.route('https://www.instagram.com/**',route=>{
  const path=new URL(route.request().url()).pathname;
  const body=path.startsWith('/stories/')?'<script type="application/json">'+JSON.stringify(${JSON.stringify(data)})+'</script><main>stories</main>':path==='/testroom/'?'<main>'+['BAD','GOOD','KNOWN1','KNOWN2','KNOWN3','KNOWN4'].map(code=>'<a href="/p/'+code+'/">post</a>').join('')+'</main>':'<article><header><a href="/'+(path.includes('BAD')?'other':'testroom')+'/">author</a></header><a href="'+path+'">date</a><h1>Raw post caption</h1><img src="https://s.cdninstagram.com/good.png" width="600" height="350"></article>';
  return route.fulfill({contentType:'text/html',body});
 });
 const source={venueId:'00000000-0000-4000-8000-000000000001',slug:'fixture',name:'Fixture',city:'Berlin',instagramUrl:${JSON.stringify(account)},enabled:true,revision:1,lastStartedAt:null,lastSucceededAt:null,lastError:null,lastPostCount:0};
 const continued=[];let partial='';try{for await(const pack of captureProfile(context,source,{beforePost:async()=>{},shouldCapture:async url=>!url.endsWith('/2/')&&!url.includes('KNOWN')}))continued.push(pack.postUrl);}catch(error){partial=error.message;}
 console.log(JSON.stringify({downloads,packages,failure,latest,delayed,continued,partial}));
 }finally{await browser.close();await rm(temporary,{recursive:true,force:true});}
 `;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { timeout: 30000 },
  );
  const result = JSON.parse(stdout);
  expect(result.downloads.slice(0, 2)).toEqual([
    "https://s.cdninstagram.com/1.png",
    "https://s.cdninstagram.com/3.png",
  ]);
  expect(result.packages).toHaveLength(1);
  expect(result.packages[0].url).toBe(
    "https://www.instagram.com/stories/testroom/3/",
  );
  expect(result.packages[0].ocr).toContain("STORY NIGHT");
  expect(result.packages[0].ocr).toContain(
    "[Story 3: still image; media ID ig:story:3:slide:1:image]",
  );
  expect(result.packages[0]).not.toHaveProperty("candidates");
  expect(result.failure).toContain("Some stories could not be collected");
  expect(result.latest).toEqual(
    Array.from(
      { length: 6 },
      (_, i) => `https://www.instagram.com/p/RECENT${i}/`,
    ),
  );
  expect(result.delayed).toEqual(
    Array.from(
      { length: 6 },
      (_, i) => `https://www.instagram.com/p/LATE${i}/`,
    ),
  );
  expect(result.continued).toEqual([
    "https://www.instagram.com/stories/testroom/3/",
    "https://www.instagram.com/p/GOOD/",
  ]);
  expect(result.partial).toContain("Partial collection");
  expect(result.partial).toContain("stories:");
  expect(result.partial).toContain("/p/BAD/");
}, 35000);
