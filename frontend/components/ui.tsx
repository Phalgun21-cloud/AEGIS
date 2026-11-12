"use client";

import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useState,
} from "react";

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost" | "warning";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:bg-cyan-500/40",
  secondary:
    "border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/10 disabled:text-slate-500 disabled:border-slate-700",
  danger: "bg-rose-500/90 text-white hover:bg-rose-500 disabled:bg-rose-500/40",
  warning: "bg-amber-500/90 text-slate-950 hover:bg-amber-400 disabled:bg-amber-500/40",
  ghost: "text-slate-300 hover:bg-white/5 hover:text-white",
};

export function Button({
  variant = "primary",
  className,
  busy,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed",
        VARIANTS[variant],
        className,
      )}
    >
      {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx("rounded-xl border border-cyan-500/15 bg-white/[0.03] p-5 shadow-sm", className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
          {label} {required && <span className="text-rose-400">*</span>}
        </span>
      </div>
      {children}
      {error ? (
        <span className="block text-xs text-rose-400">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 disabled:opacity-60";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative w-full">
      <input
        {...props}
        type={show ? "text" : "password"}
        className={cx(inputCls, "pr-10", props.className)}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-200 transition"
        title={show ? "Hide password" : "Show password"}
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? (
          // Eye off icon
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
            />
          </svg>
        ) : (
          // Eye icon
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
          </svg>
        )}
      </button>
    </div>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, "min-h-24", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, props.className)} />;
}

const BADGE: Record<string, string> = {
  draft: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  submitted: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  rejected: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  sealed: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  live: "bg-cyan-500/15 text-cyan-300 border-cyan-500/40",
  closed: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  easy: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  medium: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  hard: "bg-rose-500/10 text-rose-300 border-rose-500/20",
  admin: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  super_admin: "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30",
  exam_admin: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  author: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  reviewer: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  invigilator: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  candidate: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  mcq_single: "bg-cyan-500/10 text-cyan-200 border-cyan-500/20",
  mcq_multiple: "bg-indigo-500/10 text-indigo-200 border-indigo-500/20",
  true_false: "bg-teal-500/10 text-teal-200 border-teal-500/20",
  numerical: "bg-purple-500/10 text-purple-200 border-purple-500/20",
  short_answer: "bg-amber-500/10 text-amber-200 border-amber-500/20",
  long_answer: "bg-rose-500/10 text-rose-200 border-rose-500/20",
};

export function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
        BADGE[value] ?? BADGE.draft,
      )}
    >
      {label ?? value.replace(/_/g, " ")}
    </span>
  );
}

export function Alert({ kind = "error", children }: { kind?: "error" | "success" | "info" | "warning"; children: ReactNode }) {
  const styles = {
    error: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    info: "border-cyan-500/30 bg-cyan-500/10 text-cyan-100",
    warning: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cx("rounded-lg border px-4 py-3 text-sm", styles)}>
      {children}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums text-white">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: string }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="overflow-x-auto rounded-xl border border-cyan-500/15">
      <table className="w-full text-left text-sm">
        <thead className="bg-white/[0.04] text-xs uppercase tracking-wider text-slate-400">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {hasRows ? (
            children
          ) : (
            <tr>
              <td colSpan={head.length} className="px-4 py-8 text-center text-slate-500">
                {empty ?? "Nothing here yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx("px-4 py-3 align-top text-slate-200", className)}>{children}</td>;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-sm text-slate-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
      {label}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className={cx("w-full rounded-2xl border border-cyan-500/30 bg-[#071126] p-6 shadow-2xl transition", maxWidth)}>
        <div className="mb-4 flex items-center justify-between border-b border-cyan-500/10 pb-3">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (t: T) => void;
}) {
  return (
    <div className="mb-6 flex flex-wrap gap-1 border-b border-slate-800">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "-mb-px border-b-2 px-4 py-2 text-sm transition",
            value === t.id
              ? "border-cyan-400 text-cyan-200"
              : "border-transparent text-slate-400 hover:text-slate-200",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function ValidatedInput({
  minLength,
  maxLength,
  value = "",
  onChange,
  className,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  minLength?: number;
  maxLength?: number;
  error?: string | null;
}) {
  const currentLen = typeof value === "string" ? value.length : String(value ?? "").length;
  const isTooShort = minLength ? currentLen > 0 && currentLen < minLength : false;
  const isNearLimit = maxLength ? currentLen >= maxLength * 0.9 : false;

  return (
    <div className="space-y-1">
      <Input
        {...props}
        value={value}
        onChange={onChange}
        maxLength={maxLength}
        className={cx(
          error ? "border-rose-500 focus:border-rose-400 focus:ring-rose-500/20" : "",
          className
        )}
      />
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>
          {minLength ? `Min: ${minLength} chars` : ""}
          {minLength && maxLength ? " · " : ""}
          {maxLength ? `Max: ${maxLength} chars` : ""}
        </span>
        <span
          className={cx(
            "font-mono",
            isTooShort
              ? "text-amber-400"
              : isNearLimit
              ? "text-rose-400"
              : "text-slate-400"
          )}
        >
          {currentLen}{maxLength ? ` / ${maxLength}` : ""}
        </span>
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}

export function ValidatedTextarea({
  minLength,
  maxLength,
  value = "",
  onChange,
  className,
  error,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  minLength?: number;
  maxLength?: number;
  error?: string | null;
}) {
  const currentLen = typeof value === "string" ? value.length : String(value ?? "").length;
  const isTooShort = minLength ? currentLen > 0 && currentLen < minLength : false;
  const isNearLimit = maxLength ? currentLen >= maxLength * 0.9 : false;

  return (
    <div className="space-y-1">
      <Textarea
        {...props}
        value={value}
        onChange={onChange}
        maxLength={maxLength}
        className={cx(
          error ? "border-rose-500 focus:border-rose-400 focus:ring-rose-500/20" : "",
          className
        )}
      />
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>
          {minLength ? `Min: ${minLength} chars` : ""}
          {minLength && maxLength ? " · " : ""}
          {maxLength ? `Max: ${maxLength} chars` : ""}
        </span>
        <span
          className={cx(
            "font-mono",
            isTooShort
              ? "text-amber-400"
              : isNearLimit
              ? "text-rose-400"
              : "text-slate-400"
          )}
        >
          {currentLen}{maxLength ? ` / ${maxLength}` : ""}
        </span>
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}

export { cx };
