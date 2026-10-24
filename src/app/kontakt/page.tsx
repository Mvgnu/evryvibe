import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { localizePath } from "@/core/i18n";
import { operator } from "@/core/operator";
import { pageMetadata } from "@/core/site";
import { pageStructuredData, serializeJsonLd } from "@/core/structured-data";
import { requestLocale } from "@/lib/locale";

const description = (de: boolean) =>
  de
    ? "Kontaktiere EVRYVIBE zu Events, Korrekturen, Zusammenarbeit, Datenschutz oder der Entfernung von Inhalten."
    : "Contact EVRYVIBE about events, corrections, partnerships, privacy or content removal.";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return pageMetadata(
    locale === "de" ? "Kontakt" : "Contact",
    description(locale === "de"),
    "/kontakt",
    locale,
  );
}

export default async function ContactPage() {
  const locale = await requestLocale();
  const de = locale === "de";
  return (
    <main id="main" className="detail-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            pageStructuredData("/kontakt", de ? "Kontakt" : "Contact", locale, {
              description: description(de),
              type: "ContactPage",
            }),
          ),
        }}
      />
      <Link className="back-link" href={localizePath("/", locale)}>
        <Icon name="arrow-left" /> {de ? "Alle Nächte" : "All nights"}
      </Link>
      <article className="legal-page">
        <h1>{de ? "Kontakt" : "Contact"}</h1>
        <p>
          {de
            ? "Wähle die passende Adresse für dein Anliegen und schreib uns per E-Mail."
            : "Choose the address that matches your enquiry and send us an email."}
        </p>
        <section id="general">
          <h2>{de ? "Fragen und Korrekturen" : "Questions and corrections"}</h2>
          <p>
            {de
              ? "Für allgemeine Fragen, Hinweise zu Events und Korrekturen an Terminen, Orten oder Line-ups. Ein Link zur betroffenen Seite hilft bei der Zuordnung."
              : "For general questions, event information and corrections to dates, venues or lineups. A link to the affected page helps us find the record."}
          </p>
          <a href={`mailto:${operator.email.general}`}>
            {operator.email.general}
          </a>
        </section>
        <section id="partnerships">
          <h2>
            {de
              ? "Zusammenarbeit und direkter Kontakt"
              : "Partnerships and direct contact"}
          </h2>
          <p>
            {de
              ? "Für Anfragen zur Zusammenarbeit oder wenn du Magnus Ohle direkt erreichen möchtest."
              : "For partnership enquiries or to contact Magnus Ohle directly."}
          </p>
          <a href={`mailto:${operator.email.direct}`}>
            {operator.email.direct}
          </a>
        </section>
        <section id="legal">
          <h2>
            {de
              ? "Beschwerden, Datenschutz und Entfernung"
              : "Complaints, privacy and removal"}
          </h2>
          <p>
            {de
              ? "Für rechtliche Anliegen, Datenschutzanfragen, Beschwerden über Inhalte und Anfragen zur Entfernung von Einträgen, Bildern oder Profilinformationen auf EVRYVIBE."
              : "For legal matters, privacy enquiries, content complaints and requests to remove listings, images or profile information from EVRYVIBE."}
          </p>
          <a href={`mailto:${operator.email.legal}`}>{operator.email.legal}</a>
          <p>
            <Link href={localizePath("/takedown", locale)}>
              {de
                ? "Hinweise für eine Entfernungsanfrage"
                : "How to request content removal"}
            </Link>
          </p>
        </section>
        <p>
          <Link href={localizePath("/datenschutz", locale)}>
            {de
              ? "Datenschutz bei Kontaktanfragen"
              : "Privacy information for contact enquiries"}
          </Link>
          {" · "}
          <Link href={localizePath("/impressum", locale)}>
            {de ? "Impressum" : "Legal notice"}
          </Link>
        </p>
      </article>
    </main>
  );
}
