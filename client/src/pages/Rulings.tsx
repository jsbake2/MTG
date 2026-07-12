import { useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";

interface Issue {
  id: string;
  title: string;
  blurb: string;
  count: number;
  examples: { name: string; img: string }[];
  candidates: string[];
  recommended: number | null;
  kind: "mechanic" | "clause";
}
interface Answer { issue_id?: string; chosen: number | null; custom_text: string | null; best: boolean; details: string | null }
type Draft = { chosen: number | null; customText: string; best: boolean; details: string };

const emptyDraft: Draft = { chosen: null, customText: "", best: false, details: "" };

export function Rulings() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [answers, setAnswers] = useState<Record<string, Draft>>({});
  const [showAnswered, setShowAnswered] = useState(false);
  const [i, setI] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/rulings-issues.json").then((r) => r.json()),
      api.get<{ answers: Answer[] }>("/api/rulings/answers").catch(() => ({ answers: [] })),
    ]).then(([data, saved]) => {
      setIssues(data.issues);
      const map: Record<string, Draft> = {};
      for (const a of saved.answers) {
        if (!a.issue_id) continue;
        map[a.issue_id] = { chosen: a.chosen, customText: a.custom_text ?? "", best: a.best, details: a.details ?? "" };
      }
      setAnswers(map);
      setLoaded(true);
    });
  }, []);

  const answeredCount = Object.keys(answers).length;
  // Answered issues drop out of the queue (unless you toggle them back on).
  const queue = useMemo(
    () => issues.filter((iss) => showAnswered || !answers[iss.id]),
    [issues, answers, showAnswered],
  );
  const idx = Math.min(i, Math.max(0, queue.length - 1));
  const issue = queue[idx];

  useEffect(() => {
    if (issue) setDraft(answers[issue.id] ?? emptyDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.id]);

  async function save() {
    if (!issue) return;
    setSaving(true);
    try {
      await api.post("/api/rulings/answers", {
        issueId: issue.id,
        chosen: draft.chosen,
        customText: draft.customText || null,
        best: draft.best,
        details: draft.details || null,
      });
      const savedIssueId = issue.id;
      setAnswers((m) => ({ ...m, [savedIssueId]: draft }));
      // When hiding answered, saving removes this issue and the next slides into
      // place at the same index. When reviewing answered, advance manually.
      if (showAnswered && idx < queue.length - 1) setI(idx + 1);
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <div className="flex h-full items-center justify-center text-table-muted">Loading rulings…</div>;

  if (!issue) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <div className="text-2xl">🎉</div>
        <h1 className="mt-2 font-display text-xl text-table-accentSoft">All {issues.length} issues answered</h1>
        <p className="mt-1 text-sm text-table-muted">Thanks — I’ll build these into the guided engine.</p>
        <button className="btn-ghost mt-4" onClick={() => { setShowAnswered(true); setI(0); }}>Review my answers</button>
      </div>
    );
  }

  const canSave = draft.chosen !== null || draft.customText.trim().length > 0;
  const remaining = issues.length - answeredCount;

  return (
    <div className="mx-auto max-w-3xl px-4 py-5">
      {/* Header + progress */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="font-display text-xl text-table-accentSoft">Guided-rules review</h1>
          <div className="flex items-center gap-3 text-sm text-table-muted">
            <span>{answeredCount} answered · <b className="text-table-ink">{remaining} left</b></span>
            <button
              className={`chip !py-0.5 text-xs ${showAnswered ? "border-table-accent text-table-accentSoft" : ""}`}
              onClick={() => { setShowAnswered((s) => !s); setI(0); }}
            >
              {showAnswered ? "Hide answered" : `Show answered (${answeredCount})`}
            </button>
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded bg-table-panel2">
          <div className="h-full bg-table-accent transition-all" style={{ width: `${(answeredCount / Math.max(1, issues.length)) * 100}%` }} />
        </div>
        <p className="mt-2 text-xs text-table-muted">
          Pick the ruling that matches how you want the game to play this, or write your own. Answered issues drop off automatically.
        </p>
      </div>

      <div className="panel p-4">
        <div className="mb-1 flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${issue.kind === "mechanic" ? "bg-table-accent text-black" : "bg-table-panel2 text-table-muted"}`}>
            {issue.kind === "mechanic" ? "Mechanic" : "Clause"}
          </span>
          <span className="text-xs text-table-muted">{issue.count} card{issue.count === 1 ? "" : "s"}</span>
          {answers[issue.id] && <span className="text-xs text-emerald-400">already answered</span>}
        </div>
        <h2 className="font-display text-lg text-table-ink">{issue.title}</h2>
        {issue.blurb && <p className="mt-0.5 text-sm text-table-muted">{issue.blurb}</p>}

        {/* Example cards */}
        {issue.examples.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-3">
            {issue.examples.map((e) => (
              <img key={e.name + e.img} src={e.img} alt={e.name} title={e.name} loading="lazy" className="h-80 rounded-lg border border-table-border" />
            ))}
          </div>
        )}

        {/* Candidate rulings */}
        <div className="mt-4 space-y-2">
          {issue.candidates.map((c, ci) => (
            <label
              key={ci}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${draft.chosen === ci ? "border-table-accent bg-table-accent/10" : "border-table-border hover:bg-table-panel2"}`}
            >
              <input type="radio" name="cand" className="mt-1" checked={draft.chosen === ci} onChange={() => setDraft({ ...draft, chosen: ci, customText: "" })} />
              <span className="text-table-ink">
                {c}
                {issue.recommended === ci && <span className="ml-2 rounded bg-table-accent/30 px-1.5 py-0.5 text-[10px] font-semibold text-table-accentSoft">my best guess</span>}
              </span>
            </label>
          ))}
          {issue.candidates.length === 0 && (
            <div className="rounded-lg border border-dashed border-table-border p-3 text-sm text-table-muted">
              I don’t have a confident guess for this one — please describe how it should work below.
            </div>
          )}

          {/* Custom / none-of-these */}
          <label className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 ${draft.chosen === null && draft.customText ? "border-table-accent bg-table-accent/10" : "border-table-border"}`}>
            <div className="flex items-center gap-2 text-sm font-semibold text-table-ink">
              <input type="radio" name="cand" checked={draft.chosen === null} onChange={() => setDraft({ ...draft, chosen: null })} />
              None of these — write the correct rule
            </div>
            <textarea
              className="input min-h-[70px] w-full text-sm"
              placeholder="How should the guided engine handle this?"
              value={draft.customText}
              onChange={(e) => setDraft({ ...draft, chosen: null, customText: e.target.value })}
            />
          </label>
        </div>

        {/* Best + details */}
        <div className="mt-3 rounded-lg border border-table-border p-3">
          <label className="flex items-center gap-2 text-sm text-table-ink">
            <input type="checkbox" checked={draft.best} onChange={(e) => setDraft({ ...draft, best: e.target.checked })} />
            Mark my selection as the definitive best answer
          </label>
          <textarea
            className="input mt-2 min-h-[52px] w-full text-sm"
            placeholder="Extra details / edge cases you want applied (optional)"
            value={draft.details}
            onChange={(e) => setDraft({ ...draft, details: e.target.value })}
          />
        </div>

        {/* Nav */}
        <div className="mt-4 flex items-center gap-2">
          <button className="btn-ghost" disabled={idx === 0} onClick={() => setI(idx - 1)}>← Back</button>
          <button className="btn-ghost" disabled={idx >= queue.length - 1} onClick={() => setI(idx + 1)}>Skip →</button>
          <div className="ml-auto flex items-center gap-2">
            {answers[issue.id] && <span className="text-xs text-emerald-400">saved ✓</span>}
            <button className="btn-primary" disabled={!canSave || saving} onClick={save}>
              {saving ? "Saving…" : "Save & next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
