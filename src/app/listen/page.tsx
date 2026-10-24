import { ListenFeed } from "@/components/listen-feed";
import { copy, DemoNotice } from "@/components/catalog-ui";
import { requestTime } from "@/components/request-time";
import { buildListenCards } from "@/core/listen";
import { localizedTitle } from "@/core/i18n";
import { pageMetadata } from "@/core/site";
import { pageStructuredData, serializeJsonLd } from "@/core/structured-data";
import { getCatalog } from "@/db/catalog";
import { requestLocale } from "@/lib/locale";
import "./listen.css";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const locale = await requestLocale();
  return {
    ...pageMetadata(
      copy(locale, "Hören & Partys finden", "Listen & find parties"),
      copy(
        locale,
        "Hör dich durch die DJs kommender Partys. Wähle deine Stadt und deinen Radius und finde mit Likes deinen Sound.",
        "Listen to DJs playing upcoming parties. Choose your city and radius, then find your sound with likes.",
      ),
      "/listen",
      locale,
    ),
    robots: { index: false, follow: true },
  };
}

export default async function ListenPage() {
  const [catalog, locale] = await Promise.all([getCatalog(), requestLocale()]);
  const now = requestTime();
  const cards = buildListenCards(
    {
      ...catalog,
      events: catalog.events.map((event) => ({
        ...event,
        title: localizedTitle(event, locale),
      })),
    },
    now,
  );
  return (
    <main id="main" className="listen-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            pageStructuredData(
              "/listen",
              copy(locale, "Hören & Partys finden", "Listen & find parties"),
              locale,
            ),
          ),
        }}
      />
      <DemoNotice mode={catalog.mode} locale={locale} />
      <header className="listen-page-header">
        <p className="eyebrow">
          EVRYVIBE / {copy(locale, "ENTDECKEN", "DISCOVER")}
        </p>
        <h1>
          {copy(locale, "Hören. Gefällt. Hingehen.", "Listen. Like. Go.")}
        </h1>
        <p>
          {copy(
            locale,
            "Dein Sound. Die nächste Party dazu.",
            "Your sound. Your next party.",
          )}
        </p>
      </header>
      <ListenFeed cards={cards} locale={locale} now={now} />
    </main>
  );
}
