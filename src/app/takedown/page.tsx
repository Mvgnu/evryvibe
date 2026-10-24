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
    ? "So kontaktierst du EVRYVIBE für Beschwerden und Anfragen zur Entfernung von Inhalten."
    : "How to contact EVRYVIBE with complaints and content removal requests.";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return pageMetadata(
    locale === "de" ? "Entfernung von Inhalten" : "Content removal",
    description(locale === "de"),
    "/takedown",
    locale,
  );
}

export default async function TakedownPage() {
  const locale = await requestLocale();
  const de = locale === "de";
  return (
    <main id="main" className="detail-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            pageStructuredData(
              "/takedown",
              de ? "Entfernung von Inhalten" : "Content removal",
              locale,
              {
                description: description(de),
                crumbs: [
                  { name: de ? "Kontakt" : "Contact", path: "/kontakt" },
                ],
              },
            ),
          ),
        }}
      />
      <Link className="back-link" href={localizePath("/kontakt", locale)}>
        <Icon name="arrow-left" /> {de ? "Kontakt" : "Contact"}
      </Link>
      <article className="legal-page">
        <h1>{de ? "Entfernung von Inhalten" : "Content removal"}</h1>
        <p>
          {de
            ? "Du möchtest einen Inhalt auf EVRYVIBE melden oder seine Entfernung anfragen? Nutze dafür den Kontakt für Beschwerden, Datenschutz und rechtliche Anliegen."
            : "Want to report content on EVRYVIBE or request its removal? Use our contact for complaints, privacy and legal matters."}
        </p>
        <p>
          <Link
            className="button"
            href={`${localizePath("/kontakt", locale)}#legal`}
          >
            {de ? "Zum zuständigen Kontakt" : "Contact for removal requests"}{" "}
            <Icon name="arrow-up-right" />
          </Link>
        </p>
        <section>
          <h2>
            {de
              ? "Was uns bei der Zuordnung hilft"
              : "Information that helps us locate the issue"}
          </h2>
          <p>
            {de
              ? "Beschreibe dein Anliegen in deinen eigenen Worten. Folgende Angaben helfen dabei:"
              : "Describe your concern in your own words. The following details are helpful:"}
          </p>
          <ul>
            <li>
              {de
                ? "Die URL der betroffenen EVRYVIBE-Seite und, soweit bekannt, der verlinkten Quelle oder des Originalbeitrags."
                : "The affected EVRYVIBE page URL and, if known, the linked source or original post URL."}
            </li>
            <li>
              {de
                ? "Welche Information oder welcher Inhalt betroffen ist, was daran falsch oder problematisch ist und welche Entfernung oder Änderung du möchtest."
                : "Which information or content is involved, what is wrong or concerning, and what you would like removed or changed."}
            </li>
            <li>
              {de
                ? "Wenn relevant: dein Bezug zum Inhalt oder das betroffene Recht, zum Beispiel als abgebildete Person, Urheber oder Vertretung eines Veranstaltungsorts."
                : "Where relevant, your relationship to the content or the right involved, for example as the person depicted, the creator or a venue representative."}
            </li>
            <li>
              {de
                ? "Eine E-Mail-Adresse, unter der wir dir antworten können."
                : "An email address where we can reply."}
            </li>
          </ul>
          <p>
            {de
              ? "Du kannst uns auch schreiben, wenn dir einzelne Angaben fehlen. Bitte sende keine Ausweiskopien oder andere sensible Unterlagen unaufgefordert."
              : "You can still contact us if some details are unavailable. Please do not send identity documents or other sensitive records unless requested."}
          </p>
        </section>
        <section>
          <h2>{de ? "Per E-Mail melden" : "Report by email"}</h2>
          <p>
            <a href={`mailto:${operator.email.legal}`}>
              {operator.email.legal}
            </a>
          </p>
          <p>
            {de
              ? "Diese Kontaktmöglichkeit betrifft Inhalte auf EVRYVIBE. Für die Entfernung eines Originalbeitrags auf Instagram oder einer anderen externen Website wende dich zusätzlich an den jeweiligen Anbieter."
              : "This contact is for content on EVRYVIBE. To remove an original post on Instagram or another external website, also contact that provider."}
          </p>
          <p>
            <Link href={localizePath("/datenschutz", locale)}>
              {de ? "Informationen zum Datenschutz" : "Privacy information"}
            </Link>
          </p>
        </section>
      </article>
    </main>
  );
}
