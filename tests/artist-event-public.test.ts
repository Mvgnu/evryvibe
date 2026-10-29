import { describe, expect, it } from "vitest";
import { eventSchema, venueSchema } from "../src/core/model";
import { eventStructuredData } from "../src/core/structured-data";
import { lineupNames } from "../src/components/poster-facts";
import { demoCatalog } from "../src/db/demo";

describe("artist submitted event", () => {
  it("does not invent an Instagram source and retains unlinked billing", () => {
    const event = eventSchema.parse({
      ...demoCatalog.events[0],
      sourceUrl: null,
      sourceAccountUrl: null,
      unlinkedArtists: ["Unlinked Artist"],
    });
    const venue = venueSchema.parse(
      demoCatalog.venues.find((item) => item.id === event.venueId),
    );
    expect(lineupNames(event, demoCatalog.djs)).toContain("Unlinked Artist");
    const graph = eventStructuredData(event, venue, demoCatalog.djs);
    const output = JSON.stringify(graph);
    expect(output).not.toContain('"isBasedOn"');
    expect(output).not.toContain('"subjectOf"');
    expect(output).not.toContain("instagram.com/p/FICTIONAL_DEMO");
    expect(output).toContain('"name":"Unlinked Artist"');
  });
});
