"use client";

import { isRecord } from "@/lib/type-guards";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import { supabase } from "@/lib/supabase";

type QuestionKind = "choice" | "multiple" | "truefalse" | "written" | "fill" | "matching";
type Question = { id: string; kind: QuestionKind; text: string; options: string[]; answer: number; answers?: number[]; expected?: string; pairs?: { left: string; right: string }[]; points: number; responseLines?: number };
type Section = { id: string; title: string; instructions: string; pick: number; questions: Question[] };
type HeaderField = { id: string; label: string; enabled: boolean; wide: boolean };
type ExamHeader = { school: string; title: string; subtitle: string; logo: string; fields: HeaderField[] };
type Exam = { title: string; subject: string; grade: string; teacher: string; duration: string; variants: number; header: ExamHeader; sections: Section[] };
type PdfStyle = "compact" | "balanced" | "spacious";
type PlannedQuestion = { question: Question; optionOrder: number[]; matchOrder: number[] };
type FormPlan = { sections: { title: string; instructions: string; questions: PlannedQuestion[] }[]; points: number };
type Generation = { signature: string; forms: FormPlan[] };
type User = { id: string; email: string; user_metadata?: { full_name?: string } };
type SavedDocument = { id: string; title: string; updated_at: string; data: Exam };
type SavedBank = { id: string; title: string; created_at: string };
const fresh = (): Exam => ({
  title: "Nueva prueba",
  subject: "",
  grade: "",
  teacher: "",
  duration: "60 minutos",
  variants: 1,
  header: {
    school: "",
    title: "",
    subtitle: "",
    logo: "",
    fields: [
      { id: uid(), label: "Nombre y apellido", enabled: true, wide: true },
      { id: uid(), label: "RUT / identificador", enabled: true, wide: false },
      { id: uid(), label: "Curso", enabled: true, wide: false },
      { id: uid(), label: "Fecha", enabled: true, wide: false },
      { id: uid(), label: "Puntaje", enabled: true, wide: false },
      { id: uid(), label: "Nota", enabled: true, wide: false },
      { id: uid(), label: "Firma", enabled: true, wide: true },
    ],
  },
  sections: [{ id: uid(), title: "Sección 1", instructions: "", pick: 0, questions: [] }],
});
const uid = () => crypto.randomUUID();
const questionTypes: { kind: QuestionKind; label: string; group: string; description: string }[] = [
  { kind: "choice", label: "Selección única", group: "Selección", description: "Una alternativa correcta" },
  { kind: "multiple", label: "Selección múltiple", group: "Selección", description: "Varias alternativas correctas" },
  { kind: "truefalse", label: "Verdadero o falso", group: "Selección", description: "Dos opciones" },
  { kind: "written", label: "Respuesta abierta", group: "Respuesta", description: "Líneas para desarrollar" },
  { kind: "fill", label: "Completar", group: "Respuesta", description: "Espacios con pauta esperada" },
  { kind: "matching", label: "Términos pareados", group: "Relación", description: "Relaciona conceptos y definiciones" },
];
const questionGroups = ["Selección", "Respuesta", "Relación"] as const;
function mix<T>(items: T[]) { const out = [...items]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; }


const questionKinds = new Set<QuestionKind>(["choice", "multiple", "truefalse", "written", "fill", "matching"]);
function isQuestionKind(value: unknown): value is QuestionKind {
  return typeof value === "string" && questionKinds.has(value as QuestionKind);
}
function parseQuestions(value: unknown): Question[] | null {
  if (!Array.isArray(value) || value.length > 500) return null;
  const questions: Question[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    const kind = candidate.kind;
    const text = candidate.text;
    const points = candidate.points;
    const options = candidate.options;
    if (!isQuestionKind(kind) || typeof text !== "string" || text.length > 20_000 ||
        typeof points !== "number" || !Number.isFinite(points) || points < 0 ||
        !Array.isArray(options) || options.length > 100 ||
        !options.every((option): option is string => typeof option === "string" && option.length <= 10_000)) return null;
    if ((kind === "choice" || kind === "multiple" || kind === "truefalse") &&
        (options.length < 2 || kind === "truefalse" && options.length !== 2)) return null;
    let answer = 0;
    if (kind === "choice" || kind === "truefalse") {
      const candidateAnswer = candidate.answer;
      if (typeof candidateAnswer !== "number" || !Number.isInteger(candidateAnswer) ||
          candidateAnswer < 0 || candidateAnswer >= options.length) return null;
      answer = candidateAnswer;
    }
    let answers: number[] = [];
    if (kind === "multiple") {
      const candidateAnswers = candidate.answers;
      if (!Array.isArray(candidateAnswers) || !candidateAnswers.length ||
          !candidateAnswers.every((index): index is number => typeof index === "number" &&
            Number.isInteger(index) && index >= 0 && index < options.length)) return null;
      answers = [...candidateAnswers];
    }
    let pairs: { left: string; right: string }[] = [];
    if (kind === "matching") {
      const candidatePairs = candidate.pairs;
      if (!Array.isArray(candidatePairs) || !candidatePairs.length || candidatePairs.length > 100) return null;
      for (const pair of candidatePairs) {
        if (!isRecord(pair) || typeof pair.left !== "string" || pair.left.length > 10_000 ||
            typeof pair.right !== "string" || pair.right.length > 10_000) return null;
        pairs.push({ left: pair.left, right: pair.right });
      }
    }
    const expected = candidate.expected;
    if (expected !== undefined && typeof expected !== "string") return null;
    const rawResponseLines = candidate.responseLines;
    if (kind === "written" && rawResponseLines !== undefined &&
        (typeof rawResponseLines !== "number" || !Number.isInteger(rawResponseLines) ||
          rawResponseLines < 1 || rawResponseLines > 12)) return null;
    questions.push({
      id: uid(),
      kind,
      text,
      options: [...options],
      answer,
      answers,
      expected: typeof expected === "string" ? expected : "",
      pairs,
      points,
      responseLines: kind === "written" && typeof rawResponseLines === "number" ? rawResponseLines : kind === "written" ? 3 : undefined,
    });
  }
  return questions;
}
function parseExam(value: unknown): Exam | null {
  if (!isRecord(value) || typeof value.title !== "string" || typeof value.subject !== "string" ||
      typeof value.grade !== "string" || typeof value.teacher !== "string" || typeof value.duration !== "string" ||
      !Number.isInteger(value.variants) || typeof value.variants !== "number" || value.variants < 1 || value.variants > 10 ||
      !isRecord(value.header) || !Array.isArray(value.header.fields) || value.header.fields.length > 50 ||
      typeof value.header.school !== "string" || typeof value.header.title !== "string" ||
      typeof value.header.subtitle !== "string" || typeof value.header.logo !== "string" ||
      !Array.isArray(value.sections) || value.sections.length > 200) return null;
  const fields: HeaderField[] = [];
  for (const item of value.header.fields) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.label !== "string" ||
        typeof item.enabled !== "boolean" || typeof item.wide !== "boolean") return null;
    fields.push({ id: item.id, label: item.label, enabled: item.enabled, wide: item.wide });
  }
  const sections: Section[] = [];
  for (const item of value.sections) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.title !== "string" ||
        typeof item.instructions !== "string" || typeof item.pick !== "number" ||
        !Number.isFinite(item.pick) || item.pick < 0) return null;
    const questions = parseQuestions(item.questions);
    if (!questions) return null;
    sections.push({ id: item.id, title: item.title, instructions: item.instructions, pick: Math.min(item.pick, questions.length), questions });
  }
  return {
    title: value.title,
    subject: value.subject,
    grade: value.grade,
    teacher: value.teacher,
    duration: value.duration,
    variants: value.variants,
    header: {
      school: value.header.school,
      title: value.header.title,
      subtitle: value.header.subtitle,
      logo: value.header.logo,
      fields,
    },
    sections,
  };
}
function parseHistory(value: unknown): SavedDocument[] | null {
  if (!Array.isArray(value)) return null;
  const documents: SavedDocument[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.title !== "string" ||
        typeof item.updated_at !== "string") return null;
    const data = parseExam(item.data);
    if (!data) return null;
    documents.push({ id: item.id, title: item.title, updated_at: item.updated_at, data });
  }
  return documents;
}
function parseBanks(value: unknown): SavedBank[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const banks: SavedBank[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.title !== "string" ||
        typeof item.created_at !== "string" || !Number.isFinite(Date.parse(item.created_at))) return null;
    banks.push({ id: item.id, title: item.title, created_at: item.created_at });
  }
  return banks;
}
const bankIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function parseBankId(value: string): string | null {
  const input = value.trim();
  if (!input) return null;
  try {
    const id = new URL(input, window.location.origin).searchParams.get("banco") ?? input;
    return bankIdPattern.test(id) ? id : null;
  } catch {
    return bankIdPattern.test(input) ? input : null;
  }
}
async function getSharedBank(id: string): Promise<{ title: string; questions: Question[] }> {
  const response = await fetch(`/api/banks/${encodeURIComponent(id)}`);
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(result) && typeof result.error === "string" ? result.error : "El enlace no está disponible.";
    throw new Error(message);
  }
  if (!isRecord(result)) throw new Error("La respuesta del banco no tiene un formato válido.");
  const questions = parseQuestions(result.questions);
  if (!questions?.length) throw new Error("El banco no contiene preguntas válidas.");
  const title = typeof result.title === "string" && result.title.trim() ? result.title : "Preguntas importadas";
  return { title, questions };
}

