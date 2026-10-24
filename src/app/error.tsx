"use client";
import { usePathname } from "next/navigation";
export default function ErrorPage({ reset }: { reset: () => void }) {
  const de = !usePathname().startsWith("/en");
  return (
    <main id="main" className="empty-state page-empty">
      <span>{de ? "Fehler" : "Error"}</span>
      <h1>{de ? "Seite konnte nicht laden" : "This page couldn’t load"}</h1>
      <p>
        {de
          ? "Die Events konnten gerade nicht geladen werden. Bitte versuche es erneut."
          : "We couldn’t load the events just now. Please try again."}
      </p>
      <div className="page-empty-actions">
        <button className="button" type="button" onClick={reset}>
          {de ? "Erneut versuchen" : "Try again"}
        </button>
      </div>
    </main>
  );
}
