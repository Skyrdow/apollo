"use client";

import { isRecord } from "@/lib/type-guards";
import { renderToString } from "katex";
import html2canvas from "html2canvas";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import { supabase } from "@/lib/supabase";

type QuestionKind = "choice" | "multiple" | "truefalse" | "written" | "fill" | "matching";
type Question = { id: string; kind: QuestionKind; text: string; equation?: string; options: string[]; answer: number; answers?: number[]; expected?: string; pairs?: { left: string; right: string }[]; points: number; responseLines?: number; showResponseLines?: boolean };
type Section = { id: string; title: string; instructions: string; pick: number; questions: Question[] };
type HeaderFieldRow = 1 | 2;
type HeaderField = { id: string; label: string; enabled: boolean; row: HeaderFieldRow; width: number };
const defaultHeaderFields: Omit<HeaderField, "id" | "enabled">[] = [
  { label: "Nombre y apellido", row: 1, width: 7.5 },
  { label: "Fecha", row: 1, width: 2.5 },
  { label: "Nota", row: 1, width: 2 },
  { label: "RUT / identificador", row: 2, width: 4 },
  { label: "Curso", row: 2, width: 2.5 },
  { label: "Puntaje", row: 2, width: 2.5 },
];
function headerFieldRows(fields: HeaderField[]) {
  if (!fields.length) return [];
  const rows: HeaderField[][] = [[], []];
  for (const field of fields) rows[field.row - 1].push(field);
  if (!rows[1].length) return rows[0].length ? [rows[0]] : [];
  return rows;
}
type HeaderLayout = "institutional" | "split";
type ExamHeader = {
  school: string;
  title: string;
  subtitle: string;
  logo: string;
  rightLogo: string;
  layout: HeaderLayout;
  courseCode: string;
  assessment: string;
  academicPeriod: string;
  date: string;
  repeatOnPages: boolean;
  fields: HeaderField[];
};
type Exam = { title: string; subject: string; grade: string; teacher: string; duration: string; variants: number; header: ExamHeader; sections: Section[] };
type PdfStyle = "compact" | "balanced" | "spacious";
type PlannedQuestion = { question: Question; optionOrder: number[]; matchOrder: number[] };
type FormPlan = { sections: { title: string; instructions: string; questions: PlannedQuestion[] }[]; points: number };
type Generation = { signature: string; forms: FormPlan[] };
type User = { id: string; email: string; user_metadata?: { full_name?: string } };
type SavedDocument = { id: string; title: string; updated_at: string; data: Exam };
type SavedBank = { id: string; title: string; created_at: string };
const mathDelimiterSplit = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/g;
const mathDelimiterTest = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$/;
const mathSnippets = [
  { label: "Fracción", latex: "\\frac{a}{b}" },
  { label: "Raíz", latex: "\\sqrt{x}" },
  { label: "Integral", latex: "\\int_{a}^{b} f(x)\\,dx" },
  { label: "Sumatoria", latex: "\\sum_{i=1}^{n} a_i" },
  { label: "Límite", latex: "\\lim_{x\\to 0} f(x)" },
  { label: "Casos", latex: "\\begin{cases}x,&x>0\\\\-x,&x\\le 0\\end{cases}" },
];
function containsLatexMath(source: string) {
  return mathDelimiterTest.test(source);
}
function escapeHtml(source: string) {
  return source.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function renderMathMarkup(source: string) {
  return source.split(mathDelimiterSplit).map(part => {
    const displayMode = part.startsWith("$$") || part.startsWith("\\[");
    const delimiterSize = part.startsWith("\\") || part.startsWith("$$") ? 2 : 1;
    const isMath = part.startsWith("$$") || part.startsWith("\\[") || part.startsWith("\\(") || part.startsWith("$") && part.endsWith("$");
    if (!isMath) return escapeHtml(part);
    return renderToString(part.slice(delimiterSize, -delimiterSize), { displayMode, output: "html", throwOnError: false });
  }).join("");
}
async function renderMathCanvas(source: string, widthMm: number, fontSizePt: number, bold: boolean) {
  const element = document.createElement("div");
  element.className = "pdf-math-render";
  element.style.width = `${widthMm * 96 / 25.4}px`;
  element.style.fontSize = `${fontSizePt * 96 / 72}px`;
  element.style.fontWeight = bold ? "700" : "400";
  element.innerHTML = renderMathMarkup(source);
  document.body.appendChild(element);
  try {
    await document.fonts.ready;
    return await html2canvas(element, { backgroundColor: "#fff", scale: 2, logging: false });
  } finally {
    element.remove();
  }
}
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
    rightLogo: "",
    layout: "institutional",
    courseCode: "",
    assessment: "",
    academicPeriod: "",
    date: "",
    repeatOnPages: true,
    fields: defaultHeaderFields.map(field => ({ id: uid(), enabled: true, ...field })),
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
function splitTrailingDisplayEquation(source: string) {
  const match = /(?:^|\n)\\\[\n([\s\S]*?)\n\\\]\s*$/.exec(source);
  if (!match) return null;
  return { text: source.slice(0, match.index).replace(/\n+$/, ""), equation: match[1].trim() };
}
function parseQuestions(value: unknown): Question[] | null {
  if (!Array.isArray(value) || value.length > 500) return null;
  const questions: Question[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    const kind = candidate.kind;
    const rawText = candidate.text;
    const candidateEquation = candidate.equation;
    const candidateShowResponseLines = candidate.showResponseLines;
    const points = candidate.points;
    const options = candidate.options;
    if (!isQuestionKind(kind) || typeof rawText !== "string" || rawText.length > 20_000 ||
        typeof points !== "number" || !Number.isFinite(points) || points < 0 ||
        !Array.isArray(options) || options.length > 100 ||
        !options.every((option): option is string => typeof option === "string" && option.length <= 10_000)) return null;
    if (candidateEquation !== undefined &&
        (typeof candidateEquation !== "string" || candidateEquation.length > 20_000)) return null;
    if (candidateShowResponseLines !== undefined && typeof candidateShowResponseLines !== "boolean") return null;
    const legacyDisplayEquation = candidateEquation === undefined ? splitTrailingDisplayEquation(rawText) : null;
    const text = legacyDisplayEquation?.text ?? rawText;
    const equation = typeof candidateEquation === "string" ? candidateEquation : legacyDisplayEquation?.equation;
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
      equation,
      options: [...options],
      answer,
      answers,
      expected: typeof expected === "string" ? expected : "",
      pairs,
      points,
      responseLines: kind === "written" && typeof rawResponseLines === "number" ? rawResponseLines : kind === "written" ? 3 : undefined,
      showResponseLines: kind === "written" ? candidateShowResponseLines !== false : undefined,
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
  if ((value.header.rightLogo !== undefined && typeof value.header.rightLogo !== "string") ||
      (value.header.layout !== undefined && value.header.layout !== "institutional" && value.header.layout !== "split") ||
      (value.header.courseCode !== undefined && typeof value.header.courseCode !== "string") ||
      (value.header.assessment !== undefined && typeof value.header.assessment !== "string") ||
      (value.header.academicPeriod !== undefined && typeof value.header.academicPeriod !== "string") ||
      (value.header.date !== undefined && typeof value.header.date !== "string") ||
      (value.header.repeatOnPages !== undefined && typeof value.header.repeatOnPages !== "boolean")) return null;
  const rawFields = value.header.fields;
  const legacyFieldFormat = rawFields.length > 0 && rawFields.every(item =>
    isRecord(item) && typeof item.wide === "boolean" && item.row === undefined && item.width === undefined);
  const currentFieldFormat = rawFields.every(item =>
    isRecord(item) && item.wide === undefined && (item.row === 1 || item.row === 2) &&
    typeof item.width === "number" && Number.isFinite(item.width) && item.width >= 1 && item.width <= 18);
  if (!legacyFieldFormat && !currentFieldFormat) return null;
  const fields: HeaderField[] = [];
  const legacyFields: { id: string; label: string; enabled: boolean; wide: boolean }[] = [];
  for (const item of rawFields) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.label !== "string" ||
        typeof item.enabled !== "boolean") return null;
    if (legacyFieldFormat) {
      if (typeof item.wide !== "boolean") return null;
      legacyFields.push({ id: item.id, label: item.label, enabled: item.enabled, wide: item.wide });
    } else {
      if ((item.row !== 1 && item.row !== 2) || typeof item.width !== "number" ||
          !Number.isFinite(item.width) || item.width < 1 || item.width > 18) return null;
      fields.push({ id: item.id, label: item.label, enabled: item.enabled, row: item.row, width: item.width });
    }
  }
  if (legacyFieldFormat) {
    const previousLabels = ["Nombre y apellido", "RUT / identificador", "Curso", "Fecha", "Puntaje", "Nota", "Firma"];
    const oldDefault = legacyFields.length === previousLabels.length &&
      legacyFields.every((field, index) => field.label === previousLabels[index] && field.enabled &&
        (field.wide === (index === 0) || field.wide === (index === 0 || index === 6)));
    if (oldDefault) {
      for (const field of defaultHeaderFields) {
        const saved = legacyFields.find(item => item.label === field.label);
        if (saved) fields.push({ ...field, id: saved.id, enabled: saved.enabled });
      }
    } else {
      for (const field of legacyFields) {
        const preset = defaultHeaderFields.find(item => item.label === field.label);
        fields.push({
          id: field.id,
          label: field.label,
          enabled: field.enabled,
          row: preset?.row ?? (field.wide ? 1 : 2),
          width: preset?.width ?? (field.wide ? 14 : 4.5),
        });
      }
    }
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
      rightLogo: typeof value.header.rightLogo === "string" ? value.header.rightLogo : "",
      layout: value.header.layout === "split" ? "split" : "institutional",
      courseCode: typeof value.header.courseCode === "string" ? value.header.courseCode : "",
      assessment: typeof value.header.assessment === "string" ? value.header.assessment : "",
      academicPeriod: typeof value.header.academicPeriod === "string" ? value.header.academicPeriod : "",
      date: typeof value.header.date === "string" ? value.header.date : "",
      repeatOnPages: typeof value.header.repeatOnPages === "boolean" ? value.header.repeatOnPages : true,
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
  const [activeMathQuestion, setActiveMathQuestion] = useState<string | null>(null);
  const [latexDraft, setLatexDraft] = useState("\\frac{a}{b}");
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
  async function uploadLogo(file?: File, slot: "logo" | "rightLogo" = "logo") {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setNotice("Selecciona un archivo de imagen.");
    if (file.size > 5_000_000) return setNotice("El logo debe pesar menos de 5 MB.");
    try {
      const image = new Image(); image.src = URL.createObjectURL(file); await image.decode();
      const scale = Math.min(1, 600 / image.width, 240 / image.height); const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
      canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(image.src);
      const compressed = canvas.toDataURL("image/jpeg", 0.82);
      updateHeader(slot === "logo" ? { logo: compressed } : { rightLogo: compressed });
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
  function toggleMathEditor(questionId: string, equation: string) {
    if (activeMathQuestion === questionId) {
      setActiveMathQuestion(null);
      return;
    }
    setLatexDraft(equation || "\\frac{a}{b}");
    setActiveMathQuestion(questionId);
  }
  function insertLatex(si: number, qi: number) {
    const formula = latexDraft.trim();
    if (!formula) return setNotice("Escribe una expresión LaTeX antes de insertarla.");
    updateQuestion(si, qi, { equation: formula });
    setActiveMathQuestion(null);
  }
  function addQuestion(si: number, kind: QuestionKind = "choice") {
    const options = ["choice", "multiple"].includes(kind) ? ["Alternativa A", "Alternativa B", "Alternativa C", "Alternativa D"] : kind === "truefalse" ? ["Verdadero", "Falso"] : [];
    const q: Question = { id: uid(), kind, text: "Escribe tu pregunta aquí…", equation: "", options, answer: 0, answers: kind === "multiple" ? [0] : [], expected: "", pairs: kind === "matching" ? [{ left: "Concepto A", right: "Definición A" }, { left: "Concepto B", right: "Definición B" }] : [], points: 1, responseLines: 3, showResponseLines: kind === "written" };
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
    updateQuestion(si, qi, { kind, options, answer: 0, answers: kind === "multiple" ? [0] : [], expected: "", pairs: kind === "matching" ? [{ left: "Concepto A", right: "Definición A" }, { left: "Concepto B", right: "Definición B" }] : [], responseLines: 3, showResponseLines: kind === "written" ? true : undefined });
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
  async function exportForms(forms: FormPlan[], answerKey = false, styleName: PdfStyle = pdfStyle): Promise<Blob> {
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
      let continuationHeader: (() => number) | null = null;
      const newContentPage = () => {
        pdf.addPage();
        y = top;
        if (continuationHeader) y = continuationHeader();
      };
      const ensureSpace = (height: number) => { if (y + height > bottom && y > top) newContentPage(); };
      const write = async (text: string, size = 10, bold = false) => {
        const actualSize = size * style.scale;
        if (containsLatexMath(text)) {
          const canvas = await renderMathCanvas(text, width, actualSize, bold);
          const pixelsPerMm = 2 * 96 / 25.4;
          const heightMm = canvas.height / pixelsPerMm;
          if (y > top && y + heightMm > bottom) newContentPage();
          if (y + heightMm <= bottom) {
            pdf.addImage(canvas, "PNG", left, y, width, heightMm, undefined, "FAST");
            y += heightMm + Math.max(style.paragraphGap, actualSize * 0.2);
            return;
          }
          let sourceY = 0;
          while (sourceY < canvas.height) {
            const availablePixels = Math.floor((bottom - y) * pixelsPerMm);
            if (availablePixels <= 0) {
              newContentPage();
              continue;
            }
            const sliceHeight = Math.min(canvas.height - sourceY, availablePixels);
            const slice = document.createElement("canvas");
            slice.width = canvas.width;
            slice.height = sliceHeight;
            slice.getContext("2d")!.drawImage(canvas, 0, sourceY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
            pdf.addImage(slice, "PNG", left, y, width, sliceHeight / pixelsPerMm, undefined, "FAST");
            y += sliceHeight / pixelsPerMm;
            sourceY += sliceHeight;
            if (sourceY < canvas.height) newContentPage();
          }
          y += Math.max(style.paragraphGap, actualSize * 0.2);
          return;
        }
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
      const drawBlock = (
        lines: { text: string; size: number; bold?: boolean }[],
        x: number,
        blockWidth: number,
        startY: number,
        align: "left" | "center" | "right",
      ) => {
        let cursor = startY;
        for (const line of lines) {
          if (!line.text) continue;
          const actualSize = line.size * style.scale;
          pdf.setFont("helvetica", line.bold ? "bold" : "normal");
          pdf.setFontSize(actualSize);
          const wrapped = pdf.splitTextToSize(line.text, blockWidth) as string[];
          const lineHeight = Math.max(3.2, actualSize * style.leading);
          for (const part of wrapped) {
            const textWidth = pdf.getTextWidth(part);
            const textX = align === "center" ? x + (blockWidth - textWidth) / 2 : align === "right" ? x + blockWidth - textWidth : x;
            pdf.text(part, textX, cursor);
            cursor += lineHeight;
          }
          cursor += style.paragraphGap;
        }
        return cursor;
      };
      const drawLogo = (source: string, x: number, imageY: number, maxWidth: number, maxHeight: number) => {
        if (!source) return;
        try {
          const image = pdf.getImageProperties(source);
          const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
          const imageWidth = image.width * scale;
          const imageHeight = image.height * scale;
          pdf.addImage(source, "JPEG", x + (maxWidth - imageWidth) / 2, imageY + (maxHeight - imageHeight) / 2, imageWidth, imageHeight);
        } catch { /* Ignore invalid image data in an imported document. */ }
      };
      const title = exam.header.title.trim() || exam.title.trim() || "Prueba";
      const assessment = exam.header.assessment.trim();
      const metadata = [exam.subject, exam.header.courseCode, exam.grade, exam.header.academicPeriod, exam.header.date, exam.duration, exam.teacher]
        .map(value => value.trim())
        .filter((value, index, values) => value && value.toLowerCase() !== title.toLowerCase() && values.indexOf(value) === index);
      const institutionLines = [
        ...(exam.header.school.trim() ? [{ text: exam.header.school.trim(), size: 8, bold: true }] : []),
        ...(exam.header.subtitle.trim() ? [{ text: exam.header.subtitle.trim(), size: 7.2 }] : []),
      ];
      const centeredHeading = [
        ...(answerKey ? [{ text: assessment ? `PAUTA ${assessment}` : "PAUTA", size: 8.5, bold: true }] : assessment ? [{ text: assessment, size: 8.5, bold: true }] : []),
        { text: title, size: style.titleFont, bold: true },
      ];
      const logoWidth = styleName === "spacious" ? 18 : 16;
      const logoHeight = styleName === "spacious" ? 16 : 13;
      const headingStart = y;
      pdf.setTextColor(0);
      if (exam.header.layout === "split") {
        if (exam.header.logo) drawLogo(exam.header.logo, left, headingStart, logoWidth, logoHeight);
        if (exam.header.rightLogo) drawLogo(exam.header.rightLogo, left + width - logoWidth, headingStart, logoWidth, logoHeight);
        const columnGap = 6;
        const columnWidth = (width - columnGap) / 2;
        const leftTextX = left + (exam.header.logo ? logoWidth + 2 : 0);
        const leftTextWidth = columnWidth - (leftTextX - left);
        const rightTextX = left + columnWidth + columnGap;
        const rightTextWidth = columnWidth - (exam.header.rightLogo ? logoWidth + 2 : 0);
        const rightLines = metadata.map(text => ({ text, size: 7.1 }));
        const leftEnd = drawBlock(institutionLines, leftTextX, leftTextWidth, headingStart, "left");
        const rightEnd = drawBlock(rightLines, rightTextX, rightTextWidth, headingStart, "right");
        y = Math.max(leftEnd, rightEnd) + style.paragraphGap;
        y = drawBlock(centeredHeading, left, width, y, "center");
      } else {
        if (exam.header.logo) drawLogo(exam.header.logo, left, headingStart, logoWidth, logoHeight);
        if (exam.header.rightLogo) drawLogo(exam.header.rightLogo, left + width - logoWidth, headingStart, logoWidth, logoHeight);
        const textX = left + (exam.header.logo ? logoWidth + 2 : 0);
        const textRight = left + width - (exam.header.rightLogo ? logoWidth + 2 : 0);
        const textWidth = textRight - textX;
        y = drawBlock([...institutionLines, ...centeredHeading], textX, textWidth, headingStart, "center");
        if (metadata.length) y = drawBlock([{ text: metadata.join("  ·  "), size: 7.2 }], textX, textWidth, y, "center");
      }
      if (exam.header.logo || exam.header.rightLogo) y = Math.max(y, headingStart + logoHeight);
      y += style.paragraphGap;
      if (exam.header.repeatOnPages) {
        const compactHeading = [
          answerKey ? (assessment ? `Pauta ${assessment}` : "Pauta") : assessment,
          title,
          `Forma ${String.fromCharCode(65 + form)}`,
        ].filter(Boolean).join(" · ");
        continuationHeader = () => {
          drawLogo(exam.header.logo, left, top, 9, 8);
          drawLogo(exam.header.rightLogo, left + width - 9, top, 9, 8);
          const textX = left + (exam.header.logo ? 11 : 0);
          const textWidth = width - (exam.header.logo ? 11 : 0) - (exam.header.rightLogo ? 11 : 0);
          const textEnd = drawBlock([{ text: compactHeading, size: 7.2, bold: true }], textX, textWidth, top + 4, "center");
          const ruleY = Math.max(top + 10, textEnd);
          pdf.setDrawColor(170);
          pdf.line(left, ruleY, left + width, ruleY);
          return ruleY + 4;
        };
      }
      if (!answerKey) {
        const fields = exam.header.fields.filter(field => field.enabled);
        for (const row of headerFieldRows(fields)) {
          ensureSpace(style.fieldRow);
          if (!row.length) {
            y += style.fieldRow;
            continue;
          }
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(style.fieldFont);
          pdf.setTextColor(95);
          pdf.setDrawColor(175);
          const labels = row.map(field => `${field.label}:`);
          const labelWidths = labels.map(label => pdf.getTextWidth(label));
          const gap = 2;
          const requestedWidths = row.map(field => field.width * 10);
          const labelAndGapWidth = labelWidths.reduce((sum, labelWidth) => sum + labelWidth + 1.5, 0) + gap * (row.length - 1);
          const availableWritingWidth = Math.max(0, width - labelAndGapWidth);
          const requestedWritingWidth = requestedWidths.reduce((sum, fieldWidth) => sum + fieldWidth, 0);
          const widthScale = requestedWritingWidth ? Math.min(1, availableWritingWidth / requestedWritingWidth) : 0;
          let x = left;
          for (let index = 0; index < row.length; index++) {
            pdf.text(labels[index], x, y);
            const lineStart = x + labelWidths[index] + 1.5;
            const lineWidth = requestedWidths[index] * widthScale;
            if (lineWidth > 0.5) pdf.line(lineStart, y + 0.8, lineStart + lineWidth, y + 0.8);
            x = lineStart + lineWidth + gap;
          }
          y += style.fieldRow;
        }
      }
      ensureSpace(5);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8 * style.scale);
      pdf.setTextColor(0);
      pdf.text(`Forma ${String.fromCharCode(65 + form)}     Total: ${forms[form].points} puntos`, left, y);
      y += 5 + style.questionGap;
      let number = 0;
      for (const section of forms[form].sections) {
        if (answerKey) await write(section.title, 11, true);
        else {
          await write(section.title, 13, true);
          if (section.instructions) await write(section.instructions, 9);
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
            await write(`${number}. ${key} (${q.points} pto${q.points === 1 ? "" : "s"})`, 10);
          } else {
            await write(`${number}. ${q.text}${q.kind === "multiple" ? " (Marca todas las alternativas correctas; puede haber más de una.)" : ""} (${q.points} pto${q.points === 1 ? "" : "s"})`, 10, true);
            if (q.equation?.trim()) {
              y += style.questionGap;
              await write(`\\[${q.equation.trim()}\\]`, 10);
              y += Math.max(2, style.questionGap);
            }
            if (q.kind === "written") {
              y += style.questionGap;
              pdf.setDrawColor(190);
              const responseLine = styleName === "spacious" ? 9 : styleName === "balanced" ? 7 : 5.5;
              for (let line = 0; q.showResponseLines !== false && line < Math.max(1, Math.min(12, q.responseLines ?? 3)); line++) {
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
              await write("Relaciona cada elemento de la columna A con la alternativa correcta de la columna B.", 8);
              for (const [index, pair] of pairs.entries()) await write(`${index + 1}. ${pair.left}   ______`, 9);
              for (const [index, pairIndex] of item.matchOrder.entries()) await write(`${String.fromCharCode(65 + index)}) ${pairs[pairIndex]?.right || ""}`, 9);
            } else {
              for (const [displayIndex, index] of item.optionOrder.entries()) await write(`${String.fromCharCode(65 + displayIndex)})  ${q.options[index] || ""}`, 9);
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
      const blob = await exportForms(forms, false, pdfStyle);
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
            {exam.sections[active].questions.map((q, qi) => <article className="question-card" key={q.id} data-include-response-lines={q.showResponseLines !== false}>
              <div className="question-toolbar"><select aria-label="Tipo de pregunta" value={q.kind} onChange={e => changeQuestionKind(active, qi, e.target.value as QuestionKind)}>{questionTypes.map(type => <option key={type.kind} value={type.kind}>{type.label}</option>)}</select><label className="points">Puntaje <input type="number" min="0" value={q.points} onChange={e => updateQuestion(active, qi, { points: Math.max(0, Number(e.target.value) || 0) })}/></label><button className="delete-q" title="Eliminar pregunta" aria-label="Eliminar pregunta" onClick={() => { const section = exam.sections[active]; const questions = section.questions.filter((_, i) => i !== qi); updateSection(active, { questions, pick: Math.min(section.pick, questions.length) }); }}>×</button></div>
              <textarea className="question-prompt" aria-label="Enunciado de la pregunta" value={q.text} onChange={event => updateQuestion(active, qi, { text: event.target.value })} placeholder={q.kind === "fill" ? "Incluye ____ por cada espacio que deben completar" : "Escribe el enunciado de la pregunta"}/>
              <div className="question-math-controls">
                <button type="button" className="btn ghost math-editor-toggle" aria-expanded={activeMathQuestion === q.id} onClick={() => toggleMathEditor(q.id, q.equation || "")}>∑ Editor de ecuaciones</button>
                <span>Soporta LaTeX entre <code>{"\\(…\\)"}</code>, <code>{"\\[…\\]"}</code>, <code>$…$</code> o <code>$$…$$</code>.</span>
              </div>
              {containsLatexMath(q.text) && <div className="math-render-preview question-math-preview" role="region" aria-label="Vista previa de ecuaciones" dangerouslySetInnerHTML={{ __html: renderMathMarkup(q.text) }}/>}
              {q.equation?.trim() && <div className="math-render-preview question-math-preview" role="region" aria-label="Vista previa de la ecuación de la pregunta" dangerouslySetInnerHTML={{ __html: renderMathMarkup(`\\[${q.equation.trim()}\\]`) }}/>}
              {activeMathQuestion === q.id && <div className="math-editor-panel">
                <label className="math-editor-label" htmlFor={`latex-${q.id}`}>Expresión LaTeX
                  <textarea id={`latex-${q.id}`} aria-label="Expresión LaTeX" value={latexDraft} onChange={event => setLatexDraft(event.target.value)} placeholder="\\frac{a}{b}"/>
                </label>
                <div className="math-snippets" aria-label="Plantillas matemáticas">{mathSnippets.map(snippet => <button type="button" className="btn ghost" key={snippet.label} onClick={() => setLatexDraft(current => `${current}${current ? "\n" : ""}${snippet.latex}`)}>{snippet.label}</button>)}</div>
                <div className="math-render-preview math-editor-preview" role="region" aria-label="Vista previa de la ecuación" dangerouslySetInnerHTML={{ __html: renderMathMarkup(`\\[${latexDraft}\\]`) }}/>
                <div className="math-editor-footer"><span>La ecuación se guardará en un campo separado del enunciado.</span><button type="button" className="btn primary" onClick={() => insertLatex(active, qi)}>{q.equation ? "Actualizar ecuación" : "Insertar ecuación"}</button></div>
              </div>}
              {q.kind === "written" && <div className="question-extra response-lines-control"><label className="response-lines-toggle"><input type="checkbox" aria-label="Incluir líneas de respuesta en el PDF" checked={q.showResponseLines !== false} onChange={event => updateQuestion(active, qi, { showResponseLines: event.target.checked })}/> Incluir líneas en PDF</label>{q.showResponseLines === false && <div className="written-hint">La respuesta se imprimirá sin líneas.</div>}</div>}
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
      {tab === "header" && <div className="content editor-layout header-editor-layout">
        <section className="edit-column">
          <div className="eyebrow"><span>✦</span> DISEÑO DE LA PRUEBA</div>
          <h1 className="page-title">Personaliza el encabezado</h1>
          <p className="page-description">Crea un encabezado universitario o institucional, con metadatos reales, dos logos opcionales y una vista previa en vivo.</p>
          <div className="header-config-card">
            <div className="eyebrow">DISTRIBUCIÓN</div>
            <label className="header-label">ESTILO DE IMPRESIÓN
              <select value={exam.header.layout} onChange={event => updateHeader({ layout: event.target.value as HeaderLayout })}>
                <option value="institutional">Institucional centrado</option>
                <option value="split">Bloques académicos a dos columnas</option>
              </select>
              <small>Elige entre logos y título centrados o datos institucionales y académicos enfrentados.</small>
            </label>
            <label className="header-repeat-option">
              <input type="checkbox" checked={exam.header.repeatOnPages} onChange={event => updateHeader({ repeatOnPages: event.target.checked })}/>
              <span><b>Repetir encabezado compacto</b><small>Identifica la prueba en las páginas siguientes.</small></span>
            </label>
            <div className="header-divider"/>
            <div className="eyebrow">IDENTIDAD INSTITUCIONAL</div>
            <div className="header-logos-grid">
              <div className="logo-row">
                {exam.header.logo ? <img className="logo-thumb" src={exam.header.logo} alt="Logo institucional izquierdo"/> : <div className="logo-placeholder" aria-hidden="true">▧</div>}
                <div className="logo-upload">
                  <b>Logo izquierdo</b><span>Se comprime en el navegador · máximo 5 MB</span>
                  <label className="btn ghost">{exam.header.logo ? "Cambiar logo" : "＋ Subir logo"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void uploadLogo(file, "logo"); }}/></label>
                </div>
                {exam.header.logo && <button className="remove-logo" onClick={() => updateHeader({ logo: "" })}>Quitar</button>}
              </div>
              <div className="logo-row">
                {exam.header.rightLogo ? <img className="logo-thumb" src={exam.header.rightLogo} alt="Logo institucional derecho"/> : <div className="logo-placeholder" aria-hidden="true">▧</div>}
                <div className="logo-upload">
                  <b>Logo derecho (opcional)</b><span>Útil para facultad, carrera o unidad académica</span>
                  <label className="btn ghost">{exam.header.rightLogo ? "Cambiar logo" : "＋ Subir logo"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void uploadLogo(file, "rightLogo"); }}/></label>
                </div>
                {exam.header.rightLogo && <button className="remove-logo" onClick={() => updateHeader({ rightLogo: "" })}>Quitar</button>}
              </div>
            </div>
            <label className="header-label">UNIVERSIDAD O ESTABLECIMIENTO
              <input value={exam.header.school} onChange={event => updateHeader({ school: event.target.value })} placeholder="Ej. Universidad de Santiago de Chile"/>
            </label>
            <label className="header-label">FACULTAD, DEPARTAMENTO O UNIDAD
              <input value={exam.header.subtitle} onChange={event => updateHeader({ subtitle: event.target.value })} placeholder="Ej. Facultad de Ciencia · Departamento de Matemática"/>
            </label>
            <div className="header-divider"/>
            <div className="eyebrow">DATOS DE LA EVALUACIÓN</div>
            <div className="header-data-grid">
              <label className="header-label">EVALUACIÓN
                <input value={exam.header.assessment} onChange={event => updateHeader({ assessment: event.target.value })} placeholder="PEP 1, Control 2, Examen"/>
              </label>
              <label className="header-label">CÓDIGO DEL RAMO
                <input value={exam.header.courseCode} onChange={event => updateHeader({ courseCode: event.target.value })} placeholder="10101 · M6"/>
              </label>
              <label className="header-label">SEMESTRE O PERÍODO
                <input value={exam.header.academicPeriod} onChange={event => updateHeader({ academicPeriod: event.target.value })} placeholder="Primer semestre 2026"/>
              </label>
              <label className="header-label">FECHA IMPRESA
                <input value={exam.header.date} onChange={event => updateHeader({ date: event.target.value })} placeholder="12 de noviembre de 2026"/>
              </label>
            </div>
            <label className="header-label">TÍTULO PRINCIPAL
              <input value={exam.header.title} onChange={event => updateHeader({ title: event.target.value })} placeholder={exam.title || "Usar el título de la prueba"}/>
              <small>Si lo dejas vacío, se imprime el título general de la prueba.</small>
            </label>
            <div className="header-divider"/>
            <div className="header-fields-head"><div><div className="eyebrow">ESPACIOS PARA COMPLETAR</div><span>Activa, renombra y ordena los campos de identificación y calificación.</span></div></div>
            <div className="header-fields">{exam.header.fields.map(field => <div className={field.enabled ? "header-field" : "header-field disabled"} key={field.id}>
              <input aria-label={`Mostrar ${field.label}`} type="checkbox" checked={field.enabled} onChange={event => updateHeaderField(field.id, { enabled: event.target.checked })}/>
              <input className="field-name" aria-label={`Nombre del campo ${field.label}`} value={field.label} onChange={event => updateHeaderField(field.id, { label: event.target.value })}/>
              <label className="field-setting">Fila
                <select aria-label={`Fila del campo ${field.label}`} value={field.row} onChange={event => updateHeaderField(field.id, { row: Number(event.target.value) as HeaderFieldRow })}>
                  <option value={1}>1</option><option value={2}>2</option>
                </select>
              </label>
              <label className="field-setting">Ancho (cm)
                <input type="number" min={1} max={18} step={0.5} aria-label={`Ancho para escribir en ${field.label} (cm)`} value={field.width} onChange={event => { const value = Number(event.target.value); updateHeaderField(field.id, { width: Number.isFinite(value) ? Math.max(1, Math.min(18, value)) : 1 }); }}/>
              </label>
              <button className="option-delete" title="Eliminar campo" aria-label="Eliminar campo" onClick={() => updateHeader({ fields: exam.header.fields.filter(item => item.id !== field.id) })}>×</button>
            </div>)}</div>
            <button className="add-option add-header-field" onClick={() => updateHeader({ fields: [...exam.header.fields, { id: uid(), label: "Nuevo campo", enabled: true, row: 2, width: 4.5 }] })}>＋ Añadir espacio</button>
            <div className="header-help">Por defecto, nombre, fecha y nota van en la primera fila; RUT, curso y puntaje en la segunda. Ajusta fila y ancho de escritura por campo.</div>
          </div>
          <div className="lower-actions"><button className="btn ghost" onClick={() => setTab("editor")}>← Volver al contenido</button></div>
        </section>
        <aside className="header-preview-column" aria-label="Vista previa del encabezado">
          <div className="header-preview-card">
            <div className="eyebrow">VISTA PREVIA EN VIVO</div>
            <div className={`header-live-preview ${exam.header.layout}`}>
              <div className="header-live-top">
                {exam.header.logo ? <img src={exam.header.logo} alt=""/> : <span className="header-live-logo-placeholder">LOGO</span>}
                {exam.header.layout === "institutional" ? <div className="header-live-institution"><b>{exam.header.school || "Universidad o establecimiento"}</b><span>{exam.header.subtitle || "Facultad · departamento · unidad"}</span></div> : <span className="header-live-logo-gap"/>}
                {exam.header.rightLogo ? <img src={exam.header.rightLogo} alt=""/> : <span className="header-live-logo-placeholder">LOGO</span>}
              </div>
              {exam.header.layout === "split" && <div className="header-live-split">
                <div><b>{exam.header.school || "Universidad o establecimiento"}</b><span>{exam.header.subtitle || "Facultad · departamento · unidad"}</span></div>
                <div><b>{[exam.subject, exam.header.courseCode].filter(Boolean).join(" · ") || "Asignatura · código"}</b><span>{[exam.grade, exam.header.academicPeriod, exam.header.date].filter(Boolean).join(" · ") || "Nivel · período · fecha"}</span></div>
              </div>}
              <div className="header-live-title">
                {(exam.header.assessment || "PEP / evaluación") && <b>{exam.header.assessment || "PEP / evaluación"}</b>}
                <strong>{exam.header.title || exam.title || "Título de la prueba"}</strong>
                {exam.header.layout === "institutional" && <span>{[exam.subject, exam.header.courseCode, exam.grade, exam.header.academicPeriod, exam.header.date].filter(Boolean).join(" · ") || "Asignatura · código · período · fecha"}</span>}
              </div>
              <div className="header-live-fields">{headerFieldRows(exam.header.fields.filter(field => field.enabled)).map((row, rowIndex) => <div className="header-live-field-row" key={rowIndex}>{row.map(field => <span style={{ flexGrow: field.width * 10 + field.label.length }} key={field.id}>{field.label}: <i aria-hidden="true"/></span>)}</div>)}</div>
            </div>
            <div className="header-preview-caption">{exam.header.repeatOnPages ? "El identificador compacto se repetirá en las páginas siguientes." : "El encabezado completo aparecerá en la primera página de cada forma."}</div>
          </div>
          <div className="header-export-note"><div><b>Revisa el PDF real</b><span>Comprueba saltos de página, densidad y campos antes de imprimir.</span></div><button className="btn primary" onClick={printPdf}>Vista previa PDF</button></div>
        </aside>
      </div>}
      {tab === "history" && <div className="content page-content"><div className="page-heading"><div><div className="eyebrow">TU BIBLIOTECA</div><h1>Mis pruebas</h1><p>Tus documentos se guardan como datos y se regeneran al exportar.</p></div><button className="btn primary" onClick={startNewExam}>＋ Nueva prueba</button></div>{!user ? <div className="empty-card">Inicia sesión para guardar y consultar tus pruebas.<button className="btn primary" onClick={() => setModal("auth")}>Iniciar sesión</button></div> : historyLoading ? <div className="empty-card" role="status">Cargando tu historial…</div> : historyError ? <div className="empty-card history-error" role="alert">{historyError}<button className="btn ghost" onClick={loadHistory}>Reintentar</button></div> : history.length ? <div className="history-grid">{history.map(item => <article className="history-card" key={item.id}><div className="doc-icon">▤</div><div className="history-info"><b>{item.title}</b><span>{new Date(item.updated_at).toLocaleDateString("es-CL")} · {item.data?.sections?.flatMap((s: Section) => s.questions).length || 0} preguntas</span></div><button onClick={() => restore(item)}>Abrir →</button></article>)}</div> : <div className="empty-card">Todavía no tienes pruebas guardadas. Crea una y pulsa Guardar.</div>}</div>}
      {tab === "bank" && <div className="content page-content"><div className="page-heading"><div><div className="eyebrow">COMUNIDAD DOCENTE</div><h1>Banco de preguntas</h1><p>Publica la prueba actual o añade preguntas de un banco directamente a esta prueba.</p></div><button className="btn primary" onClick={() => { setTab("editor"); shareBank(); }}>↗ Compartir selección</button></div><div className="bank-feature"><div className="bank-art">✳</div><div><div className="eyebrow">PRUEBA ACTUAL</div><h2>{exam.title}</h2><p>{questions.length} preguntas · {exam.subject || "Sin asignatura"}</p><button className="btn primary" onClick={shareBank}>Publicar como banco</button></div></div><section className="bank-library" aria-labelledby="bank-library-title"><div className="bank-library-heading"><div><div className="eyebrow">USAR DURANTE LA CREACIÓN</div><h2 id="bank-library-title">Añadir preguntas a la prueba</h2><p>Elige un banco publicado o pega un enlace. Sus preguntas se incorporan a la sección activa «{exam.sections[active]?.title || "Sección"}»; el resto de la prueba se conserva.</p></div><button className="btn ghost" onClick={() => setTab("editor")}>Volver al editor</button></div><form className="bank-link-form" onSubmit={submitBankLink}><label htmlFor="shared-bank-link">Enlace compartido o UUID del banco<input id="shared-bank-link" type="text" required value={bankLink} onChange={event => setBankLink(event.target.value)} placeholder="https://tu-dominio.cl/?banco=…"/></label><button className="btn primary" disabled={busy !== ""}>{busy === "bank" ? "Añadiendo…" : "Añadir por enlace"}</button></form>{!user ? <div className="empty-card bank-library-state">Inicia sesión para ver tus bancos publicados. Puedes añadir un enlace compartido arriba.<button className="btn ghost" onClick={() => setModal("auth")}>Iniciar sesión</button></div> : banksLoading ? <div className="empty-card bank-library-state" role="status">Cargando tus bancos publicados…</div> : banksError ? <div className="empty-card bank-library-state" role="alert">{banksError}<button className="btn ghost" onClick={() => void loadBanks()}>Reintentar</button></div> : banks.length ? <ul className="bank-list">{banks.map(bank => <li className="bank-list-item" key={bank.id}><div className="bank-list-info"><b>{bank.title}</b><span>Publicado el {new Date(bank.created_at).toLocaleDateString("es-CL")}</span></div><button className="btn ghost" disabled={busy !== ""} onClick={() => void importBankById(bank.id)}>{busy === "bank" ? "Añadiendo…" : "Añadir a esta prueba"}</button></li>)}</ul> : <div className="empty-card bank-library-state">Todavía no tienes bancos publicados. Comparte una prueba para poder reutilizarla aquí.</div>}</section></div>}
    </section>
    {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setModal(null); }}><div className={modal === "export" ? "modal export-modal" : "modal"} role="dialog" aria-modal="true" aria-label={modal === "auth" ? authMode === "register" ? "Crear cuenta" : "Iniciar sesión" : modal === "export" ? "Vista previa del PDF" : modal === "variants" ? "Configuración de formas" : "Enlace de banco compartido"} tabIndex={-1} ref={dialogRef}><button className="modal-close" aria-label="Cerrar diálogo" onClick={() => setModal(null)}>×</button>{modal === "auth" ? <><div className="brand-large">A<span>.</span></div><div className="eyebrow">BIENVENIDO A APOLLO</div><h2>{authMode === "register" ? "Tu próxima prueba empieza aquí." : "Qué bueno verte de nuevo."}</h2><p>Guarda tus pruebas y accede a ellas desde cualquier lugar.</p><form onSubmit={authSubmit}>{notice && <p className="form-error">{notice}</p>}{authMode === "register" && <label>Nombre<input required minLength={2} value={name} onChange={e => setName(e.target.value)} placeholder="Tu nombre"/></label>}<label>Correo electrónico<input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="profe@colegio.cl"/></label><label>Contraseña<input required minLength={10} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="10 caracteres o más"/></label><button className="btn primary full" disabled={authBusy}>{authBusy ? "Un momento…" : authMode === "register" ? "Crear cuenta" : "Iniciar sesión"}</button></form><button className="switch-auth" onClick={() => setAuthMode(authMode === "register" ? "login" : "register")}>{authMode === "register" ? "¿Ya tienes cuenta? Inicia sesión" : "¿Primera vez? Crea una cuenta"}</button></> : modal === "export" ? <><div className="export-title"><div className="eyebrow">EXPORTACIÓN</div><h2>Revisa el PDF</h2><p>Elige un estilo y comprueba el documento real antes de descargarlo.</p></div><><div className="pdf-style-options" role="radiogroup" aria-label="Estilo del documento">{[{ id: "compact", label: "Compacto", description: "Más contenido por página y encabezado reducido." }, { id: "balanced", label: "Equilibrado", description: "Espaciado intermedio para lectura cómoda." }, { id: "spacious", label: "Amplio", description: "Texto y espacios de respuesta más generosos." }].map(option => <button type="button" role="radio" aria-checked={pdfStyle === option.id} className={pdfStyle === option.id ? "pdf-style-option selected" : "pdf-style-option"} key={option.id} disabled={busy === "preview"} onClick={() => changePdfStyle(option.id as PdfStyle)}><b>{option.label}</b><span>{option.description}</span></button>)}</div><a className="btn ghost pdf-open-link" href={pdfPreviewUrl} target="_blank" rel="noreferrer">Abrir PDF en una pestaña nueva</a></><div className="pdf-preview-frame">{busy === "preview" ? <div className="pdf-preview-loading">Actualizando vista previa…</div> : pdfPreviewUrl ? <iframe title="Vista previa del PDF para imprimir" src={pdfPreviewUrl} /> : <div className="pdf-preview-loading">Preparando documento…</div>}</div><div className="export-modal-actions"><button className="btn ghost" onClick={() => setModal(null)}>Cerrar</button><button className="btn ghost" onClick={printAnswerKey} disabled={busy === "key" || !generation || generation.signature !== JSON.stringify(exam)}>{busy === "key" ? "Generando pauta…" : "Descargar pauta"}</button><button className="btn primary" onClick={downloadPreview} disabled={!pdfPreviewUrl || busy === "preview"}>Descargar PDF de estudiantes</button></div></> : modal === "variants" ? <><div className="eyebrow">CONFIGURACIÓN DE IMPRESIÓN</div><h2>Formas de la prueba</h2><p>Genera hasta 10 versiones. El orden de las preguntas y alternativas se mezcla por forma.</p><label className="variant-number">Cantidad de formas<input type="number" min="1" max="10" value={exam.variants} onChange={e => updateExam({ variants: Math.max(1, Math.min(10, Number(e.target.value))) })}/></label>{exam.variants > 1 && <div className="variant-note">Cada forma usa una selección y orden diferentes cuando hay preguntas disponibles.</div>}<button className="btn primary full" onClick={() => setModal(null)}>Listo</button></> : <><div className="eyebrow">BANCO COMPARTIDO</div><h2>Enlace listo para compartir</h2><p>Cualquier profesor con el enlace podrá importar una copia de estas preguntas.</p><div className="share-input">{shareUrl}<button onClick={() => { navigator.clipboard.writeText(shareUrl); setNotice("Enlace copiado."); }}>Copiar</button></div><button className="btn primary full" onClick={() => setModal(null)}>Listo</button></>}</div></div>}
    {user && <button className="signout" onClick={async () => { await supabase().auth.signOut(); setUser(null); setHistory([]); }}>↪ Cerrar sesión</button>}
  </main>;
}
