import { useState, useMemo, type ChangeEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Recipient } from "@email-sender/shared";
import { createCampaignSchema } from "@email-sender/shared";
import Papa from "papaparse";
import type { ParseResult } from "papaparse";
import { useForm } from "react-hook-form";
import {
  createCampaign,
  listCampaigns,
  getCampaign,
  cancelCampaign,
  type CampaignSummary,
} from "./api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Tab = "compose" | "history";

type CampaignFormValues = {
  title: string;
  subject: string;
  htmlBody: string;
  mode: "send_now" | "schedule";
  scheduledAt: string;
};

const starterHtml = `<p>Hello {{name}},</p><p>I wanted to share an update with <strong>{{company}}</strong>.</p><p>Best,<br />Team</p>`;

const CANCELLABLE = new Set(["scheduled", "queued", "sending"]);

function statusInfo(status: string): { label: string; cls: string } {
  switch (status) {
    case "completed":       return { label: "Completed",       cls: "badge--green"  };
    case "sending":         return { label: "Sending",         cls: "badge--orange" };
    case "queued":          return { label: "Queued",          cls: "badge--yellow" };
    case "scheduled":       return { label: "Scheduled",       cls: "badge--blue"   };
    case "failed":          return { label: "Failed",          cls: "badge--red"    };
    case "cancel_requested":return { label: "Cancelling…",    cls: "badge--red"    };
    case "cancelled":       return { label: "Cancelled",       cls: "badge--gray"   };
    default:                return { label: status,            cls: "badge--gray"   };
  }
}

function toRecipient(email: string, mergeData: Record<string, string>): Recipient {
  return { email: email.trim(), mergeData };
}

function parsePastedRecipients(input: string): Recipient[] {
  return input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [email, ...rest] = line.split(",").map((p) => p.trim());
      const mergeData = Object.fromEntries(
        rest.map((v, i) => [`field_${i + 1}`, v]),
      );
      return toRecipient(email ?? "", mergeData);
    });
}

function parseCsv(file: File): Promise<Recipient[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: ParseResult<Record<string, string>>) => {
        const rows = results.data
          .map((row) => {
            const norm = Object.fromEntries(
              Object.entries(row).map(([k, v]) => [k.trim(), String(v ?? "").trim()]),
            );
            const email = norm.email ?? norm.Email ?? norm.EMAIL ?? "";
            if (!email) return null;
            const mergeData = Object.fromEntries(
              Object.entries(norm).filter(([k]) => k.toLowerCase() !== "email"),
            );
            return toRecipient(email, mergeData);
          })
          .filter((r): r is Recipient => r !== null);
        resolve(rows);
      },
      error: (err: Error) => reject(err),
    });
  });
}

// ─── ComposeView ──────────────────────────────────────────────────────────────

