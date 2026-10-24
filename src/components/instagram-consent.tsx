"use client";

// Instagram's view of the shared external-media consent. The provider name is
// kept for existing callers; it manages Instagram and SoundCloud together.
import {
  MediaConsentProvider,
  useProviderConsent,
  type ConsentState,
} from "@/components/media-consent";

export type InstagramConsent = ConsentState;
export const InstagramConsentProvider = MediaConsentProvider;

export function useInstagramConsent() {
  return useProviderConsent("instagram");
}
