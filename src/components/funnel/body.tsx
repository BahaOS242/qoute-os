"use client";
/**
 * Shared step renderer. Templates supply a Skin (class names + copy tweaks) and their own
 * shell; the step structure and behavior are identical across templates.
 */
import { cn } from "@/lib/cn";
import { Assistant, Breakdown, ContactForm, CTA, priceParts, QuestionInput, type FunnelTheme } from "./parts";
import type { Funnel } from "./use-quote-funnel";

export interface Skin extends FunnelTheme {
  h2: string;
  lead: string;
  eyebrow: string;
  price: string;
  priceSuffix: string;
  sectionTitle: string;
  body: string;
  check: string;
  assumptionsBox: string;
  backLink: string;
  serviceGrid: string;
  serviceCard: string;
  serviceCardSelected: string;
  serviceTitle: string;
  serviceDesc: string;
  successIcon: string;
  breakdownRows: string;
}

export function FunnelBody({ f, skin }: { f: Funnel; skin: Skin }) {
  const org = f.config.organization;
  const price = priceParts(f);
  const step = f.step;

  if (!f.ready) return <p className={skin.muted}>Loading…</p>;

  if (step.kind === "service") {
    return (
      <>
        <h2 className={skin.h2}>What service do you need?</h2>
        <p className={cn("mt-2", skin.lead)}>Choose one to get started. It takes about two minutes.</p>
        <div className={cn("mt-6", skin.serviceGrid)}>
          {f.config.services.map((s) => (
            <button
              key={s.slug}
              type="button"
              disabled={f.busy}
              onClick={() => f.selectService(s.slug)}
              className={cn(skin.serviceCard, f.service?.slug === s.slug && skin.serviceCardSelected)}
            >
              <span className={cn("block", skin.serviceTitle)}>{s.name}</span>
              {s.description && <span className={cn("mt-1 block", skin.serviceDesc)}>{s.description}</span>}
            </button>
          ))}
        </div>
        {f.error && <p className={cn("mt-4 text-sm", skin.error)}>{f.error}</p>}
      </>
    );
  }

  if (step.kind === "question") {
    const q = step.question;
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void f.next();
        }}
      >
        <h2 className={skin.h2}>{q.label}</h2>
        {q.helpText && <p className={cn("mt-2", skin.lead)}>{q.helpText}</p>}
        <div className="mt-6">
          <QuestionInput question={q} value={f.answers[q.key]} onChange={(v) => f.setAnswer(q.key, v)} onSubmit={() => void f.next()} theme={skin} />
        </div>
        {!q.required && <p className={cn("mt-2 text-xs", skin.muted)}>Optional - you can skip this.</p>}
        {f.fieldError && <p className={cn("mt-3 text-sm", skin.error)} role="alert">{f.fieldError}</p>}
        {f.error && <p className={cn("mt-3 text-sm", skin.error)} role="alert">{f.error}</p>}
        <div className="mt-8 flex items-center justify-between gap-4">
          {f.canGoBack ? (
            <button type="button" onClick={f.back} className={skin.backLink}>
              ← Back
            </button>
          ) : (
            <span />
          )}
          <button type="submit" disabled={f.busy} className={skin.primaryButton}>
            {f.busy ? "Saving…" : "Continue"}
          </button>
        </div>
        <Assistant f={f} theme={skin} />
      </form>
    );
  }

  if (step.kind === "result" && f.quote) {
    if (price) {
      return (
        <div>
          <p className={skin.eyebrow}>Estimated investment</p>
          <p className={cn("mt-2", skin.price)}>
            {price.main}
            <span className={skin.priceSuffix}>{price.suffix}</span>
          </p>
          <p className={cn("mt-2", skin.lead)}>
            Based on the information you provided{price.isRange ? " - your exact fee is confirmed after a short review" : ""}.
          </p>
          <div className="mt-8 grid gap-8 sm:grid-cols-2">
            <div>
              <h3 className={skin.sectionTitle}>How we calculated it</h3>
              <Breakdown f={f} className={cn("mt-2", skin.body)} rowClass={skin.breakdownRows} mutedClass={skin.muted} />
            </div>
            {f.quote.inclusions.length > 0 && (
              <div>
                <h3 className={skin.sectionTitle}>What&apos;s included</h3>
                <ul className={cn("mt-2 space-y-1.5 text-sm", skin.body)}>
                  {f.quote.inclusions.map((i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden className={skin.check}>✓</span>
                      {i}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {f.quote.assumptions.length > 0 && (
            <div className={cn("mt-6", skin.assumptionsBox)}>
              <p className="font-semibold uppercase tracking-wide">Assumptions</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {f.quote.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-8 flex flex-wrap gap-3">
            <button type="button" onClick={f.goToContact} className={skin.primaryButton}>
              {CTA.priced}
            </button>
            <button type="button" onClick={f.goToContact} className={skin.secondaryButton}>
              {org.hasBooking ? CTA.book : CTA.contact}
            </button>
          </div>
        </div>
      );
    }
    const review = f.quote.kind === "REVIEW";
    return (
      <div>
        <h2 className={skin.h2}>{review ? "Your request requires a personalized review." : "Let's talk about your needs."}</h2>
        <p className={cn("mt-2", skin.lead)}>
          {review
            ? "An experienced advisor will review your answers and prepare a tailored proposal. Share your details and we'll be in touch within one business day."
            : "Leave your details and an advisor will reach out to discuss how we can help."}
        </p>
        <div className="mt-8">
          <ContactForm f={f} theme={skin} cta={review ? CTA.review : CTA.contact} />
        </div>
      </div>
    );
  }

  if (step.kind === "contact") {
    return (
      <div>
        <h2 className={skin.h2}>Where should we send your quote?</h2>
        <p className={cn("mt-2", skin.lead)}>
          {price ? (
            <>
              Your estimate: <strong>{price.main + price.suffix}</strong>. An advisor will confirm your exact quote.
            </>
          ) : (
            "An advisor will be in touch shortly."
          )}
        </p>
        <div className="mt-8">
          <ContactForm f={f} theme={skin} cta={CTA.priced} />
        </div>
        <button type="button" onClick={f.back} className={cn("mt-4", skin.backLink)}>
          ← Back to estimate
        </button>
      </div>
    );
  }

  if (step.kind === "done") {
    return (
      <div className="text-center">
        <div className={cn("mx-auto flex h-12 w-12 items-center justify-center rounded-full text-2xl", skin.successIcon)}>✓</div>
        <h2 className={cn("mt-4", skin.h2)}>Thank you - we&apos;ve got it.</h2>
        <p className={cn("mx-auto mt-2 max-w-md", skin.lead)}>
          {f.lead?.status === "NEEDS_REVIEW"
            ? "A senior advisor is reviewing your request and will contact you within one business day."
            : "We've emailed you a copy of your estimate. An advisor will confirm your exact quote shortly."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {f.lead?.bookingUrl && (
            <a href={f.lead.bookingUrl} className={skin.primaryButton}>
              {CTA.book}
            </a>
          )}
          <button type="button" onClick={f.restart} className={skin.secondaryButton}>
            Start another quote
          </button>
        </div>
      </div>
    );
  }

  return <p className={skin.muted}>Preparing your estimate…</p>;
}

export const stepKey = (f: Funnel) => `${f.step.kind}-${f.step.kind === "question" ? f.step.question.key : ""}`;
