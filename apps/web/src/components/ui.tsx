// ui.tsx
// Shared building blocks that are not form controls (those are in fields.tsx).
// Every interactive element has hover, pressed, focus and disabled states (the `press` class).

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link as RouterLink } from "react-router-dom";
import { useUndoLast, type PersonRef, type ProjectStatus, type ToastMessage } from "../api";
import { usePref } from "../spaces";

// ---------- labels ----------

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  idea: "Idea",
  active: "Active",
  waiting: "Waiting",
  paused: "Paused",
  done: "Done",
  archived: "Archived",
};
export const BOARD_STATUSES: ProjectStatus[] = ["idea", "active", "waiting", "paused", "done"];

export function actorLabel(actor: string): string {
  if (actor === "web") return "You";
  if (actor.startsWith("undo:")) return `${actorLabel(actor.slice(5))} (undo)`;
  if (actor.startsWith("mcp:")) {
    const n = actor.slice(4);
    return !n || n === "unknown" ? "AI" : n.charAt(0).toUpperCase() + n.slice(1);
  }
  if (actor.startsWith("script:")) return "Import";
  return actor;
}

// ---------- buttons ----------

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary: the one main action. tonal: the main action of a row. plain: raised. ghost: quiet text. */
  variant?: "primary" | "tonal" | "plain" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function Button({ variant = "plain", size = "md", className = "", ...rest }: BtnProps) {
  const base = "press inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[10px] font-medium select-none whitespace-nowrap";
  const sizes = size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-3.5 text-sm";
  const variants = {
    primary: "bg-accent text-on-accent hover:brightness-110 shadow-1",
    tonal: "bg-accent-soft text-accent hover:brightness-95",
    plain: "bg-surface text-fg shadow-1 hover:bg-raised",
    ghost: "text-muted hover:text-fg hover:bg-field",
    danger: "text-danger hover:bg-field",
  }[variant];
  return <button type="button" className={`${base} ${sizes} ${variants} ${className}`} {...rest} />;
}

/** A square button that holds only an icon. Always give it a label for screen readers. */
export function IconButton({ icon, label, size = 32, className = "", ...rest }: { icon: string; label: string; size?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`press inline-flex shrink-0 items-center justify-center rounded-[10px] text-muted hover:bg-field hover:text-fg ${className}`}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} />
    </button>
  );
}

// ---------- people ----------

const AVATAR_TONES = ["#7f93b8", "#8aa88f", "#b8956c", "#a28bb8", "#b88a8a", "#7ea8a8"];

export function Avatar({ person, size = 22 }: { person: { name: string; avatar_url?: string | null }; size?: number }) {
  const initials = person.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const tone = AVATAR_TONES[[...person.name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  if (person.avatar_url)
    return <img src={person.avatar_url} alt={person.name} title={person.name} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <span
      title={person.name}
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: tone, fontSize: Math.max(9, size * 0.4) }}
    >
      {initials}
    </span>
  );
}

export function AvatarStack({ people, max = 4 }: { people: PersonRef[]; max?: number }) {
  if (!people.length) return null;
  return (
    <span className="flex items-center -space-x-1.5">
      {people.slice(0, max).map((p) => (
        <span key={p.id} className="rounded-full ring-2 ring-[var(--surface)]">
          <Avatar person={p} size={20} />
        </span>
      ))}
      {people.length > max && <span className="pl-2.5 text-xs text-muted">+{people.length - max}</span>}
    </span>
  );
}

export function PersonChip({ person, onRemove }: { person: PersonRef; onRemove?: () => void }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-field pl-1 pr-2.5 text-[13px]">
      <RouterLink to={`/people/${person.id}`} className="press inline-flex items-center gap-1.5 hover:text-accent">
        <Avatar person={person} size={20} />
        {person.name}
      </RouterLink>
      {onRemove && (
        <button type="button" onClick={onRemove} className="press -mr-1 rounded-full px-1 text-faint hover:text-fg" aria-label={`Remove ${person.name}`}>
          <Icon name="x" size={12} />
        </button>
      )}
    </span>
  );
}

// ---------- surfaces and text ----------

