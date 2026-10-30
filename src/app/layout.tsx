import { MapListeningProvider } from "@/components/map-listening";
import { MinilyticsAnalytics } from "@/components/minilytics-analytics";
import { requestLocale } from "@/lib/locale";
import type { Metadata } from "next";
import { isPublicSite, siteTitle, siteUrl } from "@/core/site";
import { Header, Footer } from "@/components/site-chrome";
import { MediaConsentProvider } from "@/components/media-consent";
import { consentCookies, parseConsent } from "@/components/consent-state";
import { cookies } from "next/headers";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "@fontsource/barlow-condensed/latin-900.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "./globals.css";
import "./poster.css";
import "./listing.css";
import "./detail.css";
import "./cities.css";
import "./night-map.css";
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    metadataBase: new URL(siteUrl),
    // Indexing is the default; only non-public builds opt out. Asserting
    // "index, follow" here would contradict Next's noindex on 404 responses.
    ...(isPublicSite() ? {} : { robots: { index: false, follow: false } }),
    title: locale === "de" ? siteTitle : "EVRYVIBE — Techno parties and events",
  };
}
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await requestLocale();
  // Saved choices are read on the server so a returning visitor never sees
  // the consent dialog flash during page load.
  const jar = await cookies();
  const instagram = parseConsent(jar.get(consentCookies.instagram)?.value);
  const soundcloud = parseConsent(jar.get(consentCookies.soundcloud)?.value);
  return (
    <html lang={locale} suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(()=>{let saved;try{saved=localStorage.getItem("evryvibe-theme")}catch{}const root=document.documentElement;root.dataset.theme=saved==="light"?"light":"dark";root.dataset.js=""})()`,
          }}
        />
      </head>
      <body>
        <a className="skip-link" href="#main">
          {locale === "de" ? "Zum Inhalt" : "Skip to content"}
        </a>
        <MediaConsentProvider
          locale={locale}
          initialConsent={instagram}
          initialSoundcloud={soundcloud}
        >
          <MapListeningProvider>
            <Header locale={locale} />
            {children}
            <Footer locale={locale} />
          </MapListeningProvider>
          {process.env.MINILYTICS_COLLECTOR_URL &&
            process.env.MINILYTICS_SITE_ID &&
            process.env.MINILYTICS_SITE_SECRET &&
            process.env.EVRYVIBE_DEMO !== "1" && <MinilyticsAnalytics />}
        </MediaConsentProvider>
      </body>
    </html>
  );
}
