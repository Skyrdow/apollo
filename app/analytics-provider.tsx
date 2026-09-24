"use client";

import posthog from "posthog-js";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

type Consent = "accepted" | "rejected" | null;
type FeedbackCategory = "suggestion" | "issue";

const CONSENT_KEY = "apollo.analytics-consent";
const POSTHOG_TOKEN = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim() ?? "";
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || "https://us.i.posthog.com";
const ALLOWED_EVENTS = new Set(["$pageview", "feedback_submitted"]);
const URL_PROPERTIES = ["$current_url", "$initial_current_url", "$referrer", "$initial_referrer", "$entry_referrer"];

function readConsent(value: string | null): Consent {
  return value === "accepted" || value === "rejected" ? value : null;
}

function sanitizedUrl(value: string, includePath: boolean): string | null {
  try {
    const url = new URL(value, window.location.origin);
    return includePath ? `${url.origin}${url.pathname}` : url.origin;
  } catch {
    return null;
  }
}

export function trackFeedbackSubmitted(category: FeedbackCategory) {
  if (!POSTHOG_TOKEN || typeof window === "undefined" || localStorage.getItem(CONSENT_KEY) !== "accepted") return;
  posthog.capture("feedback_submitted", { category });
}

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [consent, setConsent] = useState<Consent>(null);
  const [ready, setReady] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    setConsent(readConsent(localStorage.getItem(CONSENT_KEY)));
    setReady(true);
    const syncConsent = (event: StorageEvent) => {
      if (event.key === CONSENT_KEY) setConsent(readConsent(event.newValue));
    };
    window.addEventListener("storage", syncConsent);
    return () => window.removeEventListener("storage", syncConsent);
  }, []);

  useEffect(() => {
    if (!ready || !POSTHOG_TOKEN) return;
    if (consent === "accepted") {
      if (!initialized.current) {
        posthog.init(POSTHOG_TOKEN, {
          api_host: POSTHOG_HOST,
          defaults: "2026-08-30",
          autocapture: false,
          rageclick: false,
          capture_pageview: false,
          capture_pageleave: false,
          capture_exceptions: false,
          capture_heatmaps: false,
          capture_performance: false,
          disable_session_recording: true,
          disable_surveys: true,
          advanced_disable_flags: true,
          person_profiles: "never",
          persistence: "localStorage",
          before_send: event => {
            if (!event || !ALLOWED_EVENTS.has(event.event)) return null;
            const properties = event.properties;
            if (!properties) return event;
            for (const key of Object.keys(properties)) {
              const normalizedKey = key.toLowerCase();
              if (normalizedKey.includes("utm") || normalizedKey === "$gclid" || normalizedKey === "$fbclid") delete properties[key];
            }
            for (const key of URL_PROPERTIES) {
              const value = properties[key];
              if (typeof value !== "string") continue;
              const sanitized = sanitizedUrl(value, key === "$current_url" || key === "$initial_current_url");
              if (sanitized) properties[key] = sanitized;
              else delete properties[key];
            }
            return event;
          },
        });
        initialized.current = true;
      } else {
        posthog.opt_in_capturing();
      }
    } else if (consent === "rejected" && initialized.current) {
      posthog.opt_out_capturing();
    }
  }, [consent, ready]);

  useEffect(() => {
    if (!ready || consent !== "accepted" || !POSTHOG_TOKEN || !pathname) return;
    const currentUrl = `${window.location.origin}${pathname}`;
    posthog.capture("$pageview", { path: pathname, "$current_url": currentUrl });
  }, [consent, pathname, ready]);

  function chooseConsent(choice: Exclude<Consent, null>) {
    localStorage.setItem(CONSENT_KEY, choice);
    setConsent(choice);
    setPreferencesOpen(false);
  }

  return <>
    {children}
    {POSTHOG_TOKEN && ready && consent !== null && !preferencesOpen && <button className="analytics-preferences-launcher" type="button" onClick={() => setPreferencesOpen(true)}>Privacidad</button>}
    {POSTHOG_TOKEN && ready && (consent === null || preferencesOpen) && <section className="analytics-consent-card" aria-label="Preferencias de analítica">
      <div className="eyebrow">ANALÍTICA OPCIONAL</div>
      <p>PostHog ayuda a entender el uso del sitio. No enviamos el contenido de las pruebas ni el texto de los comentarios; sí registra rutas sin parámetros y eventos de uso, además de datos técnicos anónimos.</p>
      <div className="analytics-consent-actions">
        {consent !== null && <button className="btn ghost" type="button" onClick={() => setPreferencesOpen(false)}>Cancelar</button>}
        <button className="btn ghost" type="button" onClick={() => chooseConsent("rejected")}>Rechazar</button>
        <button className="btn primary" type="button" onClick={() => chooseConsent("accepted")}>Aceptar analítica</button>
      </div>
    </section>}
  </>;
}
