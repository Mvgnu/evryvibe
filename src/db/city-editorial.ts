import { asc, eq } from "drizzle-orm";
import { citySlug } from "../core/cities";
import {
  cityContentSlugSchema,
  cityEditorialInputSchema,
  cityEditorialSchema,
  type CityEditorial,
  type CityEditorialInput,
} from "../core/city-editorial";
import { DomainError } from "../core/model";
import { database, type Database } from "./client";
import { cityEditorial, venues } from "./schema";

function publicContent(row: typeof cityEditorial.$inferSelect): CityEditorial {
  return cityEditorialSchema.parse({
    ...row,
    updatedAt: new Date(row.updatedAt).toISOString(),
  });
}

export function cityEditorialRepository(db: Database) {
  return {
    async getCityContent(slug: string): Promise<CityEditorial | null> {
      const parsedSlug = cityContentSlugSchema.parse(slug);
      return db.transaction(
        async (tx) => {
          const cities = await tx.select({ city: venues.city }).from(venues);
          if (!cities.some((row) => citySlug(row.city) === parsedSlug))
            return null;
          const [row] = await tx
            .select()
            .from(cityEditorial)
            .where(eq(cityEditorial.citySlug, parsedSlug));
          return row ? publicContent(row) : null;
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
    async listCityContent(): Promise<CityEditorial[]> {
      return db.transaction(
        async (tx) => {
          const cities = await tx.select({ city: venues.city }).from(venues);
          const slugs = new Set(cities.map((row) => citySlug(row.city)));
          const rows = await tx
            .select()
            .from(cityEditorial)
            .orderBy(asc(cityEditorial.citySlug));
          return rows
            .filter((row) => slugs.has(row.citySlug))
            .map(publicContent);
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
    async upsertCityContent(raw: CityEditorialInput): Promise<CityEditorial> {
      const input = cityEditorialInputSchema.parse(raw);
      return db.transaction(async (tx) => {
        // Hold matching venue records until the editorial write commits.
        const cities = await tx
          .select({ city: venues.city })
          .from(venues)
          .for("share");
        if (!cities.some((row) => citySlug(row.city) === input.citySlug))
          throw new DomainError(
            "not_found",
            "City must exist in venue records before writing city content",
          );
        const [row] = await tx
          .insert(cityEditorial)
          .values({ ...input, updatedAt: new Date().toISOString() })
          .onConflictDoUpdate({
            target: cityEditorial.citySlug,
            set: {
              de: input.de,
              en: input.en,
              updatedAt: new Date().toISOString(),
            },
          })
          .returning();
        if (!row) throw new Error("City content write returned no record");
        return publicContent(row);
      });
    },
  };
}

export async function getCityContent(
  slug: string,
): Promise<CityEditorial | null> {
  const parsedSlug = cityContentSlugSchema.parse(slug);
  if (process.env.EVRYVIBE_DEMO === "1" || !process.env.DATABASE_URL)
    return null;
  return cityEditorialRepository(database()).getCityContent(parsedSlug);
}

export async function listCityContent(): Promise<CityEditorial[]> {
  if (process.env.EVRYVIBE_DEMO === "1" || !process.env.DATABASE_URL) return [];
  return cityEditorialRepository(database()).listCityContent();
}

export async function upsertCityContent(
  input: CityEditorialInput,
): Promise<CityEditorial> {
  return cityEditorialRepository(database()).upsertCityContent(input);
}
