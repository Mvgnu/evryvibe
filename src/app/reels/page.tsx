import type { Metadata } from "next";
import Link from "next/link";
import { copy, DemoNotice } from "@/components/catalog-ui";
import { ReelsFeed } from "@/components/reels-feed";
import { requestTime } from "@/components/request-time";
import { localizePath, localizedTitle } from "@/core/i18n";
import { buildReels } from "@/core/reels";
import { pageMetadata } from "@/core/site";
import { pageStructuredData, serializeJsonLd } from "@/core/structured-data";
import { getCatalog } from "@/db/catalog";
import { requestLocale } from "@/lib/locale";
import "./reels.css";

export const dynamic = "force-dynamic";

const title = (locale: "de" | "en") =>
  copy(
    locale,
    "Reels: DJs hören, Partys finden",
    "Reels: hear DJs, find parties",
  );
const description = (locale: "de" | "en") =>
  copy(
    locale,
    "Sag, wie weit du fährst, und scroll dich durch die SoundCloud-Sets der DJs, die bald in deiner Nähe spielen. Likes lernen deinen Sound und merken dir die Nächte.",
    "Say how far you'll travel and scroll through the SoundCloud sets of DJs playing near you soon. Likes learn your sound and keep the nights for you.",
  );

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return pageMetadata(title(locale), description(locale), "/reels", locale);
}

export default async function ReelsPage() {
  const [catalog, locale] = await Promise.all([getCatalog(), requestLocale()]);
  const reels = buildReels(
    {
      ...catalog,
      events: catalog.events.map((event) => ({
        ...event,
        title: localizedTitle(event, locale),
      })),
    },
    requestTime(),
  );
  return (
    <main id="main" className="reels-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            pageStructuredData("/reels", title(locale), locale, {
              description: description(locale),
            }),
          ),
        }}
      />
      <DemoNotice mode={catalog.mode} locale={locale} />
      <noscript>
        <div className="reels-setup">
          <h1>{title(locale)}</h1>
          <p>
            {copy(
              locale,
              "Reels brauchen JavaScript für den SoundCloud-Player. Alle Nächte findest du auch in der Liste.",
              "Reels need JavaScript for the SoundCloud player. All nights are also in the list.",
            )}
          </p>
          <Link className="button" href={localizePath("/", locale)}>
            {copy(locale, "Alle Nächte", "All nights")}
          </Link>
        </div>
      </noscript>
      <ReelsFeed reels={reels} locale={locale} />
    </main>
  );
}