function ComposeView({ onSuccess }: { onSuccess: () => void }) {
  const { register, handleSubmit, watch, reset, formState } =
    useForm<CampaignFormValues>({
      defaultValues: {
        title: "Spring rollout",
        subject: "Product update for {{company}}",
        htmlBody: starterHtml,
        mode: "send_now",
        scheduledAt: "",
      },
    });

  const [pastedText, setPastedText] = useState(
    "jane@example.com,Jane Doe,Acme\nmark@example.com,Mark,Northwind",
  );
  const [recipients, setRecipients] = useState<Recipient[]>(
    parsePastedRecipients("jane@example.com,Jane Doe,Acme\nmark@example.com,Mark,Northwind"),
  );
  const [uploadName, setUploadName] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const mode = watch("mode");
  const htmlBody = watch("htmlBody");

  const mergeTags = useMemo(() => {
    const tags = new Set<string>();
    recipients.forEach((r) => Object.keys(r.mergeData).forEach((k) => tags.add(`{{${k}}}`)));
    return [...tags].sort();
  }, [recipients]);

  const onCsvUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const parsed = await parseCsv(file);
    setRecipients(parsed);
    setUploadName(file.name);
  };

  const onSubmit = handleSubmit(async (values) => {
    setFeedback(null);
    const parsed = createCampaignSchema.safeParse({
      ...values,
      scheduledAt: values.scheduledAt ? new Date(values.scheduledAt).toISOString() : null,
      recipients,
    });
    if (!parsed.success) {
      setFeedback({
        ok: false,
        msg: parsed.error.issues.map((i) => i.message).join(" · "),
      });
      return;
    }
    try {
      const { id } = await createCampaign(parsed.data);
      setFeedback({ ok: true, msg: `Campaign created (id: ${id})` });
      reset();
      onSuccess();
    } catch (err: unknown) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  return (
    <main className="grid">
      <section className="panel panel-large">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Milestone 1 + 2</p>
            <h2>Composer</h2>
          </div>
          <span className="status-pill">{recipients.length} recipients</span>
        </div>

        <form className="composer-form" onSubmit={onSubmit}>
          <label>
            Campaign name
            <input {...register("title", { required: true })} placeholder="Quarterly launch" />
          </label>
          <label>
            Subject line
            <input {...register("subject", { required: true })} placeholder="Hello {{name}}" />
          </label>
          <label>
            HTML body
            <textarea {...register("htmlBody", { required: true })} rows={10} />
          </label>

          <div className="row two-up">
            <label>
              Send mode
              <select {...register("mode")}>
                <option value="send_now">Send immediately</option>
                <option value="schedule">Schedule for later</option>
              </select>
            </label>
            <label>
              Scheduled time
              <input
                {...register("scheduledAt")}
                type="datetime-local"
                disabled={mode !== "schedule"}
              />
            </label>
          </div>

          {feedback && (
            <p className={`form-feedback ${feedback.ok ? "form-feedback--ok" : "form-feedback--err"}`}>
              {feedback.msg}
            </p>
          )}

          <div className="form-actions">
            <button type="submit" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? "Sending…" : mode === "schedule" ? "Schedule campaign" : "Send campaign"}
            </button>
            {mergeTags.length > 0 && (
              <span className="merge-hint">
                Tags: {mergeTags.join(" ")}
              </span>
            )}
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Recipients</p>
            <h2>{recipients.length} loaded</h2>
          </div>
        </div>

        <label>
          Paste one per line (email,field1,field2)
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            onBlur={() => { setRecipients(parsePastedRecipients(pastedText)); setUploadName(""); }}
            rows={7}
          />
        </label>

        <label className="upload-field">
          Upload CSV
          <input type="file" accept=".csv,text/csv" onChange={onCsvUpload} />
        </label>
        <p className="muted">{uploadName ? `Loaded from ${uploadName}` : "CSV column headers become merge tags automatically."}</p>

        <div className="recipient-preview">
          {recipients.slice(0, 4).map((r) => (
            <article key={r.email}>
              <strong>{r.email}</strong>
              <pre>{JSON.stringify(r.mergeData, null, 2)}</pre>
            </article>
          ))}
        </div>
      </section>

      <section className="panel panel-large">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Preview</p>
            <h2>HTML render</h2>
          </div>
          <span className="status-pill status-pill-muted">Live</span>
        </div>
        <iframe
          className="html-preview"
          srcDoc={htmlBody}
          sandbox="allow-same-origin"
          title="Email preview"
        />
      </section>
    </main>
  );
}

// ─── DetailPanel ──────────────────────────────────────────────────────────────

function DetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["campaign", id],
    queryFn: () => getCampaign(id),
  });

  return (
    <div className="detail-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="detail-panel">
        <div className="panel-header">
          <h2>{isLoading ? "Loading…" : (data?.campaign.title ?? "Campaign detail")}</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        {error && <p className="form-feedback form-feedback--err">{(error as Error).message}</p>}

        {data && (
          <>
            <div className="detail-meta">
              <span>Subject: <em>{data.campaign.subject}</em></span>
              <span>
                Status:&nbsp;
                <span className={`badge ${statusInfo(data.campaign.status).cls}`}>
                  {statusInfo(data.campaign.status).label}
                </span>
              </span>
              <span>
                {data.campaign.mode === "schedule" && data.campaign.scheduled_at
                  ? `Scheduled: ${new Date(data.campaign.scheduled_at).toLocaleString()}`
                  : `Created: ${new Date(data.campaign.created_at).toLocaleString()}`}
              </span>
            </div>

            <table className="recipients-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Sent at</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {data.recipients.map((r) => {
                  const s = statusInfo(r.status);
                  return (
                    <tr key={r.id}>
                      <td>{r.email}</td>
                      <td><span className={`badge ${s.cls}`}>{s.label}</span></td>
                      <td>{r.attempt_count}</td>
                      <td>{r.sent_at ? new Date(r.sent_at).toLocaleTimeString() : "—"}</td>
                      <td className="error-cell">{r.last_error ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

// ─── HistoryView ──────────────────────────────────────────────────────────────

function HistoryView() {
  const queryClient = useQueryClient();
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data: campaigns = [], isLoading, error } = useQuery({
    queryKey: ["campaigns"],
    queryFn: listCampaigns,
    refetchInterval: 10_000,
  });

  const cancelMutation = useMutation({
    mutationFn: cancelCampaign,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });

  const upcoming = campaigns.filter((c) => ["scheduled", "queued"].includes(c.status));
  const past = campaigns.filter((c) => !["scheduled", "queued"].includes(c.status));

  function CampaignRow({ c }: { c: CampaignSummary }) {
    const { label, cls } = statusInfo(c.status);
    return (
      <tr className="campaign-row" onClick={() => setDetailId(c.id)}>
        <td>{c.title}</td>
        <td><span className={`badge ${cls}`}>{label}</span></td>
        <td>{c.recipient_count} / {c.sent_count} / {c.failed_count}</td>
        <td>
          {c.mode === "schedule" && c.scheduled_at
            ? new Date(c.scheduled_at).toLocaleString()
            : new Date(c.created_at).toLocaleDateString()}
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          {CANCELLABLE.has(c.status) && (
            <button
              className="cancel-btn"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate(c.id)}
            >
              Cancel
            </button>
          )}
        </td>
      </tr>
    );
  }

  return (
    <main className="history-shell">
      {error && (
        <p className="form-feedback form-feedback--err">
          {(error as Error).message}
        </p>
      )}

      {isLoading && <p className="muted">Loading campaigns…</p>}

      {upcoming.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <div><p className="panel-kicker">Milestone 3</p><h2>Upcoming</h2></div>
            <span className="status-pill">{upcoming.length}</span>
          </div>
          <table className="campaign-table">
            <thead><tr><th>Title</th><th>Status</th><th>Total / Sent / Failed</th><th>When</th><th /></tr></thead>
            <tbody>{upcoming.map((c) => <CampaignRow key={c.id} c={c} />)}</tbody>
          </table>
        </section>
      )}

      <section className="panel">
        <div className="panel-header">
          <div><p className="panel-kicker">Milestone 4</p><h2>All campaigns</h2></div>
          <span className="status-pill">{campaigns.length}</span>
        </div>
        {campaigns.length === 0 && !isLoading ? (
          <p className="muted">No campaigns yet. Compose one!</p>
        ) : (
          <table className="campaign-table">
            <thead><tr><th>Title</th><th>Status</th><th>Total / Sent / Failed</th><th>When</th><th /></tr></thead>
            <tbody>{past.map((c) => <CampaignRow key={c.id} c={c} />)}</tbody>
          </table>
        )}
      </section>

      {detailId && <DetailPanel id={detailId} onClose={() => setDetailId(null)} />}
    </main>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState<Tab>("compose");
  const queryClient = useQueryClient();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <p className="eyebrow">Email automation</p>
          <h1>Campaign dashboard</h1>
        </div>
        <nav className="tab-nav">
          <button
            className={`tab-btn ${tab === "compose" ? "tab-btn--active" : ""}`}
            onClick={() => setTab("compose")}
          >
            Compose
          </button>
          <button
            className={`tab-btn ${tab === "history" ? "tab-btn--active" : ""}`}
            onClick={() => setTab("history")}
          >
            History
          </button>
        </nav>
      </header>

      {tab === "compose" ? (
        <ComposeView
          onSuccess={() => {
            void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
            setTab("history");
          }}
        />
      ) : (
        <HistoryView />
      )}
    </div>
  );
}
