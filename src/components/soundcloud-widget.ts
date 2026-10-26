// SoundCloud's widget API (https://developers.soundcloud.com/docs/api/html5-widget),
// narrowed from `window.SC` so nothing untyped leaks into the feed.
import { z } from "zod";

export type Widget = {
  bind: (event: string, callback: () => void) => void;
  unbind: (event: string) => void;
  load: (url: string, options: Record<string, unknown>) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  skip: (index: number) => void;
  getSounds: (callback: (sounds: unknown) => void) => void;
  getCurrentSound: (callback: (sound: unknown) => void) => void;
  getCurrentSoundIndex: (callback: (index: unknown) => void) => void;
};

const eventsSchema = z.object({
  READY: z.string(),
  PLAY: z.string(),
  PAUSE: z.string(),
  FINISH: z.string(),
  ERROR: z.string(),
});
export type WidgetEvents = z.infer<typeof eventsSchema>;

const methods = [
  "bind",
  "unbind",
  "load",
  "play",
  "pause",
  "toggle",
  "next",
  "skip",
  "getSounds",
  "getCurrentSound",
  "getCurrentSoundIndex",
] as const;

function isWidget(value: unknown): value is Widget {
  return (
    typeof value === "object" &&
    value !== null &&
    methods.every((name) => typeof Reflect.get(value, name) === "function")
  );
}

/** Wraps an iframe once the SDK script has loaded; null if the SDK is not usable. */
export function connectWidget(
  iframe: HTMLIFrameElement,
): { widget: Widget; events: WidgetEvents } | null {
  const api: unknown = Reflect.get(window, "SC");
  if (typeof api !== "object" || api === null) return null;
  const factory: unknown = Reflect.get(api, "Widget");
  if (typeof factory !== "function") return null;
  const events = eventsSchema.safeParse(Reflect.get(factory, "Events"));
  if (!events.success) return null;
  const widget: unknown = Reflect.apply(factory, api, [iframe]);
  return isWidget(widget)
    ? { widget: guarded(widget), events: events.data }
    : null;
}

/**
 * The SDK posts to the iframe's window and throws once React has removed the
 * iframe (navigation, consent withdrawal). A call to a gone player is a no-op.
 */
function guarded(widget: Widget): Widget {
  const safe =
    <A extends unknown[]>(call: (...args: A) => void) =>
    (...args: A) => {
      try {
        call(...args);
      } catch {
        // The player is gone; nothing to control.
      }
    };
  return {
    bind: safe((event: string, callback: () => void) =>
      widget.bind(event, callback),
    ),
    unbind: safe((event: string) => widget.unbind(event)),
    load: safe((url: string, options: Record<string, unknown>) =>
      widget.load(url, options),
    ),
    play: safe(() => widget.play()),
    pause: safe(() => widget.pause()),
    toggle: safe(() => widget.toggle()),
    next: safe(() => widget.next()),
    skip: safe((index: number) => widget.skip(index)),
    getSounds: safe((callback: (sounds: unknown) => void) =>
      widget.getSounds(callback),
    ),
    getCurrentSound: safe((callback: (sound: unknown) => void) =>
      widget.getCurrentSound(callback),
    ),
    getCurrentSoundIndex: safe((callback: (index: unknown) => void) =>
      widget.getCurrentSoundIndex(callback),
    ),
  };
}

export const playerOptions = {
  color: "#d8ff00",
  hide_related: true,
  show_comments: false,
  show_user: true,
  show_reposts: false,
  show_teaser: false,
  visual: false,
} as const;

export function playerSrc(url: string, autoPlay: boolean): string {
  const params = new URLSearchParams({ url, auto_play: String(autoPlay) });
  for (const [name, value] of Object.entries(playerOptions))
    params.set(name, String(value));
  return `https://w.soundcloud.com/player/?${params.toString()}`;
}
