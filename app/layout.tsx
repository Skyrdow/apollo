import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Apollo — Pruebas listas para imprimir", description: "Crea pruebas, genera versiones y comparte bancos de preguntas." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="es"><body>{children}</body></html>; }