export default function Home() {
  const [exam, setExam] = useState<Exam>(fresh);
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState("editor");
  const [active, setActive] = useState(0);
  const [modal, setModal] = useState<"auth" | "variants" | "share" | "export" | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [authBusy, setAuthBusy] = useState(false);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState("");
  const [history, setHistory] = useState<SavedDocument[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [banks, setBanks] = useState<SavedBank[]>([]);
  const [banksLoading, setBanksLoading] = useState(false);
  const [banksError, setBanksError] = useState("");
  const [bankLink, setBankLink] = useState("");
  const [docId, setDocId] = useState<string | undefined>();
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(""); const [shareUrl, setShareUrl] = useState("");
  const [lastSaved, setLastSaved] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [pdfStyle, setPdfStyle] = useState<PdfStyle>("compact");
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState("");
  const [questionPickerOpen, setQuestionPickerOpen] = useState(false);
  const [minimapVisible, setMinimapVisible] = useState(true);
  const total = useMemo(() => exam.sections.reduce((sum, section) => sum + Math.max(0, Math.min(Number(section.pick) || 0, section.questions.length)), 0), [exam.sections]);
  const questions = exam.sections.flatMap(s => s.questions);
  useEffect(() => () => { if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl); }, [pdfPreviewUrl]);
  useEffect(() => { if (modal !== "export") setPdfPreviewUrl(""); }, [modal]);
  useEffect(() => {
    if (!modal) {
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
      previousFocusRef.current = null;
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])',
    )).filter(element => element.getClientRects().length > 0);
    (focusable()[0] || dialog).focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModal(null);
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [modal]);

  const token = useCallback(async () => (await supabase().auth.getSession()).data.session?.access_token ?? "", []);
  const loadHistory = useCallback(async () => {
    if (!user) return;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await fetch("/api/documents", { headers: { Authorization: `Bearer ${await token()}` } });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = isRecord(result) && typeof result.error === "string" ? result.error : "No se pudo cargar tu historial.";
        throw new Error(message);
      }
      const documents = isRecord(result) ? parseHistory(result.documents) : null;
      if (!documents) throw new Error("El historial contiene datos con formato no válido.");
      setHistory(documents);
    } catch {
      setHistoryError("No se pudo cargar el historial. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setHistoryLoading(false);
    }
  }, [user, token]);
  const loadBanks = useCallback(async () => {
    if (!user) { setBanks([]); setBanksError(""); return; }
    setBanksLoading(true);
    setBanksError("");
    try {
      const response = await fetch("/api/banks", { headers: { Authorization: `Bearer ${await token()}` } });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error("No se pudieron cargar tus bancos.");
      const savedBanks = isRecord(result) ? parseBanks(result.banks) : null;
      if (!savedBanks) throw new Error("La lista de bancos tiene un formato no válido.");
      setBanks(savedBanks);
    } catch {
      setBanksError("No se pudieron cargar tus bancos. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setBanksLoading(false);
    }
  }, [user, token]);
  useEffect(() => { const client = supabase(); client.auth.getUser().then(({ data }) => setUser(data.user as User | null)); const { data: listener } = client.auth.onAuthStateChange((_event, session) => setUser(session?.user as User | null)); return () => listener.subscription.unsubscribe(); }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { if (tab === "bank") void loadBanks(); }, [tab, loadBanks]);
  useEffect(() => {
    const bankId = new URLSearchParams(location.search).get("banco");
    if (!bankId) return;
    let cancelled = false;
    async function importSharedBank(id: string) {
      setNotice("Cargando banco compartido…");
      try {
        const bank = await getSharedBank(id);
        if (cancelled) return;
        const targetSectionId = exam.sections[active]?.id;
        if (!targetSectionId) throw new Error("Selecciona una sección para importar.");
        addBankQuestions(bank.title, bank.questions, targetSectionId);
        window.history.replaceState(null, "", "/");
      } catch (error) {
        if (!cancelled) setNotice(`No se pudo importar el banco compartido: ${error instanceof Error ? error.message : "enlace no disponible."}`);
      }
    }
    void importSharedBank(bankId);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);
  function markDirty() { setIsDirty(true); setLastSaved(""); }
  function confirmDiscard(action: () => void) {
    if (isDirty && !window.confirm("Hay cambios sin guardar. ¿Quieres descartarlos?")) {
      setNotice("Se conservaron los cambios sin guardar.");
      return;
    }
    action();
  }
  function updateExam(patch: Partial<Exam>) { markDirty(); setExam(current => ({ ...current, ...patch })); }
  function updateHeader(patch: Partial<ExamHeader>) { markDirty(); setExam(current => ({ ...current, header: { ...current.header, ...patch } })); }
  function updateHeaderField(id: string, patch: Partial<HeaderField>) { updateHeader({ fields: exam.header.fields.map(field => field.id === id ? { ...field, ...patch } : field) }); }
  async function uploadLogo(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setNotice("Selecciona un archivo de imagen.");
    if (file.size > 5_000_000) return setNotice("El logo debe pesar menos de 5 MB.");
    try {
      const image = new Image(); image.src = URL.createObjectURL(file); await image.decode();
      const scale = Math.min(1, 600 / image.width, 240 / image.height); const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
      canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(image.src); updateHeader({ logo: canvas.toDataURL("image/jpeg", 0.82) });
    } catch { setNotice("No se pudo cargar el logo. Prueba con PNG o JPEG."); }
  }
  function updateSection(index: number, patch: Partial<Section>) {
    markDirty();
    setExam(current => ({ ...current, sections: current.sections.map((section, i) => i === index ? { ...section, ...patch } : section) }));
  }
  function updateQuestion(si: number, qi: number, patch: Partial<Question>) {
    markDirty();
    setExam(current => ({ ...current, sections: current.sections.map((section, i) => i !== si ? section : { ...section, questions: section.questions.map((q, j) => j === qi ? { ...q, ...patch } : q) }) }));
  }
  function addQuestion(si: number, kind: QuestionKind = "choice") {
    const options = ["choice", "multiple"].includes(kind) ? ["Alternativa A", "Alternativa B", "Alternativa C", "Alternativa D"] : kind === "truefalse" ? ["Verdadero", "Falso"] : [];
    const q: Question = { id: uid(), kind, text: "Escribe tu pregunta aquí…", options, answer: 0, answers: kind === "multiple" ? [0] : [], expected: "", pairs: kind === "matching" ? [{ left: "Concepto A", right: "Definición A" }, { left: "Concepto B", right: "Definición B" }] : [], points: 1, responseLines: 3 };
    updateSection(si, { questions: [...exam.sections[si].questions, q], pick: exam.sections[si].pick + 1 });
  }
  function addSection() {
    markDirty();
    const section = { id: uid(), title: `Sección ${exam.sections.length + 1}`, instructions: "Lee cada pregunta con atención.", pick: 0, questions: [] as Question[] };
    setExam(current => ({ ...current, sections: [...current.sections, section] }));
    setActive(exam.sections.length);
  }
  function changeQuestionKind(si: number, qi: number, kind: QuestionKind) {
    const options = ["choice", "multiple"].includes(kind) ? ["Alternativa A", "Alternativa B", "Alternativa C", "Alternativa D"] : kind === "truefalse" ? ["Verdadero", "Falso"] : [];
    updateQuestion(si, qi, { kind, options, answer: 0, answers: kind === "multiple" ? [0] : [], expected: "", pairs: kind === "matching" ? [{ left: "Concepto A", right: "Definición A" }, { left: "Concepto B", right: "Definición B" }] : [], responseLines: 3 });
  }
  function deleteSection(index: number) {
    markDirty();
    setExam(current => ({ ...current, sections: current.sections.filter((_, i) => i !== index) }));
    setActive(Math.max(0, index - 1));
  }
  function startNewExam() {
    confirmDiscard(() => {
      setExam(fresh());
      setDocId(undefined);
      setIsDirty(false);
      setLastSaved("");
      setGeneration(null);
      setActive(0);
      setQuestionPickerOpen(false);
      setTab("editor");
      setNotice("");
    });
  }

  async function authSubmit(event: React.FormEvent) { event.preventDefault(); setAuthBusy(true); setNotice(""); try { const client = supabase(); const result = authMode === "register" ? await client.auth.signUp({ email, password, options: { data: { full_name: name } } }) : await client.auth.signInWithPassword({ email, password }); if (result.error) { setNotice(result.error.message); return; } if (authMode === "register" && !result.data.session) { setNotice("Revisa tu correo para confirmar la cuenta y luego inicia sesión."); return; } setUser(result.data.user as User | null); setModal(null); setPassword(""); } catch { setNotice("No se pudo conectar con Supabase. Revisa la configuración del proyecto."); } finally { setAuthBusy(false); } }
  async function save() {
    if (!user) { setModal("auth"); return; }
    setBusy("save");
    setNotice("");
    try {
      const response = await fetch("/api/documents", { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: docId, title: exam.title, data: exam }) });
      const result: unknown = await response.json().catch(() => null);
      const id = isRecord(result) ? result.id : undefined;
      if (!response.ok || typeof id !== "string") throw new Error("No se pudo guardar la prueba.");
      setDocId(id);
      setIsDirty(false);
      setLastSaved("Guardado");
      setNotice("Prueba guardada en tu historial.");
      await loadHistory();
    } catch {
      setNotice("No se pudo guardar la prueba. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy("");
    }
  }
  async function shareBank() {
    if (!user) { setModal("auth"); return; }
    if (!questions.length) { setNotice("Agrega al menos una pregunta antes de compartir el banco."); return; }
    setBusy("share");
    setNotice("");
    try {
      const response = await fetch("/api/banks", { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ title: exam.title, questions }) });
      const result: unknown = await response.json().catch(() => null);
      const id = isRecord(result) ? result.id : undefined;
      if (!response.ok || typeof id !== "string") throw new Error("No se pudo crear el banco.");
      setShareUrl(`${location.origin}/?banco=${id}`);
      setModal("share");
      void loadBanks();
    } catch {
      setNotice("No se pudo compartir el banco. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy("");
    }
  }
  function addBankQuestions(title: string, imported: Question[], targetSectionId: string) {
    const targetIndex = exam.sections.findIndex(section => section.id === targetSectionId);
    const targetSection = exam.sections[targetIndex];
    const fallbackSection: Section = { id: uid(), title, instructions: "Banco importado", pick: imported.length, questions: imported };
    markDirty();
    setExam(current => {
      const index = current.sections.findIndex(section => section.id === targetSectionId);
      if (index < 0) return { ...current, sections: [...current.sections, fallbackSection] };
      const section = current.sections[index];
      const questions = [...section.questions, ...imported];
      return {
        ...current,
        sections: current.sections.map((item, itemIndex) => itemIndex !== index ? item : {
          ...section,
          title: !section.questions.length && /^Sección \d+$/i.test(section.title.trim()) ? title : section.title,
          questions,
          pick: Math.min(section.pick + imported.length, questions.length),
        }),
      };
    });
    setActive(targetIndex >= 0 ? targetIndex : exam.sections.length);
    setGeneration(null);
    setTab("editor");
    const destination = targetSection && !targetSection.questions.length && /^Sección \d+$/i.test(targetSection.title.trim())
      ? title
      : targetSection?.title || "la nueva sección";
    const countMessage = imported.length === 1 ? "Se añadió 1 pregunta" : `Se añadieron ${imported.length} preguntas`;
    setNotice(`${countMessage} de «${title}» a «${destination}».`);
  }
  async function importBankById(id: string) {
    if (busy) return;
    const targetSectionId = exam.sections[active]?.id;
    if (!targetSectionId) { setNotice("Selecciona una sección antes de añadir preguntas."); return; }
    setBusy("bank");
    setNotice("");
    try {
      const bank = await getSharedBank(id);
      addBankQuestions(bank.title, bank.questions, targetSectionId);
      setBankLink("");
    } catch (error) {
      setNotice(`No se pudo importar el banco: ${error instanceof Error ? error.message : "enlace no disponible."}`);
    } finally {
      setBusy("");
    }
  }
  async function submitBankLink(event: React.FormEvent) {
    event.preventDefault();
    const id = parseBankId(bankLink);
    if (!id) { setNotice("Pega un enlace compartido válido o el identificador del banco."); return; }
    await importBankById(id);
  }
  function planForms(): FormPlan[] {
    return Array.from({ length: Math.max(1, Math.min(10, Number(exam.variants) || 1)) }, (_, form) => {
      const sections = exam.sections.map(section => ({ title: section.title, instructions: section.instructions, questions: mix(section.questions).slice(0, Math.max(0, Math.min(section.pick, section.questions.length))).map(question => {
        const rotate = (indices: number[]) => { const shuffled = mix(indices); const offset = shuffled.length ? form % shuffled.length : 0; return [...shuffled.slice(offset), ...shuffled.slice(0, offset)]; };
        return { question, optionOrder: rotate(question.options.map((_, i) => i)), matchOrder: mix((question.pairs || []).map((_, i) => i)) };
      }) }));
      return { sections, points: sections.reduce((sum, section) => sum + section.questions.reduce((n, item) => n + (Number(item.question.points) || 0), 0), 0) };
    });
  }
  function exportForms(forms: FormPlan[], answerKey = false, styleName: PdfStyle = pdfStyle): Blob {
    const pdf = new jsPDF({ unit: "mm", format: "letter" });
    const style = {
      compact: { margin: 13, top: 12, bottomInset: 14, scale: 0.88, leading: 0.4, paragraphGap: 0.5, questionGap: 1, fieldRow: 6, fieldFont: 7, titleFont: 12 },
      balanced: { margin: 18, top: 16, bottomInset: 19, scale: 1, leading: 0.48, paragraphGap: 1.2, questionGap: 2, fieldRow: 7.5, fieldFont: 8, titleFont: 14 },
      spacious: { margin: 23, top: 21, bottomInset: 25, scale: 1.08, leading: 0.56, paragraphGap: 2, questionGap: 3, fieldRow: 9.5, fieldFont: 8.5, titleFont: 16 },
    }[styleName];
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const left = style.margin;
    const width = pageWidth - style.margin * 2;
    const top = style.top;
    const bottom = pageHeight - style.bottomInset;
    const footerY = pageHeight - 8;
    for (let form = 0; form < forms.length; form++) {
      if (form) pdf.addPage();
      let y = top;
      const newContentPage = () => { pdf.addPage(); y = top; };
      const ensureSpace = (height: number) => { if (y + height > bottom && y > top) newContentPage(); };
      const write = (text: string, size = 10, bold = false) => {
        const actualSize = size * style.scale;
        pdf.setFont("helvetica", bold ? "bold" : "normal");
        pdf.setFontSize(actualSize);
        const lines = pdf.splitTextToSize(text, width) as string[];
        const lineHeight = Math.max(3.2, actualSize * style.leading);
        for (let start = 0; start < lines.length;) {
          if (y + lineHeight > bottom && y > top) newContentPage();
          const count = Math.max(1, Math.floor((bottom - y) / lineHeight));
          pdf.text(lines.slice(start, start + count), left, y);
          y += Math.min(count, lines.length - start) * lineHeight;
          start += count;
          if (start < lines.length) newContentPage();
        }
        y += style.paragraphGap;
      };
      if (answerKey) {
        write(`${exam.title} · Pauta de respuestas`, 16, true);
        write(`Forma ${String.fromCharCode(65 + form)} · ${exam.subject} · ${exam.grade}`, 9);
        y += style.questionGap;
      } else {
        const headingX = left + (exam.header.logo ? 19 : 0);
        const headingWidth = width - (headingX - left);
        const headingLines = [
          { text: exam.header.school, size: 8, bold: true },
          { text: exam.header.title || exam.title || "Prueba", size: style.titleFont, bold: true },
          { text: exam.header.subtitle, size: 7.5, bold: false },
        ].filter(item => item.text);
        const logoHeight = styleName === "spacious" ? 17 : styleName === "balanced" ? 14 : 11;
        if (exam.header.logo) {
          try { pdf.addImage(exam.header.logo, "JPEG", left, y - 1, 16, logoHeight); }
          catch { /* Ignore invalid image data in an imported document. */ }
        }
        for (const line of headingLines) {
          const actualSize = line.size * style.scale;
          const lineHeight = Math.max(3.2, actualSize * style.leading);
          pdf.setFont("helvetica", line.bold ? "bold" : "normal");
          pdf.setFontSize(actualSize);
          const lines = pdf.splitTextToSize(line.text, headingWidth) as string[];
          ensureSpace(lines.length * lineHeight);
          pdf.text(lines, headingX, y);
          y += lines.length * lineHeight + style.paragraphGap;
        }
        if (exam.header.logo) y = Math.max(y, top + logoHeight);
        y += style.paragraphGap;
        write(`${exam.subject}  ·  ${exam.grade}  ·  ${exam.duration}${exam.teacher ? `  ·  ${exam.teacher}` : ""}`, 8.5);
        const fields = exam.header.fields.filter(field => field.enabled);
        let fieldIndex = 0;
        while (fieldIndex < fields.length) {
          ensureSpace(style.fieldRow);
          const field = fields[fieldIndex];
          const next = fields[fieldIndex + 1];
          const pair = !field.wide && next && !next.wide;
          const items = pair
            ? [{ field, x: left, w: width / 2 - 3 }, { field: next!, x: left + width / 2 + 3, w: width / 2 - 3 }]
            : [{ field, x: left, w: width }];
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(style.fieldFont);
          pdf.setTextColor(95);
          pdf.setDrawColor(175);
          for (const item of items) {
            const label = `${item.field.label}:`;
            const labelWidth = pdf.getTextWidth(label);
            pdf.text(label, item.x, y);
            pdf.line(item.x + labelWidth + 2, y + 0.8, item.x + item.w, y + 0.8);
          }
          fieldIndex += pair ? 2 : 1;
          y += style.fieldRow;
        }
        ensureSpace(5);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8 * style.scale);
        pdf.setTextColor(0);
        pdf.text(`Forma ${String.fromCharCode(65 + form)}     Total: ${forms[form].points} puntos`, left, y);
        y += 5 + style.questionGap;
      }
      let number = 0;
      for (const section of forms[form].sections) {
        if (!answerKey) {
          write(section.title, 13, true);
          if (section.instructions) write(section.instructions, 9);
        }
        for (const item of section.questions) {
          const q = item.question;
          number++;
          if (answerKey) {
            let key = "Respuesta abierta";
            if (q.kind === "fill") key = q.expected || "(sin pauta escrita)";
            if (q.kind === "multiple") key = (q.answers?.length ? q.answers : [q.answer]).map(index => String.fromCharCode(65 + item.optionOrder.indexOf(index))).join(", ");
            if (q.kind === "choice" || q.kind === "truefalse") key = String.fromCharCode(65 + item.optionOrder.indexOf(q.answer));
            if (q.kind === "matching") key = (q.pairs || []).map((pair, i) => `${i + 1}–${String.fromCharCode(65 + item.matchOrder.indexOf(i))}`).join(" · ");
            write(`${number}. ${key}`, 10);
          } else {
            write(`${number}. ${q.text}${q.kind === "multiple" ? " (Marca todas las alternativas correctas; puede haber más de una.)" : ""} (${q.points} pto${q.points === 1 ? "" : "s"})`, 10, true);
            if (q.kind === "written") {
              y += style.questionGap;
              pdf.setDrawColor(190);
              const responseLine = styleName === "spacious" ? 9 : styleName === "balanced" ? 7 : 5.5;
              for (let line = 0; line < Math.max(1, Math.min(12, q.responseLines ?? 3)); line++) {
                ensureSpace(responseLine);
                pdf.line(left, y, left + width, y);
                y += responseLine;
              }
            } else if (q.kind === "fill") {
              ensureSpace(style.fieldRow + 2);
              y += 2;
              pdf.setDrawColor(190);
              pdf.line(left, y, left + width, y);
              y += style.fieldRow;
            } else if (q.kind === "matching") {
              const pairs = q.pairs || [];
              write("Relaciona cada elemento de la columna A con la alternativa correcta de la columna B.", 8);
              pairs.forEach((pair, i) => write(`${i + 1}. ${pair.left}   ______`, 9));
              item.matchOrder.forEach((index, i) => write(`${String.fromCharCode(65 + i)}) ${pairs[index]?.right || ""}`, 9));
            } else {
              item.optionOrder.forEach((index, i) => write(`${String.fromCharCode(65 + i)})  ${q.options[index] || ""}`, 9));
            }
          }
          y += style.questionGap;
        }
      }
      pdf.setPage(pdf.getNumberOfPages());
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7 * style.scale);
      pdf.setTextColor(90);
      pdf.text(`${answerKey ? "PAUTA" : "APOLLO"}  •  Forma ${String.fromCharCode(65 + form)}`, left, footerY);
    }
    return pdf.output("blob");
  }
  function downloadPdf(blob: Blob, answerKey = false) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(exam.title || "prueba").toLowerCase().replace(/[^a-z0-9]+/g, "-")}${answerKey ? "-pauta" : ""}.pdf`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function printPdf() {
    if (!questions.length || total === 0) {
      setNotice("Agrega y selecciona al menos una pregunta antes de exportar.");
      return;
    }
    setBusy("pdf");
    try {
      const forms = planForms();
      const blob = exportForms(forms, false, pdfStyle);
      setGeneration({ signature: JSON.stringify(exam), forms });
      setPdfPreviewUrl(URL.createObjectURL(blob));
      setModal("export");
      setNotice("");
    } catch {
      setNotice("No se pudo generar la vista previa del PDF. Intenta otra vez.");
    } finally {
      setBusy("");
    }
  }
  async function changePdfStyle(style: PdfStyle) {
    if (!generation) return;
    setBusy("preview");
    try {
      const blob = await exportForms(generation.forms, false, style);
      setPdfStyle(style);
      setPdfPreviewUrl(URL.createObjectURL(blob));
    } catch {
      setNotice("No se pudo actualizar la vista previa del PDF.");
    } finally {
      setBusy("");
    }
  }
  async function printAnswerKey() {
    if (!generation || generation.signature !== JSON.stringify(exam)) return setNotice("Exporta primero las formas actuales para que la pauta coincida con su orden aleatorio.");
    setBusy("key");
    try {
      downloadPdf(await exportForms(generation.forms, true, pdfStyle), true);
      setNotice("Pauta descargada para las formas de esta exportación.");
    } catch {
      setNotice("No se pudo generar la pauta.");
    } finally {
      setBusy("");
    }
  }
  function downloadPreview() {
    if (!pdfPreviewUrl) return;
    const link = document.createElement("a");
    link.href = pdfPreviewUrl;
    link.download = `${(exam.title || "prueba").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
    link.click();
  }

  function restore(item: SavedDocument) {
    confirmDiscard(() => {
      setExam(item.data);
      setDocId(item.id);
      setIsDirty(false);
      setLastSaved("Guardado");
      setGeneration(null);
      setTab("editor");
      setActive(0);
      setNotice(`«${item.title}» listo para editar.`);
    });
  }
  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data: unknown = JSON.parse(await file.text());
      const questions = parseQuestions(data);
      if (!questions) {
        setNotice("El JSON debe ser un arreglo de hasta 500 preguntas con tipos y respuestas válidos.");
        return;
      }
      confirmDiscard(() => {
        setExam(current => ({ ...current, sections: [{ id: uid(), title: "Preguntas importadas", instructions: "", pick: questions.length, questions }] }));
        setDocId(undefined);
        setIsDirty(true);
        setLastSaved("");
        setGeneration(null);
        setActive(0);
        setNotice("Preguntas importadas desde JSON.");
      });
    } catch {
      setNotice("El archivo debe contener un arreglo de preguntas JSON válido.");
    } finally {
      event.target.value = "";
    }
  }
  function exportQuestions() {
    const questions = exam.sections.flatMap(section => section.questions);
    const blob = new Blob([JSON.stringify(questions, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(exam.title || "prueba").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-preguntas.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return <main className="shell">
    <aside className="rail"><div className="brand-mark">A<span>.</span></div><button className={tab === "editor" ? "rail-btn active" : "rail-btn"} title="Editor" aria-label="Editor" onClick={() => setTab("editor")}>✎</button><button className={tab === "header" ? "rail-btn active" : "rail-btn"} title="Encabezado de la prueba" aria-label="Encabezado de la prueba" onClick={() => setTab("header")}>▧</button><button className={tab === "history" ? "rail-btn active" : "rail-btn"} title="Mis pruebas" aria-label="Mis pruebas" onClick={() => setTab("history")}>▤</button><button className={tab === "bank" ? "rail-btn active" : "rail-btn"} title="Banco de preguntas" aria-label="Banco de preguntas" onClick={() => setTab("bank")}>▦</button><div className="rail-bottom"><div className="avatar" title={user?.email}>{user?.user_metadata?.full_name?.[0] || user?.email?.[0]?.toUpperCase() || "P"}</div></div></aside>
    <section className="workspace"><header className="topbar"><div className="crumb"><span>Apollo</span><b>/</b><strong>{tab === "history" ? "Mis pruebas" : tab === "bank" ? "Banco de preguntas" : tab === "header" ? "Encabezado de la prueba" : "Editor de pruebas"}</strong></div><div className="top-actions"><span className="save-state" role="status" aria-live="polite">{isDirty ? "Cambios sin guardar" : docId ? lastSaved || "Guardado" : "Sin guardar"}</span>{!user && <button className="btn ghost" onClick={() => setModal("auth")}>Crear cuenta</button>}<><button className="btn ghost forms-button" onClick={() => setModal("variants")}>Formas: {exam.variants}</button>{tab === "editor" && <button className="btn ghost minimap-toggle" aria-pressed={minimapVisible} onClick={() => setMinimapVisible(visible => !visible)}>{minimapVisible ? "Ocultar mapa" : "Mostrar mapa"}</button>}</><button className="btn ghost" onClick={save}>{busy === "save" ? "Guardando…" : "Guardar"}</button><button className="btn primary" onClick={printPdf}>{busy === "pdf" ? "Preparando vista previa…" : <><span>↓</span> Exportar PDF</>}</button><button className="btn ghost" onClick={printAnswerKey} disabled={busy === "key" || !generation || generation.signature !== JSON.stringify(exam)} title={!generation || generation.signature !== JSON.stringify(exam) ? "Exporta las formas actuales antes de descargar la pauta" : "Descargar pauta"}>{busy === "key" ? "Generando pauta…" : "Descargar pauta"}</button></div></header>
      {notice && <div className="notice" role="status" aria-live="polite">{notice}<button aria-label="Cerrar aviso" onClick={() => setNotice("")}>×</button></div>}
      {tab === "editor" && <div className="content editor-layout"><section className="edit-column"><div className="eyebrow"><span>✦</span> CREADOR DE PRUEBAS</div><input className="exam-title" value={exam.title} onChange={e => updateExam({ title: e.target.value })} aria-label="Título de la prueba"/><div className="metadata-grid"><label>ASIGNATURA<input value={exam.subject} onChange={e => updateExam({ subject: e.target.value })}/></label><label>NIVEL / CURSO<input value={exam.grade} onChange={e => updateExam({ grade: e.target.value })}/></label><label>DOCENTE<input value={exam.teacher} placeholder="Tu nombre" onChange={e => updateExam({ teacher: e.target.value })}/></label><label>DURACIÓN<input value={exam.duration} onChange={e => updateExam({ duration: e.target.value })}/></label></div>
          <div className="section-tabs">{exam.sections.map((s, i) => <button key={s.id} className={active === i ? "section-tab selected" : "section-tab"} onClick={() => setActive(i)}>{String(i + 1).padStart(2, "0")} <span>{s.title || "Sección"}</span></button>)}<button className="add-section" onClick={addSection}>＋ Sección</button></div>
          {exam.sections[active] ? <div className="section-card" id="section-editor"><div className="section-head"><div><div className="eyebrow">SECCIÓN {String(active + 1).padStart(2, "0")}</div><input className="section-title" aria-label="Título de la sección" value={exam.sections[active].title} onChange={e => updateSection(active, { title: e.target.value })}/></div><button type="button" className="icon-btn danger-icon" title="Eliminar sección" aria-label="Eliminar sección" onClick={() => deleteSection(active)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg></button></div><textarea className="instructions" aria-label="Instrucciones de la sección" value={exam.sections[active].instructions} onChange={e => updateSection(active, { instructions: e.target.value })} placeholder="Instrucciones para esta sección"/><div className="pick-row"><span>Preguntas disponibles <b>{exam.sections[active].questions.length}</b></span><label>{exam.variants > 1 ? "Preguntas por forma" : "Preguntas incluidas"} <input type="number" min="0" max={exam.sections[active].questions.length} value={Math.max(0, Math.min(exam.sections[active].pick ?? 0, exam.sections[active].questions.length))} onChange={e => updateSection(active, { pick: Math.max(0, Math.min(Number(e.target.value) || 0, exam.sections[active].questions.length)) })} /></label></div>
            {exam.sections[active].questions.map((q, qi) => <article className="question-card" key={q.id}>
              <div className="question-toolbar"><select aria-label="Tipo de pregunta" value={q.kind} onChange={e => changeQuestionKind(active, qi, e.target.value as QuestionKind)}>{questionTypes.map(type => <option key={type.kind} value={type.kind}>{type.label}</option>)}</select><label className="points">Puntaje <input type="number" min="0" value={q.points} onChange={e => updateQuestion(active, qi, { points: Math.max(0, Number(e.target.value) || 0) })}/></label><button className="delete-q" title="Eliminar pregunta" aria-label="Eliminar pregunta" onClick={() => { const section = exam.sections[active]; const questions = section.questions.filter((_, i) => i !== qi); updateSection(active, { questions, pick: Math.min(section.pick, questions.length) }); }}>×</button></div>
              <textarea className="question-prompt" aria-label="Enunciado de la pregunta" value={q.text} onChange={e => updateQuestion(active, qi, { text: e.target.value })} placeholder={q.kind === "fill" ? "Incluye ____ por cada espacio que deben completar" : "Escribe el enunciado de la pregunta"}/>
              {q.kind === "written" ? <div className="question-extra"><label>Líneas para responder <input type="number" min="1" max="12" value={Math.max(1, Math.min(12, q.responseLines ?? 3))} onChange={e => updateQuestion(active, qi, { responseLines: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })}/></label><div className="written-hint">☷ &nbsp; Espacio de respuesta en el PDF</div></div> :
              q.kind === "fill" ? <label className="expected-answer">Respuesta esperada (solo pauta)<input value={q.expected || ""} onChange={e => updateQuestion(active, qi, { expected: e.target.value })} placeholder="Escribe la respuesta correcta"/></label> :
              q.kind === "matching" ? <div className="pairs-list"><div className="eyebrow">PAREJAS · LA COLUMNA B SE MEZCLA EN CADA FORMA</div>{(q.pairs || []).map((pair, pi) => <div className="pair-row" key={pi}><span>{pi + 1}.</span><input aria-label={`Elemento ${pi + 1} de columna A`} value={pair.left} onChange={e => updateQuestion(active, qi, { pairs: q.pairs?.map((p, i) => i === pi ? { ...p, left: e.target.value } : p) })}/><input aria-label={`Elemento ${pi + 1} de columna B`} value={pair.right} onChange={e => updateQuestion(active, qi, { pairs: q.pairs?.map((p, i) => i === pi ? { ...p, right: e.target.value } : p) })}/><button className="option-delete" aria-label="Eliminar pareja" disabled={(q.pairs || []).length <= 1} onClick={() => updateQuestion(active, qi, { pairs: q.pairs?.filter((_, i) => i !== pi) })}>×</button></div>)}<button className="add-option" onClick={() => updateQuestion(active, qi, { pairs: [...(q.pairs || []), { left: `Concepto ${(q.pairs || []).length + 1}`, right: `Definición ${(q.pairs || []).length + 1}` }] })}>＋ Añadir pareja</button></div> :
              <div className="options-list">{q.options.map((option, oi) => <div className="option-row" key={oi}><button className={(q.kind === "multiple" ? (q.answers || []).includes(oi) : q.answer === oi) ? "answer-dot correct" : "answer-dot"} title={q.kind === "multiple" ? "Alternar respuesta correcta" : "Marcar correcta"} aria-label={`${q.kind === "multiple" ? "Alternar correcta" : "Marcar correcta"}: ${option}`} aria-pressed={q.kind === "multiple" ? (q.answers || []).includes(oi) : q.answer === oi} onClick={() => q.kind === "multiple" ? updateQuestion(active, qi, { answers: (q.answers || []).includes(oi) ? (q.answers || []).length > 1 ? (q.answers || []).filter(index => index !== oi) : q.answers : [...(q.answers || []), oi] }) : updateQuestion(active, qi, { answer: oi })}>{(q.kind === "multiple" ? (q.answers || []).includes(oi) : q.answer === oi) ? "✓" : String.fromCharCode(65 + oi)}</button><input aria-label={`Texto de alternativa ${oi + 1}`} value={option} onChange={e => updateQuestion(active, qi, { options: q.options.map((o, i) => i === oi ? e.target.value : o) })}/>{q.kind !== "truefalse" && <button className="option-delete" disabled={q.options.length <= 2 || q.kind === "multiple" && (q.answers || []).length <= 1 && (q.answers || []).includes(oi)} aria-label="Eliminar alternativa" onClick={() => { const options = q.options.filter((_, i) => i !== oi); const answers = (q.answers || []).filter(index => index !== oi).map(index => index > oi ? index - 1 : index); updateQuestion(active, qi, { options, answer: q.answer === oi ? 0 : q.answer > oi ? q.answer - 1 : q.answer, answers }); }}>×</button>}</div>)}{q.kind !== "truefalse" && <button className="add-option" onClick={() => updateQuestion(active, qi, { options: [...q.options, `Alternativa ${String.fromCharCode(65 + q.options.length)}`] })}>＋ Añadir alternativa</button>}</div>}
              <div className="card-footer"><span>✓ {q.kind === "written" ? "Respuesta libre" : q.kind === "fill" ? <>Pauta: <b>{q.expected || "sin respuesta esperada"}</b></> : q.kind === "matching" ? `${(q.pairs || []).length} parejas` : q.kind === "multiple" ? <>Correctas: <b>{(q.answers || []).map(i => q.options[i]).filter(Boolean).join(", ") || "sin marcar"}</b></> : <>Respuesta correcta: <b>{q.options[q.answer] || "sin marcar"}</b></>}</span><span>{exam.variants > 1 ? "↔ Puede cambiar por forma" : "↔ Orden mezclado al exportar"}</span></div>
            </article>)}
            <div className="add-question-tools"><button className="btn ghost add-question-trigger" aria-expanded={questionPickerOpen} onClick={() => setQuestionPickerOpen(open => !open)}>{questionPickerOpen ? "× Cerrar tipos" : "＋ Agregar pregunta"}</button>{questionPickerOpen && <div className="question-type-picker" aria-label="Tipos de pregunta">{questionGroups.map(group => <section className="question-type-group" key={group}><h4>{group}</h4><div>{questionTypes.filter(type => type.group === group).map(type => <button key={type.kind} onClick={() => { addQuestion(active, type.kind); setQuestionPickerOpen(false); }}><b>{type.label}</b><span>{type.description}</span></button>)}</div></section>)}</div>}</div>
            <button className="btn ghost bank-source-trigger" onClick={() => setTab("bank")}>Añadir desde un banco</button>
          </div> : <div className="empty-card">Crea una sección para comenzar.</div>}
          <div className="lower-actions"><button className="btn ghost" onClick={() => setTab("header")}>▧ Diseñar encabezado</button><button className="btn ghost" onClick={shareBank}>↗ Compartir banco</button><button className="btn ghost" onClick={exportQuestions}>↓ Exportar preguntas JSON</button><label className="btn ghost import-label">↑ Importar preguntas<input type="file" accept="application/json,.json" onChange={importFile}/></label></div>
        </section><aside className="minimap-column" hidden={!minimapVisible}><div className="minimap-head"><div className="eyebrow">ESTRUCTURA</div><h3>Mapa de contenido</h3><p>Navega por secciones y revisa cuántas preguntas entran en cada forma.</p></div><div className="minimap-stats"><span><b>{exam.sections.length}</b> secciones</span><span><b>{total}</b> preguntas incluidas</span></div><nav className="minimap-sections" aria-label="Secciones de la prueba">{exam.sections.map((section, index) => { const included = Math.max(0, Math.min(Number(section.pick) || 0, section.questions.length)); return <button type="button" key={section.id} className={active === index ? "minimap-section active" : "minimap-section"} onClick={() => { setActive(index); document.getElementById("section-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}><span className="minimap-number">{String(index + 1).padStart(2, "0")}</span><span className="minimap-copy"><b>{section.title || `Sección ${index + 1}`}</b><small>{included} de {section.questions.length} preguntas</small><span className="minimap-meter"><i style={{ width: `${section.questions.length ? included / section.questions.length * 100 : 0}%` }} /></span></span></button>; })}</nav><div className="minimap-footer"><span>Banco: {questions.length} preguntas</span><span>Configuración: {exam.variants} forma{exam.variants === 1 ? "" : "s"}</span></div></aside></div>}
      {tab === "header" && <div className="content editor-layout"><section className="edit-column"><div className="eyebrow"><span>✦</span> DISEÑO DE LA PRUEBA</div><h1 className="page-title">Personaliza el encabezado</h1><p className="page-description">Adapta la primera parte de la hoja al formato de tu colegio. Los cambios se aplican a todas las formas.</p><div className="header-config-card"><div className="eyebrow">IDENTIDAD DEL ESTABLECIMIENTO</div><div className="logo-row">{exam.header.logo ? <img className="logo-thumb" src={exam.header.logo} alt="Vista previa del logo"/> : <div className="logo-placeholder">▧</div>}<div className="logo-upload"><b>Logo o insignia</b><span>Se ajusta automáticamente · JPG o PNG, máximo 5 MB</span><label className="btn ghost">{exam.header.logo ? "Cambiar logo" : "＋ Subir logo"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => uploadLogo(e.target.files?.[0])}/></label></div>{exam.header.logo && <button className="remove-logo" onClick={() => updateHeader({ logo: "" })}>Quitar</button>}</div><label className="header-label">NOMBRE DEL ESTABLECIMIENTO<input value={exam.header.school} onChange={e => updateHeader({ school: e.target.value })} placeholder="Ej. Escuela Básica Los Aromos"/></label><div className="header-divider"/><div className="eyebrow">TÍTULOS IMPRESOS</div><label className="header-label">TÍTULO PRINCIPAL<input value={exam.header.title} onChange={e => updateHeader({ title: e.target.value })} placeholder={exam.title || "Usar el título de la prueba"}/><small>Si lo dejas vacío, se imprime el título de la prueba.</small></label><label className="header-label">SUBTÍTULO O TEXTO INSTITUCIONAL<input value={exam.header.subtitle} onChange={e => updateHeader({ subtitle: e.target.value })} placeholder="Ej. Departamento de Ciencias · Año 2026"/></label><div className="header-divider"/><div className="header-fields-head"><div><div className="eyebrow">ESPACIOS PARA COMPLETAR</div><span>Activa, renombra y ordena los campos de identificación y calificación.</span></div></div><div className="header-fields">{exam.header.fields.map(field => <div className={field.enabled ? "header-field" : "header-field disabled"} key={field.id}><input aria-label={`Mostrar ${field.label}`} type="checkbox" checked={field.enabled} onChange={e => updateHeaderField(field.id, { enabled: e.target.checked })}/><input className="field-name" aria-label={`Nombre del campo ${field.label}`} value={field.label} onChange={e => updateHeaderField(field.id, { label: e.target.value })}/><label className="wide-toggle"><input type="checkbox" checked={field.wide} onChange={e => updateHeaderField(field.id, { wide: e.target.checked })}/> Línea completa</label><button className="option-delete" title="Eliminar campo" aria-label="Eliminar campo" onClick={() => updateHeader({ fields: exam.header.fields.filter(item => item.id !== field.id) })}>×</button></div>)}</div><button className="add-option add-header-field" onClick={() => updateHeader({ fields: [...exam.header.fields, { id: uid(), label: "Nuevo campo", enabled: true, wide: false }] })}>＋ Añadir espacio</button><div className="header-help">Los espacios aparecen en la hoja como líneas para escribir a mano. Por ejemplo: nombre, RUT, puntaje, nota o firma.</div></div><div className="lower-actions"><button className="btn ghost" onClick={() => setTab("editor")}>← Volver al contenido</button></div></section><div className="header-export-note"><div><b>Previsualización del documento</b><span>Usa la vista previa de exportación para ver el PDF real y ajustar su densidad.</span></div><button className="btn primary" onClick={printPdf}>Vista previa y estilos PDF</button></div></div>}
      {tab === "history" && <div className="content page-content"><div className="page-heading"><div><div className="eyebrow">TU BIBLIOTECA</div><h1>Mis pruebas</h1><p>Tus documentos se guardan como datos y se regeneran al exportar.</p></div><button className="btn primary" onClick={startNewExam}>＋ Nueva prueba</button></div>{!user ? <div className="empty-card">Inicia sesión para guardar y consultar tus pruebas.<button className="btn primary" onClick={() => setModal("auth")}>Iniciar sesión</button></div> : historyLoading ? <div className="empty-card" role="status">Cargando tu historial…</div> : historyError ? <div className="empty-card history-error" role="alert">{historyError}<button className="btn ghost" onClick={loadHistory}>Reintentar</button></div> : history.length ? <div className="history-grid">{history.map(item => <article className="history-card" key={item.id}><div className="doc-icon">▤</div><div className="history-info"><b>{item.title}</b><span>{new Date(item.updated_at).toLocaleDateString("es-CL")} · {item.data?.sections?.flatMap((s: Section) => s.questions).length || 0} preguntas</span></div><button onClick={() => restore(item)}>Abrir →</button></article>)}</div> : <div className="empty-card">Todavía no tienes pruebas guardadas. Crea una y pulsa Guardar.</div>}</div>}
      {tab === "bank" && <div className="content page-content"><div className="page-heading"><div><div className="eyebrow">COMUNIDAD DOCENTE</div><h1>Banco de preguntas</h1><p>Publica la prueba actual o añade preguntas de un banco directamente a esta prueba.</p></div><button className="btn primary" onClick={() => { setTab("editor"); shareBank(); }}>↗ Compartir selección</button></div><div className="bank-feature"><div className="bank-art">✳</div><div><div className="eyebrow">PRUEBA ACTUAL</div><h2>{exam.title}</h2><p>{questions.length} preguntas · {exam.subject || "Sin asignatura"}</p><button className="btn primary" onClick={shareBank}>Publicar como banco</button></div></div><section className="bank-library" aria-labelledby="bank-library-title"><div className="bank-library-heading"><div><div className="eyebrow">USAR DURANTE LA CREACIÓN</div><h2 id="bank-library-title">Añadir preguntas a la prueba</h2><p>Elige un banco publicado o pega un enlace. Sus preguntas se incorporan a la sección activa «{exam.sections[active]?.title || "Sección"}»; el resto de la prueba se conserva.</p></div><button className="btn ghost" onClick={() => setTab("editor")}>Volver al editor</button></div><form className="bank-link-form" onSubmit={submitBankLink}><label htmlFor="shared-bank-link">Enlace compartido o UUID del banco<input id="shared-bank-link" type="text" required value={bankLink} onChange={event => setBankLink(event.target.value)} placeholder="https://tu-dominio.cl/?banco=…"/></label><button className="btn primary" disabled={busy !== ""}>{busy === "bank" ? "Añadiendo…" : "Añadir por enlace"}</button></form>{!user ? <div className="empty-card bank-library-state">Inicia sesión para ver tus bancos publicados. Puedes añadir un enlace compartido arriba.<button className="btn ghost" onClick={() => setModal("auth")}>Iniciar sesión</button></div> : banksLoading ? <div className="empty-card bank-library-state" role="status">Cargando tus bancos publicados…</div> : banksError ? <div className="empty-card bank-library-state" role="alert">{banksError}<button className="btn ghost" onClick={() => void loadBanks()}>Reintentar</button></div> : banks.length ? <ul className="bank-list">{banks.map(bank => <li className="bank-list-item" key={bank.id}><div className="bank-list-info"><b>{bank.title}</b><span>Publicado el {new Date(bank.created_at).toLocaleDateString("es-CL")}</span></div><button className="btn ghost" disabled={busy !== ""} onClick={() => void importBankById(bank.id)}>{busy === "bank" ? "Añadiendo…" : "Añadir a esta prueba"}</button></li>)}</ul> : <div className="empty-card bank-library-state">Todavía no tienes bancos publicados. Comparte una prueba para poder reutilizarla aquí.</div>}</section></div>}
    </section>
    {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setModal(null); }}><div className={modal === "export" ? "modal export-modal" : "modal"} role="dialog" aria-modal="true" aria-label={modal === "auth" ? authMode === "register" ? "Crear cuenta" : "Iniciar sesión" : modal === "export" ? "Vista previa del PDF" : modal === "variants" ? "Configuración de formas" : "Enlace de banco compartido"} tabIndex={-1} ref={dialogRef}><button className="modal-close" aria-label="Cerrar diálogo" onClick={() => setModal(null)}>×</button>{modal === "auth" ? <><div className="brand-large">A<span>.</span></div><div className="eyebrow">BIENVENIDO A APOLLO</div><h2>{authMode === "register" ? "Tu próxima prueba empieza aquí." : "Qué bueno verte de nuevo."}</h2><p>Guarda tus pruebas y accede a ellas desde cualquier lugar.</p><form onSubmit={authSubmit}>{notice && <p className="form-error">{notice}</p>}{authMode === "register" && <label>Nombre<input required minLength={2} value={name} onChange={e => setName(e.target.value)} placeholder="Tu nombre"/></label>}<label>Correo electrónico<input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="profe@colegio.cl"/></label><label>Contraseña<input required minLength={10} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="10 caracteres o más"/></label><button className="btn primary full" disabled={authBusy}>{authBusy ? "Un momento…" : authMode === "register" ? "Crear cuenta" : "Iniciar sesión"}</button></form><button className="switch-auth" onClick={() => setAuthMode(authMode === "register" ? "login" : "register")}>{authMode === "register" ? "¿Ya tienes cuenta? Inicia sesión" : "¿Primera vez? Crea una cuenta"}</button></> : modal === "export" ? <><div className="export-title"><div className="eyebrow">EXPORTACIÓN</div><h2>Revisa el PDF</h2><p>Elige un estilo y comprueba el documento real antes de descargarlo.</p></div><><div className="pdf-style-options" role="radiogroup" aria-label="Estilo del documento">{[{ id: "compact", label: "Compacto", description: "Más contenido por página y encabezado reducido." }, { id: "balanced", label: "Equilibrado", description: "Espaciado intermedio para lectura cómoda." }, { id: "spacious", label: "Amplio", description: "Texto y espacios de respuesta más generosos." }].map(option => <button type="button" role="radio" aria-checked={pdfStyle === option.id} className={pdfStyle === option.id ? "pdf-style-option selected" : "pdf-style-option"} key={option.id} disabled={busy === "preview"} onClick={() => changePdfStyle(option.id as PdfStyle)}><b>{option.label}</b><span>{option.description}</span></button>)}</div><a className="btn ghost pdf-open-link" href={pdfPreviewUrl} target="_blank" rel="noreferrer">Abrir PDF en una pestaña nueva</a></><div className="pdf-preview-frame">{busy === "preview" ? <div className="pdf-preview-loading">Actualizando vista previa…</div> : pdfPreviewUrl ? <iframe title="Vista previa del PDF para imprimir" src={pdfPreviewUrl} /> : <div className="pdf-preview-loading">Preparando documento…</div>}</div><div className="export-modal-actions"><button className="btn ghost" onClick={() => setModal(null)}>Cerrar</button><button className="btn ghost" onClick={printAnswerKey} disabled={busy === "key" || !generation || generation.signature !== JSON.stringify(exam)}>{busy === "key" ? "Generando pauta…" : "Descargar pauta"}</button><button className="btn primary" onClick={downloadPreview} disabled={!pdfPreviewUrl || busy === "preview"}>Descargar PDF de estudiantes</button></div></> : modal === "variants" ? <><div className="eyebrow">CONFIGURACIÓN DE IMPRESIÓN</div><h2>Formas de la prueba</h2><p>Genera hasta 10 versiones. El orden de las preguntas y alternativas se mezcla por forma.</p><label className="variant-number">Cantidad de formas<input type="number" min="1" max="10" value={exam.variants} onChange={e => updateExam({ variants: Math.max(1, Math.min(10, Number(e.target.value))) })}/></label>{exam.variants > 1 && <div className="variant-note">Cada forma usa una selección y orden diferentes cuando hay preguntas disponibles.</div>}<button className="btn primary full" onClick={() => setModal(null)}>Listo</button></> : <><div className="eyebrow">BANCO COMPARTIDO</div><h2>Enlace listo para compartir</h2><p>Cualquier profesor con el enlace podrá importar una copia de estas preguntas.</p><div className="share-input">{shareUrl}<button onClick={() => { navigator.clipboard.writeText(shareUrl); setNotice("Enlace copiado."); }}>Copiar</button></div><button className="btn primary full" onClick={() => setModal(null)}>Listo</button></>}</div></div>}
    {user && <button className="signout" onClick={async () => { await supabase().auth.signOut(); setUser(null); setHistory([]); }}>↪ Cerrar sesión</button>}
  </main>;
}
