"use client";
/**
 * Headless quote funnel: all flow logic lives here once and every UI template consumes it.
 *
 * The client uses the same pure engine as the server (getVisibleQuestions / validateAnswer)
 * for instant feedback, but the server re-validates everything and alone computes the price.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVisibleQuestions, validateAnswer, type QuestionDef } from "@/core/questions";
import type { Answers } from "@/core/conditions";
import { api, ApiError } from "@/lib/api-client";
import type { PublicConfig, PublicQuote, PublicService } from "@/server/services/quote-flow";

export type FunnelStep =
  | { kind: "service" }
  | { kind: "question"; question: QuestionDef }
  | { kind: "result" }
  | { kind: "contact" }
  | { kind: "done" };

export interface ContactInput {
  name: string;
  company: string;
  email: string;
  phone: string;
  message: string;
  website: string; // honeypot
}

export interface FunnelState {
  config: PublicConfig;
  service: PublicService | null;
  answers: Answers;
  step: FunnelStep;
  /** 1-based position and total for "Step 3 of 7" (result/contact/done included). */
  progress: { index: number; total: number; percent: number; label: string };
  visibleQuestions: QuestionDef[];
  quote: PublicQuote | null;
  lead: { leadId: string; status: string; bookingUrl: string | null } | null;
  error: string | null;
  fieldError: string | null;
  contactErrors: Record<string, string>;
  busy: boolean;
  ready: boolean;
  canGoBack: boolean;
}

export interface FunnelActions {
  selectService(slug: string): Promise<void>;
  setAnswer(key: string, value: unknown): void;
  next(): Promise<void>;
  back(): void;
  goToContact(): void;
  submitContact(input: ContactInput): Promise<void>;
  restart(): void;
  ask(question: string): Promise<string>;
}

export type Funnel = FunnelState & FunnelActions;

interface StoredSession {
  sessionId: string;
  token: string;
}

const storageKey = (org: string) => `quoteos:session:${org}`;

function readAttribution() {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  return {
    source: p.get("utm_source"),
    medium: p.get("utm_medium"),
    campaign: p.get("utm_campaign"),
    content: p.get("utm_content"),
    term: p.get("utm_term"),
    referrer: document.referrer || null,
    landingPage: window.location.href.slice(0, 1000),
  };
}

function visitorId() {
  try {
    let id = localStorage.getItem("quoteos:visitor");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("quoteos:visitor", id);
    }
    return id;
  } catch {
    return null;
  }
}

