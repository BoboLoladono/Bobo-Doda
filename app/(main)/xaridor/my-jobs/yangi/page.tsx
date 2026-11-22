"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FileUpload } from "@/components/ui/FileUpload";
import { Input } from "@/components/ui/Input";
import { Stepper } from "@/components/ui/Stepper";
import { TagInput } from "@/components/ui/TagInput";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { CATEGORIES } from "@/lib/category-fields";
import { getSelectableCategories } from "@/lib/categories";
import { jobsService } from "@/lib/api";
import type { ServiceCategory } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { checkCircumvention, reportCircumventionViolation } from "@/lib/chat-filter";
import { MIN_JOB_BUDGET } from "@/lib/validate";
import { trackJobCreated } from "@/lib/analytics";

const MAX_QUESTIONS = 3;

export default function YangiElonPage() {
  const { t, lang } = useT();
  const router = useRouter();
  const { toast } = useToast();

  /* Admin o'chirgan kategoriyada yangi ish yaratib bo'lmaydi. Ro'yxat mount'dan
     KEYIN toraytiriladi: server render'ida `localStorage` yo'q, shuning uchun
     darhol filtrlansa hidratsiya mos kelmasdi. */
  const [selectableCategories, setSelectableCategories] =
    useState<ServiceCategory[]>(CATEGORIES);
  useEffect(() => setSelectableCategories(getSelectableCategories()), []);

  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<ServiceCategory | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [deadline, setDeadline] = useState("");
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [publishing, setPublishing] = useState(false);
  const draftValue = useMemo(
    () => ({
      step,
      category,
      title,
      description,
      skills,
      questions,
      budgetMin,
      budgetMax,
      deadline,
      // Katta base64 fayllar sessionStorage kvotasini to'ldirmasligi uchun faqat yengil ma'lumotlar saqlanadi
      attachedImages: attachedImages.filter((img) => !img.startsWith("data:") || img.length < 50000),
    }),
    [step, category, title, description, skills, questions, budgetMin, budgetMax, deadline, attachedImages]
  );
  const clearDraft = useFormDraft(
    "draft:buyer:new-job",
    draftValue,
    (draft) => {
      setStep(draft.step);
      setCategory(draft.category);
      setTitle(draft.title);
      setDescription(draft.description);
      setSkills(draft.skills);
      setQuestions(draft.questions);
      setBudgetMin(draft.budgetMin);
      setBudgetMax(draft.budgetMax);
      setDeadline(draft.deadline ?? "");
      setAttachedImages(draft.attachedImages ?? []);
    },
    Boolean(category || title || description || skills.length || questions.length || budgetMin || budgetMax)
  );

  const steps = [
    t("wizard.step1"),
    t("wizard.step2"),
    t("jwiz.step3"),
    t("jwiz.step4"),
    t("wizard.step5"),
  ];

  function validateStep(current: number): boolean {
    const next: Record<string, string> = {};
    if (current === 0 && !category) next.category = t("wizard.errCategory");
    if (current === 1) {
      if (title.trim().length < 10) {
        next.title = t("wizard.errTitle");
      } else {
        const checkTitle = checkCircumvention(title);
        if (checkTitle.hasViolation) {
          next.title = lang === "ru"
            ? "В названии запрещено указывать контакты (телефон, Telegram). Используйте безопасный Escrow."
            : "Sarlavhada shaxsiy kontaktlar (telefon, Telegram) ko'rsatish taqiqlanadi. Escrow kafolatidan foydalaning.";
          reportCircumventionViolation({
            targetType: "job",
            targetTitle: title,
            matchedText: checkTitle.matchedText,
            violationType: checkTitle.type,
            fullContent: title,
          });
        }
      }

      if (description.trim().length < 30) {
        next.description = t("wizard.errDesc");
      } else {
        const checkDesc = checkCircumvention(description);
        if (checkDesc.hasViolation) {
          next.description = lang === "ru"
            ? "В описании проекта запрещено указывать прямые контакты (Telegram, телефон, почту). Все обсуждения ведутся на платформе."
            : "Loyiha tavsifida to'g'ridan-to'g'ri kontaktlar (Telegram, telefon, email) ko'rsatish taqiqlanadi. Barcha muloqot platformada olib borilishi shart.";
          reportCircumventionViolation({
            targetType: "job",
            targetTitle: title,
            matchedText: checkDesc.matchedText,
            violationType: checkDesc.type,
            fullContent: description,
          });
        }
      }
    }
    if (current === 2 && skills.length === 0)
      next.skills = t("onboard.errSkills");
    if (current === 3) {
      const min = Number(budgetMin);
      const max = Number(budgetMax);
      if (!min || Number.isNaN(min) || min < MIN_JOB_BUDGET) {
        next.budget = t("jwiz.errBudgetMin");
      } else if (!max || Number.isNaN(max) || max < min) {
        next.budget = t("jwiz.errBudget");
      }
      if (deadline) {
        const parts = deadline.split("-").map(Number);
        if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
          const selectedDate = new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999);
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          if (Number.isNaN(selectedDate.getTime()) || selectedDate.getTime() < todayStart.getTime()) {
            next.deadline = t("jwiz.errDeadline");
          }
        } else {
          next.deadline = t("jwiz.errDeadline");
        }
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goNext() {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(s + 1, steps.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  function setQuestion(i: number, value: string) {
    setQuestions((prev) => prev.map((q, idx) => (idx === i ? value : q)));
  }

  async function handlePublish() {
    if (!category) return;
    setPublishing(true);
    try {
      const job = await jobsService.create({
        title: title.trim(),
        description: description.trim(),
        category,
        budgetMin: Number(budgetMin),
        budgetMax: Number(budgetMax),
        skillsRequired: skills,
        screeningQuestions: questions.map((q) => q.trim()).filter(Boolean),
        deadline: deadline || undefined,
        attachedImages,
      });
      trackJobCreated({
        category,
        budgetMin: Number(budgetMin),
        budgetMax: Number(budgetMax),
        title: title.trim(),
      });
      clearDraft();
      toast(t("jwiz.published"));
      router.push(`/xaridor/my-jobs/${job.id}`);
    } catch {
      toast(t("common.error"), "error");
      setPublishing(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-28 sm:pb-32">
      <div className="flex items-center justify-between">
        <BackButton href="/xaridor/my-jobs" label={t("nav.myJobs")} />
      </div>

      <h1 className="font-heading text-2xl font-extrabold text-ink">
        {t("jwiz.title")}
      </h1>

      <Stepper steps={steps} current={step} />

      <Card padding="lg">
        {/* 1-qadam: kategoriya */}
        {step === 0 && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">{t("jwiz.categoryHint")}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {selectableCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setCategory(cat);
                    setErrors((prev) => ({ ...prev, category: "" }));
                  }}
                  aria-pressed={category === cat}
                  className={`rounded-card border p-4 text-center text-sm transition-colors duration-150 ${
                    category === cat
                      ? "border-primary bg-primary/10 font-medium text-ink"
                      : "border-field bg-card text-muted hover:border-primary hover:bg-card-hover hover:text-ink"
                  }`}
                >
                  {t(`cat.${cat}`)}
                </button>
              ))}
            </div>
            {errors.category && (
              <p className="text-2xs text-danger" role="alert">
                {errors.category}
              </p>
            )}
          </div>
        )}

        {/* 2-qadam: sarlavha va tavsif */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <Input
              label={t("wizard.titleLabel")}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errors.title) setErrors((prev) => ({ ...prev, title: "" }));
              }}
              placeholder={t("jwiz.titlePh")}
              error={errors.title}
            />
            <Textarea
              label={t("wizard.descLabel")}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                if (errors.description) setErrors((prev) => ({ ...prev, description: "" }));
              }}
              placeholder={t("jwiz.descPh")}
              rows={7}
              error={errors.description}
            />
            <FileUpload
              label={t("jwiz.attachmentsLabel")}
              value={attachedImages}
              onChange={setAttachedImages}
              max={5}
              acceptDocs
            />
            <p className="-mt-3 text-2xs text-faint">{t("jwiz.attachmentsHint")}</p>
          </div>
        )}

        {/* 3-qadam: ko'nikmalar va skrining savollari */}
        {step === 2 && (
          <div className="flex flex-col gap-5">
            <TagInput
              label={t("onboard.skills")}
              value={skills}
              onChange={(newSkills) => {
                setSkills(newSkills);
                if (errors.skills) setErrors((prev) => ({ ...prev, skills: "" }));
              }}
              placeholder={t("onboard.skillsPh")}
              error={errors.skills}
            />
            <p className="-mt-3 text-2xs text-faint">{t("jwiz.skillsHint")}</p>

            <div className="flex flex-col gap-3">
              <div>
                <p className="text-xs font-medium text-muted">
                  {t("jwiz.screening")}
                </p>
                <p className="mt-1 text-2xs text-faint">
                  {t("jwiz.screeningHint")}
                </p>
              </div>
              {questions.map((q, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="flex-1">
                    <Input
                      value={q}
                      onChange={(e) => setQuestion(i, e.target.value)}
                      placeholder={t("jwiz.questionPh")}
                      aria-label={`${i + 1}. ${t("jwiz.screening")}`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setQuestions((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    aria-label={t("common.delete")}
                    className="mt-2.5 text-faint transition-colors duration-150 hover:text-danger"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ))}
              {questions.length < MAX_QUESTIONS && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  onClick={() => setQuestions((prev) => [...prev, ""])}
                >
                  + {t("jwiz.addQuestion")}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* 4-qadam: byudjet */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                type="number"
                min={MIN_JOB_BUDGET}
                label={t("jwiz.budgetMin")}
                value={budgetMin}
                onChange={(e) => {
                  setBudgetMin(e.target.value);
                  if (errors.budget) setErrors((prev) => ({ ...prev, budget: "" }));
                }}
                placeholder="1000"
                hint={`Kamida ${formatMoney(MIN_JOB_BUDGET, lang)}`}
              />
              <Input
                type="number"
                min={MIN_JOB_BUDGET}
                label={t("jwiz.budgetMax")}
                value={budgetMax}
                onChange={(e) => {
                  setBudgetMax(e.target.value);
                  if (errors.budget) setErrors((prev) => ({ ...prev, budget: "" }));
                }}
                placeholder="3000000"
              />
            </div>
            {errors.budget && (
              <p className="text-2xs text-danger" role="alert">
                {errors.budget}
              </p>
            )}
            <p className="text-2xs text-faint">{t("jwiz.budgetHint")}</p>
            <Input
              type="date"
              label={t("jwiz.deadlineLabel")}
              value={deadline}
              onChange={(e) => {
                setDeadline(e.target.value);
                if (errors.deadline) setErrors((prev) => ({ ...prev, deadline: "" }));
              }}
              hint={t("jwiz.deadlineHint")}
              error={errors.deadline}
            />
            <p className="rounded-input border border-accent/25 bg-accent/5 p-3 text-2xs text-muted">
              {t("jwiz.escrowHint")}
            </p>
          </div>
        )}

        {/* 5-qadam: ko'rib chiqish */}
        {step === 4 && category && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">{t("jwiz.reviewHint")}</p>
            <dl className="flex flex-col divide-y divide-line">
              <ReviewRow label={t("wizard.step1")} value={t(`cat.${category}`)} />
              <ReviewRow label={t("wizard.titleLabel")} value={title} />
              <ReviewRow label={t("wizard.descLabel")} value={description} />
              <ReviewRow label={t("onboard.skills")} value={skills.join(", ")} />
              {questions.filter((q) => q.trim()).length > 0 && (
                <ReviewRow
                  label={t("job.screening")}
                  value={questions.filter((q) => q.trim()).join(" · ")}
                />
              )}
              <ReviewRow
                label={t("job.budget")}
                value={`${formatMoney(Number(budgetMin) || 0, lang)} – ${formatMoney(Number(budgetMax) || 0, lang)}`}
              />
              {deadline && (
                <ReviewRow
                  label={t("jwiz.deadlineLabel")}
                  value={formatDate(new Date(deadline).toISOString(), lang)}
                />
              )}
            </dl>
            {attachedImages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachedImages.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={src}
                    alt={t("a11y.image").replace("{n}", String(i + 1))}
                    className="h-16 w-16 rounded-input border border-line object-cover"
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Boshqaruv tugmalari */}
      <div className="relative z-10 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {step > 0 && (
            <Button variant="ghost" onClick={goBack} disabled={publishing}>
              {t("common.back")}
            </Button>
          )}
        </div>
        {step < steps.length - 1 ? (
          <Button onClick={goNext}>{t("common.next")}</Button>
        ) : (
          <Button onClick={handlePublish} loading={publishing}>
            {t("jwiz.publish")}
          </Button>
        )}
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-xs text-faint">{label}</dt>
      <dd className="text-sm text-ink">{value || "—"}</dd>
    </div>
  );
}
