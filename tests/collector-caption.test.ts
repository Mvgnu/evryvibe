import { expect, test } from "vitest";
import {
  captionFromDocuments,
  captionFromMetadata,
} from "../src/collector/post-caption";

const postUrl = "https://www.instagram.com/p/SOURCE_1/";
const accountUrl = "https://www.instagram.com/testroom/";

test("embedded captions require the source shortcode and attributable author on the same record", () => {
  const documents = [
    {
      unrelated: {
        shortcode: "OTHER",
        owner: { username: "testroom" },
        caption: { text: "Different post" },
      },
      sameCode: {
        code: "SOURCE_1",
        user: { username: "another" },
        caption: { text: "Different author" },
      },
      items: [
        {
          code: "SOURCE_1",
          user: { username: "testroom" },
          caption: { text: "Original caption" },
        },
      ],
    },
  ];
  expect(captionFromDocuments(documents, postUrl, accountUrl)).toBe(
    "Original caption",
  );
  expect(captionFromDocuments([], postUrl, accountUrl)).toBeNull();
  expect(
    captionFromDocuments(
      [{ code: "SOURCE_1", caption: { text: "No author evidence" } }],
      postUrl,
      accountUrl,
    ),
  ).toBeNull();
  expect(
    captionFromDocuments(
      [
        {
          user: { username: "testroom" },
          caption: { text: "No post evidence" },
        },
      ],
      postUrl,
      accountUrl,
    ),
  ).toBeNull();
  expect(
    captionFromDocuments(
      [
        {
          code: "SOURCE_1",
          user: { username: "testroom" },
          comments: [
            { caption: { text: "Child comment is not the original" } },
          ],
        },
      ],
      postUrl,
      accountUrl,
    ),
  ).toBeNull();
});

test("embedded caption extraction preserves quotes, backslashes and multiline source text", () => {
  const caption = 'Doors at 23:00\nBring "friends" \\ no guest list\n@another';
  const document: unknown = JSON.parse(
    JSON.stringify({
      data: {
        shortcode: "SOURCE_1",
        owner: { username: "testroom" },
        edge_media_to_caption: { edges: [{ node: { text: caption } }] },
      },
    }),
  );
  expect(captionFromDocuments([document], postUrl, accountUrl)).toBe(caption);
});

test("explicit empty provider captions are accepted while missing caption evidence is excluded", () => {
  for (const evidence of [
    { caption: null },
    { caption: { text: "" } },
    { edge_media_to_caption: { edges: [] } },
  ]) {
    expect(
      captionFromDocuments(
        [{ code: "SOURCE_1", user: { username: "testroom" }, ...evidence }],
        postUrl,
        accountUrl,
      ),
    ).toBe("");
  }
  expect(
    captionFromDocuments(
      [{ code: "SOURCE_1", user: { username: "testroom" } }],
      postUrl,
      accountUrl,
    ),
  ).toBeNull();
});

test("a same-code post from another author cannot supply a caption or an empty-caption result", () => {
  expect(
    captionFromDocuments(
      [
        {
          code: "SOURCE_1",
          user: { username: "another" },
          caption: { text: "@testroom is mentioned, but is not the author" },
        },
        {
          shortcode: "SOURCE_1",
          owner: { username: "another" },
          caption: null,
        },
      ],
      postUrl,
      accountUrl,
    ),
  ).toBeNull();
});

test("a provider-declared collaborator may attribute the exact source post to the venue", () => {
  const record = {
    code: "SOURCE_1",
    user: { username: "another" },
    coauthor_producers: [{ username: "testroom" }],
    caption: { text: "Joint original caption" },
  };
  expect(captionFromDocuments([record], postUrl, accountUrl)).toBe(
    "Joint original caption",
  );
  expect(
    captionFromDocuments([{ ...record, code: "OTHER" }], postUrl, accountUrl),
  ).toBeNull();
  expect(
    captionFromDocuments(
      [{ ...record, coauthor_producers: [{ username: "thirdroom" }] }],
      postUrl,
      accountUrl,
    ),
  ).toBeNull();
});

test("duplicate evidence agrees, while conflicting attributable captions fail explicitly", () => {
  const record = {
    shortcode: "SOURCE_1",
    owner: { username: "testroom" },
    caption: { text: "Original" },
  };
  expect(
    captionFromDocuments([record, { nested: record }], postUrl, accountUrl),
  ).toBe("Original");
  for (const caption of [{ text: "Conflicting caption" }, null]) {
    expect(() =>
      captionFromDocuments(
        [record, { ...record, caption }],
        postUrl,
        accountUrl,
      ),
    ).toThrow();
  }
});

test("OG metadata preserves the quoted caption only for matching source and author", () => {
  const caption = 'First line\n"Bring friends" \\ second line';
  const description = `12 likes, 3 comments - testroom on September 28, 2026: "${caption}".`;
  expect(captionFromMetadata(description, postUrl, postUrl, accountUrl)).toBe(
    caption,
  );
  expect(
    captionFromMetadata(
      description,
      "https://www.instagram.com/p/OTHER/",
      postUrl,
      accountUrl,
    ),
  ).toBeNull();
  expect(
    captionFromMetadata(
      description.replace(" - testroom on ", " - another on "),
      postUrl,
      postUrl,
      accountUrl,
    ),
  ).toBeNull();
  expect(
    captionFromMetadata(description, null, postUrl, accountUrl),
  ).toBeNull();
  expect(captionFromMetadata(null, postUrl, postUrl, accountUrl)).toBeNull();
});

test("matching metadata identity without a quoted original caption does not supply source text", () => {
  expect(
    captionFromMetadata(
      "12 likes, 3 comments - testroom on September 28, 2026",
      postUrl,
      postUrl,
      accountUrl,
    ),
  ).toBeNull();
});

test("current Instagram metadata allows a profile-prefixed permalink and no like-count preamble", () => {
  const description =
    'testroom on September 28, 2026: "Original current caption". ';
  expect(
    captionFromMetadata(
      description,
      "https://www.instagram.com/testroom/p/SOURCE_1/",
      postUrl,
      accountUrl,
    ),
  ).toBe("Original current caption");
  expect(
    captionFromMetadata(
      description,
      "https://www.instagram.com/testroom/reel/SOURCE_1/",
      postUrl,
      accountUrl,
    ),
  ).toBe("Original current caption");
  for (const url of [
    "https://www.instagram.com/another/p/SOURCE_1/",
    "https://www.instagram.com/testroom/p/OTHER/",
    "https://elsewhere.example/testroom/p/SOURCE_1/",
  ])
    expect(
      captionFromMetadata(description, url, postUrl, accountUrl),
    ).toBeNull();
  expect(
    captionFromMetadata(
      'another on September 28, 2026: " - testroom on is merely quoted". ',
      "https://www.instagram.com/testroom/p/SOURCE_1/",
      postUrl,
      accountUrl,
    ),
  ).toBeNull();
});