export function useQuoteFunnel(config: PublicConfig, opts: { initialService?: string | null } = {}): Funnel {
  const org = config.organization.slug;
  const base = `/api/public/${org}`;
  const lockedService = opts.initialService && config.services.some((s) => s.slug === opts.initialService) ? opts.initialService : null;
  const singleService = config.services.length === 1 ? config.services[0].slug : null;

  const [serviceSlug, setServiceSlug] = useState<string | null>(lockedService ?? singleService);
  const [answers, setAnswers] = useState<Answers>({});
  const [phase, setPhase] = useState<"service" | "questions" | "result" | "contact" | "done">(lockedService || singleService ? "questions" : "service");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [lead, setLead] = useState<FunnelState["lead"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [contactErrors, setContactErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const session = useRef<StoredSession | null>(null);
  const attribution = useRef<ReturnType<typeof readAttribution>>({});
  const visitor = useRef<string | null>(null);

  const service = config.services.find((s) => s.slug === serviceSlug) ?? null;
  const visibleQuestions = useMemo(() => (service ? getVisibleQuestions(service.questions, answers) : []), [service, answers]);
  const showServiceStep = !lockedService && !singleService;

  // Mount: attribution, view event, resume a stored session.
  useEffect(() => {
    attribution.current = readAttribution();
    visitor.current = visitorId();
    api(`${base}/events`, {
      method: "POST",
      json: { type: "QUOTE_VIEWED", visitorId: visitor.current, serviceSlug: lockedService, attribution: attribution.current },
    }).catch(() => undefined);

    let stored: StoredSession | null = null;
    try {
      stored = JSON.parse(localStorage.getItem(storageKey(org)) ?? "null");
    } catch {
      stored = null;
    }
    if (!stored) {
      setReady(true);
      return;
    }
    api<{ serviceSlug: string | null; answers: Answers; currentStep: number; completed: boolean; quote: PublicQuote | null; leadSubmitted: boolean }>(
      `${base}/sessions/${stored.sessionId}`,
      { headers: { "x-quote-session-token": stored.token } },
    )
      .then((s) => {
        if (s.leadSubmitted || (lockedService && s.serviceSlug !== lockedService)) {
          localStorage.removeItem(storageKey(org));
          return;
        }
        session.current = stored;
        if (s.serviceSlug) setServiceSlug(s.serviceSlug);
        setAnswers(s.answers ?? {});
        if (s.completed && s.quote) {
          setQuote(s.quote);
          setPhase("result");
        } else if (s.serviceSlug) {
          setPhase("questions");
          setQuestionIndex(Math.max(0, s.currentStep - (showServiceStep ? 1 : 0)));
        }
      })
      .catch(() => localStorage.removeItem(storageKey(org)))
      .finally(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org]);

  const ensureSession = useCallback(
    async (slug: string) => {
      if (session.current) return session.current;
      const s = await api<{ sessionId: string; token: string }>(`${base}/sessions`, {
        method: "POST",
        json: { serviceSlug: slug, visitorId: visitor.current, attribution: attribution.current },
      });
      session.current = { sessionId: s.sessionId, token: s.token };
      try {
        localStorage.setItem(storageKey(org), JSON.stringify(session.current));
      } catch {
        /* storage unavailable - session still works for this page view */
      }
      return session.current;
    },
    [base, org],
  );

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      const s = session.current;
      if (!s) return;
      await api(`${base}/sessions/${s.sessionId}`, { method: "PATCH", headers: { "x-quote-session-token": s.token }, json: body });
    },
    [base],
  );

  const complete = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    const q = await api<PublicQuote>(`${base}/sessions/${s.sessionId}/complete`, { method: "POST", headers: { "x-quote-session-token": s.token } });
    setQuote(q);
    setPhase("result");
  }, [base]);

  const selectService = useCallback(
    async (slug: string) => {
      setError(null);
      setBusy(true);
      try {
        const s = await ensureSession(slug);
        if (s && slug !== serviceSlug) {
          await patch({ serviceSlug: slug, currentStep: 1 });
          setAnswers({});
        }
        setServiceSlug(slug);
        setQuestionIndex(0);
        setPhase("questions");
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [ensureSession, patch, serviceSlug],
  );

  const setAnswer = useCallback((key: string, value: unknown) => {
    setFieldError(null);
    setAnswers((a) => ({ ...a, [key]: value }));
  }, []);

  const currentQuestion = phase === "questions" ? visibleQuestions[Math.min(questionIndex, Math.max(visibleQuestions.length - 1, 0))] : undefined;

  const next = useCallback(async () => {
    setError(null);
    if (phase !== "questions" || !service) return;
    // Services without questions go straight to the result.
    if (!currentQuestion) {
      setBusy(true);
      try {
        await ensureSession(service.slug);
        await complete();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Something went wrong.");
      } finally {
        setBusy(false);
      }
      return;
    }
    const r = validateAnswer(currentQuestion, answers[currentQuestion.key]);
    if (!r.ok) {
      setFieldError(r.error);
      return;
    }
    setBusy(true);
    try {
      await ensureSession(service.slug);
      const stepNumber = (showServiceStep ? 1 : 0) + questionIndex + 1;
      await patch({ answers: { [currentQuestion.key]: r.value ?? null }, currentStep: stepNumber });
      const nextVisible = getVisibleQuestions(service.questions, { ...answers, [currentQuestion.key]: r.value });
      const pos = nextVisible.findIndex((q) => q.key === currentQuestion.key);
      if (pos === nextVisible.length - 1) await complete();
      else setQuestionIndex(pos + 1);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        await complete().catch(() => undefined);
      } else if (e instanceof ApiError && e.fields[currentQuestion.key]) {
        setFieldError(e.fields[currentQuestion.key]);
      } else if (e instanceof ApiError && e.status === 400 && e.fields) {
        // Server says another question still needs an answer: jump to it.
        const missing = visibleQuestions.findIndex((q) => e.fields[q.key]);
        if (missing >= 0) {
          setQuestionIndex(missing);
          setFieldError(e.fields[visibleQuestions[missing].key]);
        } else setError(e.message);
      } else {
        setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }, [phase, service, currentQuestion, answers, ensureSession, patch, complete, showServiceStep, questionIndex, visibleQuestions]);

  const back = useCallback(() => {
    setError(null);
    setFieldError(null);
    if (phase === "contact") setPhase("result");
    else if (phase === "questions" && questionIndex > 0) setQuestionIndex((i) => i - 1);
    else if (phase === "questions" && showServiceStep && !quote) setPhase("service");
  }, [phase, questionIndex, showServiceStep, quote]);

  const goToContact = useCallback(() => setPhase("contact"), []);

  const submitContact = useCallback(
    async (input: ContactInput) => {
      const s = session.current;
      if (!s) return;
      setBusy(true);
      setContactErrors({});
      setError(null);
      try {
        const r = await api<{ leadId: string; status: string; bookingUrl: string | null }>(`${base}/sessions/${s.sessionId}/lead`, {
          method: "POST",
          headers: { "x-quote-session-token": s.token },
          json: { ...input, company: input.company || null, phone: input.phone || null, message: input.message || null },
        });
        setLead(r);
        setPhase("done");
        try {
          localStorage.removeItem(storageKey(org));
        } catch {
          /* ignore */
        }
      } catch (e) {
        if (e instanceof ApiError && Array.isArray(e.details)) {
          setContactErrors(Object.fromEntries((e.details as { path: string; message: string }[]).map((d) => [d.path, d.message])));
        } else setError(e instanceof ApiError ? e.message : "We couldn't send your details. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [base, org],
  );

  const restart = useCallback(() => {
    try {
      localStorage.removeItem(storageKey(org));
    } catch {
      /* ignore */
    }
    session.current = null;
    setAnswers({});
    setQuote(null);
    setLead(null);
    setQuestionIndex(0);
    setServiceSlug(lockedService ?? singleService);
    setPhase(lockedService || singleService ? "questions" : "service");
  }, [org, lockedService, singleService]);

  const ask = useCallback(
    async (question: string) => {
      const r = await api<{ answer: string }>(`${base}/assistant`, {
        method: "POST",
        json: { question, serviceSlug: service?.slug ?? null, questionKey: currentQuestion?.key ?? null },
      });
      return r.answer;
    },
    [base, service, currentQuestion],
  );

  const step: FunnelStep =
    phase === "service" ? { kind: "service" }
    : phase === "questions" && currentQuestion ? { kind: "question", question: currentQuestion }
    : phase === "questions" ? { kind: "result" }
    : { kind: phase };

  const serviceSteps = showServiceStep ? 1 : 0;
  const total = serviceSteps + visibleQuestions.length + 2; // + result + contact
  const index =
    phase === "service" ? 1
    : phase === "questions" ? serviceSteps + Math.min(questionIndex, visibleQuestions.length - 1) + 1
    : phase === "result" ? total - 1
    : total;

  return {
    config,
    service,
    answers,
    step,
    progress: {
      index,
      total,
      percent: Math.round((Math.max(index - 1, 0) / Math.max(total - 1, 1)) * 100),
      // The total depends on the chosen service and answers, so it is not shown before a service is picked.
      label: phase === "service" ? "Step 1" : `Step ${index} of ${total}`,
    },
    visibleQuestions,
    quote,
    lead,
    error,
    fieldError,
    contactErrors,
    busy,
    ready,
    canGoBack: (phase === "questions" && (questionIndex > 0 || showServiceStep)) || phase === "contact",
    selectService,
    setAnswer,
    next,
    back,
    goToContact,
    submitContact,
    restart,
    ask,
  };
}
