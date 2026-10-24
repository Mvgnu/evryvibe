import { Icon } from "@/components/icon";
import Link from "next/link";
import { headers } from "next/headers";
import { z } from "zod";
import { isOperatorAuthorized } from "@/ops/auth";
import { callOperatorTool, OperatorToolError } from "@/ops/mcp";
import { venueSourceSchema } from "@/core/sources";
import {
  RefreshSources,
  SourceSwitch,
  VenueForm,
  ProfileForm,
} from "./controls";
import "./sources.css";

export const metadata = {
  title: "Sources · EVRYVIBE operator",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
function date(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(value)) + " UTC"
    : "Not yet";
}
export default async function SourcesPage() {
  if (
    !isOperatorAuthorized(
      (await headers()).get("authorization"),
      process.env.EVRYVIBE_OPERATOR_PASSWORD,
    )
  )
    return (
      <main id="main" className="ops-surface">
        <h1>Operator sign-in required</h1>
        <p>Reload and sign in with your operator credentials.</p>
      </main>
    );
  let sources: z.infer<typeof venueSourceSchema>[] = [];
  let error: string | null = null;
  try {
    sources = z
      .object({ sources: z.array(venueSourceSchema) })
      .parse(await callOperatorTool("list_venue_sources", {})).sources;
  } catch (failure) {
    error =
      failure instanceof OperatorToolError
        ? failure.message
        : "The source list could not be read. Refresh to try again.";
  }
  const enabled = sources.filter((source) => source.enabled).length;
  return (
    <main id="main" className="ops-surface">
      <div className="ops-topline">
        <span>EVRYVIBE / OPERATOR</span>
        <Link href="/">
          Back to discovery <Icon name="arrow-up-right" />
        </Link>
      </div>
      <header className="ops-heading">
        <div>
          <p className="ops-eyebrow">VENUE COLLECTION</p>
          <h1>Source control.</h1>
          <p>
            Choose the venues to collect from. Check the last run. Keep the
            queue moving.
          </p>
        </div>
        <RefreshSources />
      </header>
      <div className="ops-summary">
        <div>
          <strong>{error ? "—" : sources.length}</strong>
          <span>registered venues</span>
        </div>
        <div>
          <strong>{error ? "—" : enabled}</strong>
          <span>enabled sources</span>
        </div>
        <p>
          Enabling a source makes it eligible for the next collector run.
          Collection starts only when you run the collector.
        </p>
      </div>
      <section aria-labelledby="sources-heading">
        <div className="ops-section-title">
          <h2 id="sources-heading">Instagram sources</h2>
          <span>LIVE CONFIGURATION</span>
        </div>
        {error ? (
          <div className="ops-empty" role="alert">
            <h3>Sources unavailable</h3>
            <p>{error}</p>
            <RefreshSources />
          </div>
        ) : sources.length === 0 ? (
          <div className="ops-empty">
            <h3>Start with a venue.</h3>
            <p>
              No venues are registered. Add a venue below, then enable its
              Instagram source.
            </p>
            <a href="#register-venue">
              Register a venue <Icon name="arrow-down" />
            </a>
          </div>
        ) : (
          <div className="ops-source-list">
            {sources.map((source) => (
              <article className="ops-source" key={source.venueId}>
                <div className="ops-source-title">
                  <div>
                    <span className="ops-eyebrow">{source.city}</span>
                    <h3>{source.name}</h3>
                    {source.instagramUrl ? (
                      <a
                        href={source.instagramUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {new URL(source.instagramUrl).pathname.replaceAll(
                          "/",
                          "",
                        )}{" "}
                        <Icon name="arrow-up-right" />
                      </a>
                    ) : (
                      <p className="ops-muted">No Instagram profile</p>
                    )}
                    <small className="ops-slug">
                      {source.slug} · revision {source.revision}
                    </small>
                  </div>
                  <SourceSwitch
                    key={`${source.venueId}-${source.revision}`}
                    venueId={source.venueId}
                    revision={source.revision}
                    enabled={source.enabled}
                    hasProfile={!!source.instagramUrl}
                    name={source.name}
                  />
                </div>
                <ProfileForm
                  key={`profile-${source.venueId}-${source.revision}`}
                  venueId={source.venueId}
                  revision={source.revision}
                  instagramUrl={source.instagramUrl}
                />
                <dl className="ops-run-stats">
                  <div>
                    <dt>Last started</dt>
                    <dd>{date(source.lastStartedAt)}</dd>
                  </div>
                  <div>
                    <dt>Last success</dt>
                    <dd>{date(source.lastSucceededAt)}</dd>
                  </div>
                  <div>
                    <dt>Posts queued · last run</dt>
                    <dd>{source.lastStartedAt ? source.lastPostCount : "—"}</dd>
                  </div>
                </dl>
                {source.lastError && (
                  <p className="ops-error" role="status">
                    <strong>Last run failed.</strong> {source.lastError}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
      <section
        className="ops-register"
        id="register-venue"
        aria-labelledby="register-heading"
      >
        <div className="ops-section-title">
          <h2 id="register-heading">Register or update a venue</h2>
          <span>NEW SOURCES START DISABLED</span>
        </div>
        <p>
          Enter confirmed venue details. An Instagram profile is required to
          enable collection.
        </p>
        <VenueForm />
      </section>
    </main>
  );
}
