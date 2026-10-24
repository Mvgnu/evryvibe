// Retained as a safe compatibility entry point for old operator commands.
// Cover URLs come from normal crawls; never make extra Instagram enrichment
// requests or refresh stored media through another authenticated capture.
console.log(
  JSON.stringify({
    status: "disabled",
    reason:
      "Use existing crawl-supplied media URLs and consented embeds; no extra Instagram cover requests.",
  }),
);