export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-2xl bg-surface shadow-1 ${className}`} {...rest}>
      {children}
    </div>
  );
}

/**
 * A dashboard tile: a titled panel on the grid. `count` sits beside the title, `right` holds a
 * small action. With `icon` the title gets a colored badge (`tone` is a status color or
 * "accent"). With `to` the whole header is a link to the full page for that tile.
 */
export function Tile({
  title,
  count,
  right,
  children,
  className = "",
  pad = true,
  icon,
  tone = "accent",
  to,
}: {
  title?: ReactNode;
  count?: number | string | null;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
  icon?: string;
  tone?: string;
  to?: string;
}) {
  const heading = (
    <>
      {icon && (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg" style={{ color: `var(--${tone})`, background: `color-mix(in srgb, var(--${tone}) 14%, transparent)` }}>
          <Icon name={icon} size={14} />
        </span>
      )}
      <h2 className={icon ? "text-[15px] font-semibold tracking-tight" : "tile-title"}>{title}</h2>
      {count !== undefined && count !== null && count !== 0 && <span className="tabular rounded-full bg-field px-1.5 text-[12px] font-semibold text-muted">{count}</span>}
    </>
  );
  return (
    <section className={`tile flex flex-col ${className}`}>
      {title && (
        <header className="flex min-h-12 items-center gap-2 px-4 pt-1.5">
          {to ? (
            <RouterLink to={to} className="press group -ml-1.5 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-field">
              {heading}
              <Icon name="status_change" size={14} className="ml-auto text-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-fg" />
            </RouterLink>
          ) : (
            <>
              {heading}
              <div className="ml-auto flex items-center gap-1 text-[12px] text-faint">{right}</div>
            </>
          )}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${pad ? "px-2 pb-2" : ""}`}>{children}</div>
    </section>
  );
}

/** A small colored label. `tone` picks one of the status colors. */
export function Chip({ tone = "idle", children, title }: { tone?: "late" | "soon" | "ok" | "wait" | "idle" | "accent"; children: ReactNode; title?: string }) {
  return (
    <span className="chip" title={title} style={{ ["--chip" as string]: `var(--${tone})` }}>
      {children}
    </span>
  );
}

export function Empty({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`py-2 text-[13px] text-faint ${className}`}>{children}</p>;
}

export function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** Shown only if loading takes long enough to notice. */
export function Spinner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 250);
    return () => clearTimeout(t);
  }, []);
  return <div className="py-20 text-center text-[13px] text-faint">{show ? <span className="anim-fade">Loading…</span> : null}</div>;
}

export function ErrorNote({ error }: { error: unknown }) {
  return (
    <Card className="mx-auto max-w-xl p-5 text-sm">
      <p className="font-medium">This view could not load.</p>
      <p className="mt-1 text-muted">{error instanceof Error ? error.message : String(error ?? "")} Reload the page to try again.</p>
    </Card>
  );
}

/** A panel that arrives over the page. Used for search and for adding things. */
export function Panel({ children, onClose, label }: { children: ReactNode; onClose: () => void; label: string }) {
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center px-3 pt-[8vh] md:pt-[13vh]" role="dialog" aria-label={label}>
      <div className="anim-fade absolute inset-0 bg-black/25 dark:bg-black/55" onClick={onClose} />
      <div className="anim-panel relative w-full max-w-xl rounded-3xl bg-raised shadow-3">{children}</div>
    </div>
  );
}

// ---------- expand and collapse ----------

/**
 * A container that opens and closes. The height leads and the content fades in late
 * (see .collapse in styles.css). Children stay mounted so closing can animate.
 */
export function Collapse({ open, children, className = "" }: { open: boolean; children: ReactNode; className?: string }) {
  const [settled, setSettled] = useState(open);
  useEffect(() => {
    if (!open) setSettled(false);
  }, [open]);
  return (
    <div
      className={`collapse ${className}`}
      data-open={open}
      data-settled={settled}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === "grid-template-rows") setSettled(open);
      }}
    >
      <div className="collapse-inner" inert={!open}>
        {children}
      </div>
    </div>
  );
}

export function Chevron({ open, size = 12, className = "" }: { open: boolean; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`chevron shrink-0 ${className}`} data-open={open} aria-hidden>
      <path d="M4.5 2.5L8 6l-3.5 3.5" />
    </svg>
  );
}

/**
 * A titled part of a page that folds away. Whether it is open is remembered on this device
 * under `id`, so each section stays the way the owner left it.
 */
export function Section({
  id,
  title,
  count,
  right,
  defaultOpen = true,
  children,
  className = "",
  onOpenChange,
}: {
  id: string;
  title: ReactNode;
  count?: number | string | null;
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  /** Told whenever the section opens or closes (and once at first, with the remembered state). */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = usePref(`sec-${id}`, defaultOpen);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open]);
  return (
    <section className={className}>
      <div className="flex min-h-9 items-center gap-2">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="press -ml-2 flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-muted hover:bg-field hover:text-fg">
          <Chevron open={open} />
          {title}
          {count !== undefined && count !== null && count !== 0 && <span className="tabular font-normal text-faint">{count}</span>}
        </button>
        <div className={`ml-auto flex items-center gap-1 transition-opacity duration-150 ${open ? "" : "pointer-events-none opacity-0"}`}>{right}</div>
      </div>
      <Collapse open={open}>
        <div className="pb-1 pt-1.5">{children}</div>
      </Collapse>
    </section>
  );
}

