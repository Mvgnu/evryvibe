import { pageStructuredData, serializeJsonLd } from "@/core/structured-data";
import { Icon } from "@/components/icon";
import type { Metadata } from "next";
import Link from "next/link";
import { localizePath } from "@/core/i18n";
import { operator } from "@/core/operator";
import { pageMetadata } from "@/core/site";
import { requestLocale } from "@/lib/locale";

const description = (de: boolean) =>
  de
    ? "Betreiber und Kontaktmöglichkeiten von EVRYVIBE."
    : "EVRYVIBE operator details and contact information.";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return pageMetadata(
    locale === "de" ? "Impressum" : "Legal notice",
    description(locale === "de"),
    "/impressum",
    locale,
  );
}

export default async function ImprintPage() {
  const locale = await requestLocale();
  const de = locale === "de";
  return (
    <main id="main" className="detail-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            pageStructuredData(
              "/impressum",
              de ? "Impressum" : "Legal notice",
              locale,
              { description: description(de) },
            ),
          ),
        }}
      />
      <Link className="back-link" href={localizePath("/", locale)}>
        <Icon name="arrow-left" /> {de ? "Alle Nächte" : "All nights"}
      </Link>
      <article className="legal-page">
        <h1>{de ? "Impressum" : "Legal notice"}</h1>
        <p>
          {de ? "Angaben gemäß " : "Information under "}
          <a href="https://www.gesetze-im-internet.de/ddg/__5.html">
            § 5 Digitale-Dienste-Gesetz (DDG)
          </a>
        </p>
        <section>
          <h2>{de ? "Betreiber" : "Operator"}</h2>
          <address>
            {operator.name}
            <br />
            {operator.street}
            <br />
            {operator.postalCode} {operator.city}
            <br />
            {operator.country[locale]}
          </address>
        </section>
        <section>
          <h2>{de ? "Kontakt" : "Contact"}</h2>
          <p>
            {de ? "Allgemeine Anfragen" : "General enquiries"}:{" "}
            <a href={`mailto:${operator.email.general}`}>
              {operator.email.general}
            </a>
          </p>
          <p>
            {de ? "Direkt an Magnus Ohle" : "Contact Magnus Ohle directly"}:{" "}
            <a href={`mailto:${operator.email.direct}`}>
              {operator.email.direct}
            </a>
          </p>
          <p>
            {de ? "Rechtliches und Datenschutz" : "Legal and privacy enquiries"}
            :{" "}
            <a href={`mailto:${operator.email.legal}`}>
              {operator.email.legal}
            </a>
          </p>
        </section>
        <p>
          <Link href={localizePath("/datenschutz", locale)}>
            {de ? "Datenschutzerklärung" : "Privacy policy"}
          </Link>
        </p>
      </article>
    </main>
  );
}
