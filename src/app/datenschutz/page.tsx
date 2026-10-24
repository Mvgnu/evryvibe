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
    ? "Informationen zur Datenverarbeitung bei EVRYVIBE und zu deinen Rechten."
    : "How EVRYVIBE processes personal data and how to exercise your rights.";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return pageMetadata(
    locale === "de" ? "Datenschutz" : "Privacy policy",
    description(locale === "de"),
    "/datenschutz",
    locale,
  );
}

export default async function PrivacyPage() {
  const locale = await requestLocale();
  const de = locale === "de";
  const sections = de
    ? [
        {
          title: "Beim Besuch der Website",
          text: "EVRYVIBE dient der Entdeckung von Events, Venues und DJs. Es gibt keine Besucherkonten, Newsletter, Zahlungen oder Werbetrackingdienste. Schriftarten werden vom eigenen Server ausgeliefert. Für die Auslieferung der Website werden insbesondere IP-Adresse, angeforderte URL und technische Verbindungsdaten verarbeitet. Grundlage ist Art. 6 Abs. 1 lit. f DSGVO: unser Interesse an einer erreichbaren, sicheren Website.",
        },
        {
          title: "Hosting und technische Protokolle",
          text: "Die Website und Datenbank werden bei UpCloud am Standort Frankfurt am Main, Deutschland, betrieben. Der Hostinganbieter verarbeitet technische Daten für den Betrieb der Infrastruktur. Reguläre Webserver-Zugriffsprotokolle sind deaktiviert. Fehler-, Sicherheits- und Betriebsprotokolle können insbesondere IP-Adressen, Zeitpunkte, angeforderte URLs und Fehlermeldungen enthalten und werden höchstens 14 Tage aufbewahrt. Sie dienen der Fehlerbehebung und Abwehr von Missbrauch (Art. 6 Abs. 1 lit. f DSGVO). Datenbanksicherungen liegen auf demselben Server und werden bei den täglichen Sicherungsläufen nach einer regulären Aufbewahrungszeit von sieben Tagen entfernt.",
        },
        {
          title: "Besuchsstatistik mit Minilytics",
          text: "Wir betreiben Minilytics auf unserem OVH-Server, um Seitenaufrufe, die sichtbare Nutzungsdauer sowie Klicks auf Navigation und externe Links auszuwerten. Erfasst werden öffentliche Seitenpfade, Zeitpunkte, die Herkunfts-Domain und Linkziele ohne Suchparameter oder Fragmente. Formularinhalte werden nicht erfasst. Die Übermittlung erfolgt zunächst an EVRYVIBE und von dort an unseren Statistikserver. Es werden keine Analyse-Cookies, dauerhaften Besucherkennungen oder Analyse-Daten im localStorage oder sessionStorage gespeichert.",
          more: "Für die serverseitige Zuordnung einer Sitzung werden IP-Adresse und Browserkennung vorübergehend übertragen und mittels HMAC in einen sitzungsspezifischen Zuordnungsschlüssel umgewandelt. Der Schlüssel läuft nach 30 Minuten Inaktivität ab; abgelaufene Schlüssel und Sitzungsdatensätze älter als einen Tag werden regelmäßig gelöscht. Die IP-Adresse wird nicht in den Statistikdatensätzen gespeichert. Ereignisstatistiken bleiben für die Auswertung erhalten. Es gibt keine Verknüpfung mit einem Besucherkonto oder eine dauerhafte Besucherkennung. Do Not Track und Global Privacy Control werden berücksichtigt. Grundlage ist unser berechtigtes Interesse an der Verbesserung der Evententdeckung (Art. 6 Abs. 1 lit. f DSGVO). Du kannst dieser Verarbeitung widersprechen; kontaktiere legal@evryvibe.com.",
        },
        {
          title: "Deine Darstellungseinstellung",
          text: "Ohne eigene Auswahl ist die dunkle Darstellung aktiv. Wenn du zwischen heller und dunkler Darstellung wechselst, speichert dein Browser diese Wahl unter dem Schlüssel „evryvibe-theme“ im localStorage. Diese Einstellung wird nicht an uns übermittelt und bleibt bestehen, bis du sie änderst oder die Websitedaten im Browser löschst. Die Speicherung dient der von dir ausdrücklich gewählten Darstellung (§ 25 Abs. 2 Nr. 2 TDDDG).",
        },
        {
          title: "Öffentliche Event-, Venue- und DJ-Daten",
          text: "Wir übernehmen öffentlich zugängliche Angaben aus Instagram-Profilen, Beiträgen und zum Erfassungszeitpunkt sichtbaren Stories. Texte aus Bildern und einzelnen Videobildern werden per Texterkennung (OCR) ausgelesen. Dazu gehören Künstler- und Profilnamen, Beschreibungen, Auftritte und Lineups, Veranstaltungsorte, Termine sowie Profil-, Quellen- und Ticketlinks. Die erfassten Textangaben können auch nach Ablauf einer Story für die Eventbeschreibung benötigt werden; Story-Bilder und Videobilder veröffentlichen wir nicht. Soweit Angaben Personen betreffen, verarbeiten und veröffentlichen wir sie zur Evententdeckung auf Grundlage unseres berechtigten Interesses nach Art. 6 Abs. 1 lit. f DSGVO. Diese Information betrifft auch Personen, deren Daten wir nicht direkt bei ihnen erhoben haben (Art. 14 DSGVO).",
          more: "Wir speichern diese Daten, solange sie für die Darstellung von Events und zugehörigen Profilen benötigt werden; unrichtige oder nicht mehr benötigte personenbezogene Angaben werden berichtigt oder gelöscht. Für Auskunft zur konkreten Quelle, eine Korrektur, Löschung oder einen Widerspruch kontaktiere legal@evryvibe.com. Bitte nenne die betroffene Seite, damit wir die Angaben zuordnen können.",
        },
        {
          title: "Bilder und Texterkennung",
          text: "Für die Texterkennung werden Bilder und ausgewählte Videobilder während der Erfassung vorübergehend verarbeitet. Wir speichern diese Bilder nicht als eigene Event-Flyer und stellen abgelaufene Stories nicht über Bildadressen erneut bereit. Auf der Website erscheinen Textinformationen und, nach deiner Einwilligung, öffentliche Instagram-Beiträge sowie einzelne Titelbilder öffentlicher Beiträge oder Reels, die direkt von Instagram geladen werden.",
        },
        {
          title: "Instagram-Inhalte und externe Links",
          text: "Beim ersten Besuch fragen wir per Dialog nach deiner Wahl für externe Medien; Instagram und SoundCloud kannst du dort gemeinsam oder einzeln zulassen. Instagram-Beiträge und Profilvorschauen bleiben bis zu deiner Zustimmung als Platzhalter sichtbar; Titelbilder öffentlicher Beiträge oder Reels werden bis dahin nicht angefragt. Erst nach deiner Zustimmung im Dialog oder über die Schaltfläche zum Laden eines Instagram-Inhalts laden wir Einbettungen und ausgewählte Original-Titelbilder direkt von Instagram (Art. 6 Abs. 1 lit. a DSGVO und, soweit Informationen auf deinem Gerät gespeichert oder ausgelesen werden, § 25 Abs. 1 TDDDG). Instagram wird in Europa von Meta Platforms Ireland Limited angeboten. Dabei können IP-Adresse, Browserdaten und die besuchte Seite übermittelt sowie Cookies oder ähnliche Technologien verwendet werden. Wenn du bei Instagram angemeldet bist, kann Meta den Besuch deinem Konto zuordnen. Eine Verarbeitung auch in den USA und anderen Ländern ist möglich.",
          more: "Deine Zustimmung oder Ablehnung für Instagram wird sechs Monate lang in einem Cookie auf deinem Gerät gespeichert (evryvibe-instagram-consent, SameSite=Lax). Du kannst sie jederzeit über „Einstellungen“ im Kopfbereich ändern. Beim Widerruf werden geladene Einbettungen und Titelbilder entfernt; bereits übertragene Daten oder von Instagram gespeicherte Cookies werden dadurch nicht gelöscht. Der normale Link zum Originalbeitrag oder Profil bleibt verfügbar. Abgelaufene Stories werden weder eingebettet noch als Titelbild geladen. Ticket-, Website- und andere externe Links öffnen Angebote eigenständiger Anbieter, deren Datenschutzbedingungen dort gelten.",
        },
        {
          title: "SoundCloud-Player",
          text: "Auf DJ-, Club- und Eventseiten betten wir für bekannte SoundCloud-Profile den Player von SoundCloud ein. Er zeigt die öffentlichen Uploads des Profils; wir speichern nur die Adresse des Profils, keine Tracks oder Audiodateien. Der Player wird erst nach deiner Zustimmung geladen – im Dialog für externe Medien oder über die Schaltfläche „SoundCloud-Player laden“ (Art. 6 Abs. 1 lit. a DSGVO und, soweit Informationen auf deinem Gerät gespeichert oder ausgelesen werden, § 25 Abs. 1 TDDDG). Anbieter ist die SoundCloud Global Limited & Co. KG, Rheinsberger Str. 76/77, 10115 Berlin, Deutschland. Beim Laden erhält SoundCloud insbesondere deine IP-Adresse, Browser- und Gerätedaten, die besuchte Seite und den Zeitpunkt des Abrufs. SoundCloud kann Cookies oder ähnliche Technologien verwenden und den Abruf deinem SoundCloud-Konto zuordnen, wenn du dort angemeldet bist. Startest du die Wiedergabe, wird das Audio direkt von SoundCloud gestreamt.",
          more: "Deine Wahl für SoundCloud wird getrennt von der Instagram-Wahl sechs Monate lang in einem Cookie auf deinem Gerät gespeichert (evryvibe-soundcloud-consent, SameSite=Lax). Du kannst sie jederzeit über „Einstellungen“ im Kopfbereich ändern; beim Widerruf werden geladene Player entfernt. Bereits übertragene Daten oder von SoundCloud gespeicherte Cookies werden dadurch nicht gelöscht. Ohne Zustimmung bleibt ein normaler Link zum SoundCloud-Profil sichtbar. Für die Verarbeitung durch SoundCloud gelten dessen Datenschutzhinweise.",
        },
        {
          title: "Kontakt per E-Mail",
          text: "Wenn du uns schreibst, verarbeiten wir deine E-Mail-Adresse, den Nachrichteninhalt und freiwillig mitgeteilte Angaben, um deine Anfrage zu beantworten. Grundlage ist Art. 6 Abs. 1 lit. f DSGVO (Bearbeitung von Anfragen), bei einer vertragsbezogenen Anfrage Art. 6 Abs. 1 lit. b DSGVO. Wir bewahren die Korrespondenz auf, bis die Anfrage abgeschlossen ist, und darüber hinaus nur, soweit gesetzliche Aufbewahrungspflichten oder die Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen dies erfordern.",
        },
        {
          title: "Deine Rechte",
          text: "Nach Maßgabe der DSGVO kannst du Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und, soweit anwendbar, Datenübertragbarkeit verlangen. Einer Verarbeitung aufgrund berechtigter Interessen kannst du aus Gründen deiner besonderen Situation widersprechen. Eine Einwilligung kannst du jederzeit mit Wirkung für die Zukunft widerrufen; die Rechtmäßigkeit der vorherigen Verarbeitung bleibt unberührt. Wende dich dafür an legal@evryvibe.com. Wir treffen keine ausschließlich automatisierten Entscheidungen mit rechtlicher oder ähnlich erheblicher Wirkung über dich.",
        },
      ]
    : [
        {
          title: "Visiting the website",
          text: "EVRYVIBE helps you discover events, venues and DJs. There are no visitor accounts, newsletters, payments or advertising trackers. Fonts are served from our own server. Delivering the website requires processing your IP address, requested URL and technical connection data. Our basis is Article 6(1)(f) GDPR: our legitimate interest in providing an accessible, secure website.",
        },
        {
          title: "Hosting and technical logs",
          text: "The website and database run on UpCloud infrastructure in Frankfurt am Main, Germany. The hosting provider processes technical data to operate that infrastructure. Regular web server access logs are disabled. Error, security and operational logs may contain IP addresses, timestamps, requested URLs and error messages and are retained for no more than 14 days. They support troubleshooting and abuse prevention (Article 6(1)(f) GDPR). Database backups are stored on the same server and removed during daily backup runs after a normal retention period of seven days.",
        },
        {
          title: "Visit statistics with Minilytics",
          text: "We run Minilytics on our OVH server to measure page views, time spent on visible pages, and clicks on navigation and external links. Records contain public page paths, timestamps, the referring domain and link destinations without query parameters or fragments. Form contents are not recorded. Events go first to EVRYVIBE and from there to our statistics server. We use no analytics cookies, persistent visitor identifiers or analytics data in localStorage or sessionStorage.",
          more: "To assign events to a session on the server, the IP address and browser identifier are transmitted temporarily and converted with HMAC into a session matching key. This key expires after 30 minutes of inactivity; expired keys and session records older than one day are regularly deleted. The IP address is not stored in analytics records. Event statistics remain available for analysis. There is no association with a visitor account or persistent visitor identifier. We respect Do Not Track and Global Privacy Control. Our basis is our legitimate interest in improving event discovery (Article 6(1)(f) GDPR). You may object to this processing by contacting legal@evryvibe.com.",
        },
        {
          title: "Your display preference",
          text: "Without a choice of your own, the dark theme is shown. When you switch between light and dark themes, your browser saves that choice in localStorage under “evryvibe-theme”. This setting is not sent to us and remains until you change it or delete the website’s browser data. Storage provides the display preference you explicitly selected (section 25(2), no. 2 TDDDG).",
        },
        {
          title: "Public event, venue and DJ data",
          text: "We collect publicly accessible information from Instagram profiles, posts and stories visible at collection time. Text in images and selected video frames is extracted using optical character recognition (OCR). This includes artist and profile names, descriptions, appearances and lineups, venues, dates, and profile, source and ticket links. Extracted facts may remain necessary for an event description after a story expires; we do not publish the story images or video frames. Where information relates to individuals, we process and publish it for event discovery based on our legitimate interest under Article 6(1)(f) GDPR. This notice also covers people whose data we did not obtain directly from them (Article 14 GDPR).",
          more: "We retain these records while needed to present events and related profiles; inaccurate or no longer needed personal information is corrected or deleted. Contact legal@evryvibe.com for the specific source, a correction, deletion or an objection. Please identify the affected page so we can locate the record.",
        },
        {
          title: "Images and text recognition",
          text: "Images and selected video frames are processed temporarily for text recognition during collection. We do not store those images as our own event flyers or make expired stories available again through image URLs. The website presents text information and, after your consent, public Instagram posts and selected cover images of public posts or reels loaded directly from Instagram.",
        },
        {
          title: "Instagram content and external links",
          text: "On your first visit, a dialog asks for your choice on external media; you can allow Instagram and SoundCloud together or separately. Instagram posts and profile previews remain as placeholders until you accept; cover images of public posts or reels are not requested until then. Embeds and selected original cover images load directly from Instagram only after you agree in the dialog or with the button that loads an Instagram item (Article 6(1)(a) GDPR and, where information is stored on or read from your device, section 25(1) TDDDG). Instagram is provided in Europe by Meta Platforms Ireland Limited. Your IP address, browser data and visited page may be transmitted, and cookies or similar technologies may be used. If you are signed in to Instagram, Meta may associate the visit with your account. Processing may also take place in the United States and other countries.",
          more: "Your Instagram acceptance or rejection is stored in a cookie on your device for six months (evryvibe-instagram-consent, SameSite=Lax). You can change it at any time through “Settings” in the header. Withdrawing consent removes loaded embeds and cover images; it does not erase data already transmitted or cookies stored by Instagram. The ordinary link to the original post or profile remains available. Expired stories are neither embedded nor loaded as covers. Ticket, website and other external links lead to independent providers whose privacy terms apply there.",
        },
        {
          title: "SoundCloud players",
          text: "On DJ, venue and event pages we embed SoundCloud’s own player for known SoundCloud profiles. It shows the profile’s public uploads; we store only the profile address, never tracks or audio files. The player loads only after you agree – in the external media dialog or with the “Load SoundCloud player” button (Article 6(1)(a) GDPR and, where information is stored on or read from your device, section 25(1) TDDDG). The provider is SoundCloud Global Limited & Co. KG, Rheinsberger Str. 76/77, 10115 Berlin, Germany. When the player loads, SoundCloud receives in particular your IP address, browser and device data, the visited page and the time of the request. SoundCloud may use cookies or similar technologies and may associate the request with your SoundCloud account if you are signed in. If you start playback, the audio streams directly from SoundCloud.",
          more: "Your SoundCloud choice is stored separately from your Instagram choice in a cookie on your device for six months (evryvibe-soundcloud-consent, SameSite=Lax). You can change it at any time through “Settings” in the header; withdrawing consent removes loaded players. It does not erase data already transmitted or cookies stored by SoundCloud. Without consent, an ordinary link to the SoundCloud profile remains visible. SoundCloud’s own privacy policy applies to its processing.",
        },
        {
          title: "Contact by email",
          text: "When you email us, we process your email address, message and any information you choose to provide to answer your enquiry. Our basis is Article 6(1)(f) GDPR (handling enquiries), or Article 6(1)(b) GDPR for contract-related enquiries. We retain correspondence until the enquiry is resolved, and longer only where statutory retention requirements or the establishment, exercise or defence of legal claims require it.",
        },
        {
          title: "Your rights",
          text: "Subject to the GDPR’s conditions, you may request access, rectification, erasure, restriction and, where applicable, data portability. You may object to processing based on legitimate interests for reasons relating to your particular situation. You may withdraw consent at any time for the future; earlier lawful processing remains unaffected. Contact legal@evryvibe.com to exercise your rights. We do not make decisions about you based solely on automated processing that produce legal or similarly significant effects.",
        },
      ];

  return (
    <main id="main" className="detail-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            pageStructuredData(
              "/datenschutz",
              de ? "Datenschutz" : "Privacy policy",
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
        <h1>{de ? "Datenschutzerklärung" : "Privacy policy"}</h1>
        <section>
          <h2>{de ? "Verantwortlicher" : "Controller"}</h2>
          <address>
            {operator.name}
            <br />
            {operator.street}
            <br />
            {operator.postalCode} {operator.city}, {operator.country[locale]}
            <br />
            <a href={`mailto:${operator.email.legal}`}>
              {operator.email.legal}
            </a>
          </address>
        </section>
        {sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            <p>{section.text}</p>
            {section.more && <p>{section.more}</p>}
          </section>
        ))}
        <p>
          {de
            ? "Du kannst dich bei einer Datenschutzaufsichtsbehörde beschweren, insbesondere beim "
            : "You may lodge a complaint with a supervisory authority, including the "}
          <a href="https://www.baden-wuerttemberg.datenschutz.de/beschwerdeformular/">
            {de
              ? "Landesbeauftragten für den Datenschutz und die Informationsfreiheit Baden-Württemberg"
              : "State Commissioner for Data Protection and Freedom of Information Baden-Württemberg"}
          </a>
          .
        </p>
        <section>
          <h2>{de ? "Weiterführende Informationen" : "Further information"}</h2>
          <ul>
            <li>
              <a
                href={`https://eur-lex.europa.eu/legal-content/${de ? "DE" : "EN"}/ALL/?uri=celex%3A32016R0679`}
              >
                {de
                  ? "Datenschutz-Grundverordnung (DSGVO)"
                  : "General Data Protection Regulation (GDPR)"}
              </a>
            </li>
            <li>
              <a href="https://www.gesetze-im-internet.de/ttdsg/__25.html">
                § 25 TDDDG
              </a>
            </li>
            <li>
              <a href="https://privacycenter.instagram.com/policy/">
                {de
                  ? "Instagram-Datenschutzrichtlinie"
                  : "Instagram privacy policy"}
              </a>
            </li>
            <li>
              <a href="https://soundcloud.com/pages/privacy">
                {de
                  ? "SoundCloud-Datenschutzerklärung"
                  : "SoundCloud privacy policy"}
              </a>
            </li>
            <li>
              <Link href={localizePath("/impressum", locale)}>
                {de
                  ? "Impressum und weitere Kontakte"
                  : "Legal notice and further contacts"}
              </Link>
            </li>
          </ul>
        </section>
      </article>
    </main>
  );
}