/** A small action in a section header, for example "Add" or "Show 3 done". */
export function HeaderAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="press h-7 rounded-lg px-2 text-[12px] font-medium text-faint hover:bg-field hover:text-fg">
      {children}
    </button>
  );
}

// ---------- icons ----------

const PATHS: Record<string, string> = {
  desk: "M4 6.5h16M7 3v3M17 3v3M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zm4 9l2 2 4-4",
  projects: "M4 5h6v14H4zM14 5h6v8h-6z",
  people: "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 010 6.5M18 14.5c1.8.8 3 2.7 3 5",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  settings: "M4 7h10M18 7h2M4 17h2M10 17h10M14 7a2 2 0 104 0 2 2 0 00-4 0zM6 17a2 2 0 104 0 2 2 0 00-4 0z",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4",
  plus: "M12 5v14M5 12h14",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  x: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  board: "M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v6h-4z",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  note: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6",
  email: "M4 6h16v12H4zM4 7l8 6 8-6",
  meeting: "M5 5h14a1 1 0 011 1v13H4V6a1 1 0 011-1zM4 9h16M8 3v4M16 3v4",
  call: "M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z",
  decision: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z",
  status_change: "M4 12h13M13 7l5 5-5 5",
  task_done: "M5 12l4 4 10-10",
  file: "M6 3h9l4 4v14H6zM14 3v5h5",
  digest: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  doc: "M6 3h9l4 4v14H6zM9 12h6M9 16h6",
  sheet: "M4 4h16v16H4zM4 10h16M4 15h16M10 4v16",
  slides: "M3 5h18v11H3zM12 16v4M8 20h8",
  folder: "M3 6h6l2 2h10v11H3z",
  site: "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c2.5 2.5 3.5 6 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-6-3.5-9s1-6.5 3.5-9z",
  other: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  back: "M15 5l-7 7 7 7",
  external: "M14 4h6v6M20 4l-9 9M18 14v5H5V6h5",
  calendar: "M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zM4 10h16M8 3v4M16 3v4",
  reply: "M10 8L5 13l5 5M5 13h9a5 5 0 015 5v1",
  follow_up: "M4 12a8 8 0 0114-5.3L20 9M20 4v5h-5M20 12a8 8 0 01-14 5.3L4 15M4 20v-5h5",
  task: "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2",
  heads_up: "M12 4a5 5 0 00-5 5v3l-2 4h14l-2-4V9a5 5 0 00-5-5zM10 19a2 2 0 004 0",
  drag: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  sparkle: "M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6zM18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  copy: "M9 9h10v11H9zM5 15V4h10",
  sidebar: "M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zM9 5v14",
};

export function Icon({ name, size = 16, className = "" }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden>
      <path d={PATHS[name] ?? PATHS.other} />
    </svg>
  );
}

/** Round checkbox for tasks. The tick draws in when checked. */
export function Check({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`press flex size-[18px] shrink-0 items-center justify-center rounded-full transition-colors duration-200 ${
        checked ? "bg-accent text-on-accent" : "shadow-[inset_0_0_0_1.5px_var(--faint)] hover:shadow-[inset_0_0_0_1.5px_var(--accent)]"
      }`}
    >
      {checked && (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path className="check-path" d="M2.5 6.2l2.3 2.3 4.7-4.9" />
        </svg>
      )}
    </button>
  );
}

// ---------- toasts ----------

/** Short messages at the bottom of the screen. Listens for the toast() calls in api.ts. */
export function Toasts() {
  const [msg, setMsg] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const undo = useUndoLast();
  useEffect(() => {
    const on = (e: Event) => {
      const detail = (e as CustomEvent<ToastMessage | string>).detail;
      setMsg(typeof detail === "string" ? { text: detail, tone: "error" } : detail);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setMsg(null), 6000);
    };
    window.addEventListener("pd-toast", on);
    return () => window.removeEventListener("pd-toast", on);
  }, []);
  if (!msg) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex justify-center px-4 md:bottom-8" role="status">
      <div key={msg.text} className="anim-panel pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl bg-raised py-2.5 pl-4 pr-2.5 text-[13px] shadow-3">
        <span>
          {msg.tone === "error" && <span className="font-medium text-danger">Not saved. </span>}
          {msg.text}
        </span>
        {msg.undo ? (
          <Button
            size="sm"
            variant="tonal"
            onClick={() => {
              undo.mutate(undefined);
              setMsg(null);
            }}
          >
            Undo
          </Button>
        ) : (
          <span className="w-1.5" />
        )}
      </div>
    </div>
  );
}
