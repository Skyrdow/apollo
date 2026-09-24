"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { trackFeedbackSubmitted } from "./analytics-provider";

type FeedbackCategory = "suggestion" | "issue";

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("suggestion");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  function openForm() {
    setError("");
    setSubmitted(false);
    setOpen(true);
  }

  async function submitFeedback(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedMessage = message.trim();
    const messageLength = Array.from(normalizedMessage).length;
    if (messageLength < 10 || messageLength > 2_000) {
      setError("Escribe entre 10 y 2.000 caracteres.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message: normalizedMessage }),
        cache: "no-store",
      });
      const result = await response.json().catch(() => null) as { error?: unknown } | null;
      if (!response.ok) {
        setError(typeof result?.error === "string" ? result.error : "No se pudo enviar el comentario. Inténtalo más tarde.");
        return;
      }
      trackFeedbackSubmitted(category);
      setMessage("");
      setSubmitted(true);
    } catch {
      setError("No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className="feedback-launcher" type="button" onClick={openForm}>¿Qué mejorarías?</button>
    <dialog className="feedback-dialog" ref={dialogRef} aria-labelledby="feedback-title" onClose={() => setOpen(false)}>
      <button className="feedback-close" type="button" aria-label="Cerrar comentarios" onClick={() => setOpen(false)} disabled={busy}>×</button>
      {submitted ? <div className="feedback-success" role="status">
        <div className="feedback-success-mark" aria-hidden="true">✓</div>
        <h2 id="feedback-title">Gracias por contarnos.</h2>
        <p>Tu comentario quedó guardado y nos ayudará a mejorar Apollo.</p>
        <button className="btn primary full" type="button" onClick={() => setOpen(false)}>Listo</button>
      </div> : <>
        <div className="eyebrow">AYÚDANOS A MEJORAR</div>
        <h2 id="feedback-title">¿Qué te gustaría contarnos?</h2>
        <p className="feedback-intro">Comparte una idea o cuéntanos si algo no funcionó.</p>
        <form className="feedback-form" onSubmit={submitFeedback}>
          <fieldset disabled={busy}>
            <legend>Tipo de comentario</legend>
            <label><input type="radio" name="feedback-category" value="suggestion" checked={category === "suggestion"} onChange={() => setCategory("suggestion")} /> Sugerencia</label>
            <label><input type="radio" name="feedback-category" value="issue" checked={category === "issue"} onChange={() => setCategory("issue")} /> Problema</label>
          </fieldset>
          <label className="feedback-message-label" htmlFor="feedback-message">Tu comentario</label>
          <textarea id="feedback-message" required minLength={10} maxLength={2_000} rows={6} value={message} onChange={event => setMessage(event.target.value)} placeholder="Describe la idea o el problema…" disabled={busy} />
          <div className="feedback-guidance">No incluyas datos personales, información de estudiantes ni respuestas de pruebas.</div>
          {error && <p className="feedback-error" role="alert">{error}</p>}
          <div className="feedback-form-actions">
            <span>{Array.from(message).length}/2.000</span>
            <button className="btn primary" type="submit" disabled={busy}>{busy ? "Enviando…" : "Enviar comentario"}</button>
          </div>
        </form>
      </>}
    </dialog>
  </>;
}
