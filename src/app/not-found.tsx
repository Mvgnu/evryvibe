import { requestLocale } from "@/lib/locale";
import { localizePath } from "@/core/i18n";
import Link from "next/link";
import type { Metadata } from "next";
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: {
      absolute:
        locale === "de"
          ? "Seite nicht gefunden · EVRYVIBE"
          : "Page not found · EVRYVIBE",
    },
  };
}
export default async function NotFound() {
  const locale = await requestLocale();
  const de = locale === "de";
  return (
    <main id="main" className="empty-state page-empty">
      <span>404</span>
      <h1>{de ? "Seite nicht gefunden" : "Page not found"}</h1>
      <p>
        {de
          ? "Diese Adresse gibt es nicht oder nicht mehr. Vielleicht wurde der Eintrag entfernt oder der Link ist falsch."
          : "This address doesn’t exist or no longer does. The listing may have been removed, or the link is wrong."}
      </p>
      <div className="page-empty-actions">
        <Link className="button" href={localizePath("/", locale)}>
          {de ? "Alle Nächte" : "All nights"}
        </Link>
        <Link
          className="button button-outline"
          href={localizePath("/cities", locale)}
        >
          {de ? "Städte" : "Cities"}
        </Link>
      </div>
    </main>
  );
}
