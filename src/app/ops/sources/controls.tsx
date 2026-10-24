"use client";
import { Icon } from "@/components/icon";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { changeSource, changeProfile, registerVenue } from "./actions";
import { initialActionState } from "@/ops/forms";

export function RefreshSources() {
  const router = useRouter();
  return (
    <button className="ops-secondary" onClick={() => router.refresh()}>
      Refresh list <Icon name="refresh" />
    </button>
  );
}
export function SourceSwitch({
  venueId,
  revision,
  enabled,
  hasProfile,
  name,
}: {
  venueId: string;
  revision: number;
  enabled: boolean;
  hasProfile: boolean;
  name: string;
}) {
  const [state, action, pending] = useActionState(
    changeSource,
    initialActionState,
  );
  return (
    <form action={action} className="ops-switch-form">
      <input type="hidden" name="venueId" value={venueId} />
      <input type="hidden" name="expectedRevision" value={revision} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <button
        className={`ops-switch ${enabled ? "is-on" : ""}`}
        type="submit"
        role="switch"
        aria-checked={enabled}
        aria-label={`Collect Instagram posts from ${name}`}
        disabled={pending || (!enabled && !hasProfile)}
      >
        <span aria-hidden="true" />
        {pending ? "Saving…" : enabled ? "Enabled" : "Disabled"}
      </button>
      {state.message && (
        <p
          className={state.status === "error" ? "ops-error" : "ops-success"}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      )}
      {!hasProfile && (
        <p className="ops-muted">Add an Instagram profile to enable.</p>
      )}
    </form>
  );
}
export function VenueForm() {
  const [values, setValues] = useState<Record<string, string>>({});
  const field = (name: string) => ({
    value: values[name] ?? "",
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => setValues((previous) => ({ ...previous, [name]: event.target.value })),
  });
  const [state, action, pending] = useActionState(
    registerVenue,
    initialActionState,
  );
  return (
    <form action={action} className="ops-venue-form">
      <div className="ops-form-grid">
        <label>
          Venue name
          <input
            name="name"
            {...field("name")}
            required
            maxLength={200}
            placeholder="Venue name"
          />
        </label>
        <label>
          Slug
          <input
            name="slug"
            {...field("slug")}
            required
            maxLength={160}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            placeholder="venue-name"
          />
          <small>
            Stable URL name. Use an existing slug to update that venue.
          </small>
        </label>
        <label>
          City
          <input
            name="city"
            {...field("city")}
            required
            maxLength={200}
            placeholder="City"
          />
        </label>
        <label>
          Country
          <input
            name="country"
            {...field("country")}
            required
            minLength={2}
            maxLength={100}
            placeholder="Country"
          />
        </label>
        <label>
          Street address
          <input
            name="address"
            {...field("address")}
            required
            maxLength={200}
            placeholder="Street and number"
          />
        </label>
        <label>
          Timezone
          <input
            name="timezone"
            {...field("timezone")}
            required
            maxLength={100}
            placeholder="Europe/Berlin"
          />
          <small>IANA timezone, e.g. Europe/Berlin.</small>
        </label>
        <label>
          Instagram profile <span>(optional)</span>
          <input
            name="instagramUrl"
            {...field("instagramUrl")}
            type="url"
            maxLength={2000}
            placeholder="https://www.instagram.com/venue/"
          />
        </label>
        <label>
          Website <span>(optional)</span>
          <input
            name="websiteUrl"
            {...field("websiteUrl")}
            type="url"
            maxLength={2000}
            placeholder="https://…"
          />
        </label>
        <label className="ops-full">
          Description <span>(optional)</span>
          <textarea
            name="description"
            {...field("description")}
            rows={3}
            maxLength={10000}
            placeholder="Confirmed information about the venue"
          />
        </label>
      </div>
      <p className="ops-muted">
        Saving updates all fields for a matched venue. Use its current details;
        empty optional fields clear those values. To change an existing
        Instagram profile, use “Edit Instagram profile” in the source list. New
        venues are disabled until you enable collection.
      </p>
      {state.message && (
        <p
          className={state.status === "error" ? "ops-error" : "ops-success"}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      )}
      <button className="ops-primary" disabled={pending}>
        {pending ? "Saving venue…" : "Save venue +"}
      </button>
    </form>
  );
}

export function ProfileForm({
  venueId,
  revision,
  instagramUrl,
}: {
  venueId: string;
  revision: number;
  instagramUrl: string | null;
}) {
  const [state, action, pending] = useActionState(
    changeProfile,
    initialActionState,
  );
  const [value, setValue] = useState(instagramUrl ?? "");
  return (
    <details className="ops-profile-edit">
      <summary>Edit Instagram profile</summary>
      <form action={action}>
        <input type="hidden" name="venueId" value={venueId} />
        <input type="hidden" name="expectedRevision" value={revision} />
        <label>
          Instagram profile URL
          <input
            type="url"
            name="instagramUrl"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={2000}
            placeholder="https://www.instagram.com/venue/"
          />
        </label>
        <p className="ops-muted">
          Leave blank to remove this profile. Saving disables collection and
          cancels pending submissions from the previous configuration.
        </p>
        <button className="ops-secondary" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </button>
        {state.message && (
          <p
            className={state.status === "error" ? "ops-error" : "ops-success"}
            role={state.status === "error" ? "alert" : "status"}
          >
            {state.message}
          </p>
        )}
      </form>
    </details>
  );
}
