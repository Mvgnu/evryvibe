import type { Catalog, Event } from "@/core/model";
import type { Locale } from "@/core/i18n";
import { copy } from "@/components/catalog-ui";
import { EventList } from "@/components/event-days";

export function PastEvents({
  events,
  catalog,
  locale,
}: {
  events: Event[];
  catalog: Catalog;
  locale: Locale;
}) {
  if (!events.length) return null;
  return (
    <details className="pf-section pf-dates pf-past">
      <summary className="pf-label-row">
        <span className="pf-label">
          {copy(locale, "Vergangene Events", "Past events")}
        </span>
        <span>{events.length}</span>
      </summary>
      <EventList events={events} catalog={catalog} locale={locale} />
    </details>
  );
}
