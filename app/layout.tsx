import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import { AnalyticsProvider } from "./analytics-provider";
import { FeedbackWidget } from "./feedback-widget";

export const metadata: Metadata = { title: "Apollo — Pruebas listas para imprimir", description: "Crea pruebas, genera versiones y comparte bancos de preguntas." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body><AnalyticsProvider>{children}<FeedbackWidget /></AnalyticsProvider></body></html>;
}
