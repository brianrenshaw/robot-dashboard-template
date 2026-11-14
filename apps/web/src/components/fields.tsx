// fields.tsx
// Every form control in the app. They all share the .field look from styles.css: one height,
// one radius, one fill, one focus ring. If a screen needs an input, a menu, a date or a person,
// it comes from here. Do not hand-style a control on a page.
//
//   TextInput, TextArea     typing
//   Editable                text on the page that turns into an input when clicked
//   Picker                  choose one from a menu (status, priority, area, kind)
//   PersonPicker            choose one person (or no one)
//   PeoplePicker            choose several people; can add a new person on the spot
//   ProjectPicker           choose a project
//   DatePicker              choose a day, with shortcuts
//   Segmented               switch between a few views
//   Field                   a label above any of the above

import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { api, useAllPeople, useAllProjects, useWrite, type Person, type PersonRef } from "../api";
import { addDaysYmd, fmtDay, fmtWeekday, todayYmd, weekdayOf } from "../lib/time";
import { Sigil, useScope } from "../spaces";
import { Popover } from "./Popover";
import { Avatar, Icon, Markdown } from "./ui";

// ---------- label ----------

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

// ---------- typing ----------

export function TextInput({ className = "", onEnter, ...rest }: InputHTMLAttributes<HTMLInputElement> & { onEnter?: () => void }) {
  return (
    <input
      className={`field ${className}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" && onEnter) {
          e.preventDefault();
          onEnter();
        }
        rest.onKeyDown?.(e);
      }}
      {...withoutKey(rest)}
    />
  );
}

function withoutKey<T extends { onKeyDown?: unknown }>(props: T): Omit<T, "onKeyDown"> {
  const { onKeyDown: _k, ...rest } = props;
  return rest;
}

function autoGrow(el: HTMLTextAreaElement, max = 520) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
}

/** A text area that grows with what is typed. Cmd+Enter (or Ctrl+Enter) calls onSubmit. */
export function TextArea({ className = "", onSubmit, minRows = 2, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { onSubmit?: () => void; minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (ref.current) autoGrow(ref.current);
  }, [rest.value]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      className={`field ${className}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) {
          e.preventDefault();
          onSubmit();
        }
      }}
      {...rest}
    />
  );
}

/**
 * Text that becomes an input when clicked. Enter saves (Cmd+Enter when multiline), Escape
 * cancels, clicking away saves. The text does not move when it switches to editing.
 */
export function Editable({
  value,
  onSave,
  placeholder = "Add…",
  multiline = false,
  markdown = false,
  className = "",
  label,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  markdown?: boolean;
  className?: string;
  label?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  useEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    autoGrow(el, 640);
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = multiline ? draft.replace(/\s+$/, "") : draft.trim();
    if (next !== value) onSave(next);
  };
  const box = "-mx-2 block w-[calc(100%+16px)] rounded-[10px] px-2 py-1";

  if (!editing) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={label ? `Edit ${label}` : undefined}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) return;
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            setEditing(true);
          }
        }}
        className={`${box} cursor-text transition-colors duration-75 hover:bg-field ${className}`}
      >
        {value ? markdown ? <Markdown>{value}</Markdown> : <span className="whitespace-pre-wrap">{value}</span> : <span className="text-faint">{placeholder}</span>}
      </div>
    );
  }
  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      onBlur={commit}
      onChange={(e) => {
        setDraft(multiline ? e.target.value : e.target.value.replace(/\n/g, " "));
        autoGrow(e.target, 640);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setDraft(value);
          setEditing(false);
        } else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
        }
      }}
      className={`${box} resize-none bg-surface shadow-[0_0_0_2px_var(--accent-ring)] outline-none placeholder:text-faint ${className}`}
    />
  );
}

// ---------- menus ----------

export interface Option<T> {
  value: T;
  label: string;
  /** Small text on the right of the row. */
  hint?: string;
  icon?: ReactNode;
}

/** The list inside a menu: arrow keys move, Enter chooses, typing filters when searchable. */
function MenuList<T>({
  options,
  value,
  onPick,
  searchable,
  searchPlaceholder = "Find…",
  footer,
  empty = "No matches.",
}: {
  options: Option<T>[];
  value?: T;
  onPick: (v: T) => void;
  searchable: boolean;
  searchPlaceholder?: string;
  footer?: (query: string) => ReactNode;
  empty?: string;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(n)) : options;
  }, [options, q]);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    (searchable ? search.current : root.current)?.focus({ preventScroll: true });
  }, [searchable]);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = shown[active];
      if (o) onPick(o.value);
    }
  };

  return (
    <div ref={root} tabIndex={-1} onKeyDown={onKey} className="outline-none" role="listbox">
      {searchable && (
        <input
          ref={search}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          placeholder={searchPlaceholder}
          className="field mb-1.5"
        />
      )}
      {shown.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="option"
            aria-selected={selected}
            data-index={i}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(o.value)}
            className={`press flex min-h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left text-sm max-sm:min-h-11 ${i === active ? "bg-field" : ""}`}
          >
            {o.icon}
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {o.hint && <span className="shrink-0 truncate text-[12px] text-faint">{o.hint}</span>}
            {selected && <Icon name="check" size={14} className="text-accent" />}
          </button>
        );
      })}
      {!shown.length && !footer && <p className="px-2.5 py-3 text-[13px] text-faint">{empty}</p>}
      {footer?.(q)}
    </div>
  );
}

function Caret() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="ml-auto shrink-0 text-faint" aria-hidden>
      <path d="M2 3.5L5 6.5l3-3" />
    </svg>
  );
}

/**
 * Choose one value from a menu. `variant="pill"` is the compact form for headers and rows;
 * `variant="field"` fills the width of a form.
 */
export function Picker<T extends string | number>({
  value,
  options,
  onChange,
  label,
  variant = "field",
  placeholder = "Choose…",
  searchable,
  align = "start",
  className = "",
  prefix,
}: {
  value: T | null;
  options: Option<T>[];
  onChange: (v: T) => void;
  label: string;
  variant?: "field" | "pill";
  placeholder?: string;
  searchable?: boolean;
  align?: "start" | "end";
  className?: string;
  /** Quiet text before the value, for example "Due". */
  prefix?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);
  const close = () => {
    setOpen(false);
    anchor.current?.focus({ preventScroll: true });
  };
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-open={open}
        onClick={() => setOpen(!open)}
        className={`field press gap-2 text-left ${variant === "pill" ? "field-pill" : ""} ${className}`}
      >
        {current?.icon}
        {prefix && <span className="text-faint">{prefix}</span>}
        <span className={`min-w-0 truncate ${current ? "" : "text-faint"}`}>{current?.label ?? placeholder}</span>
        <Caret />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} align={align} width={variant === "pill" ? 240 : "anchor"} label={label}>
        <MenuList
          options={options}
          value={value ?? undefined}
          searchable={searchable ?? options.length > 8}
          onPick={(v) => {
            onChange(v);
            close();
          }}
        />
      </Popover>
    </>
  );
}

// ---------- people ----------

function toRef(p: { id: string; name: string; slug: string; avatar_url: string | null }): PersonRef {
  return { id: p.id, name: p.name, slug: p.slug, avatar_url: p.avatar_url };
}

/** Choose one person, or no one. `noneLabel` is what "no one" is called here ("Me", "No one in particular"). */
export function PersonPicker({
  value,
  onChange,
  label,
  noneLabel = "No one",
  variant = "field",
  prefix,
  align,
  className,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  label: string;
  noneLabel?: string;
  variant?: "field" | "pill";
  prefix?: string;
  align?: "start" | "end";
  className?: string;
}) {
  const { data: people = [] } = useAllPeople();
  const options: Option<string>[] = [
    { value: "", label: noneLabel },
    ...people.map((p) => ({ value: p.id, label: p.name, hint: p.role || p.organization || undefined, icon: <Avatar person={p} size={20} /> })),
  ];
  return <Picker label={label} value={value ?? ""} onChange={(v) => onChange(v || null)} options={options} variant={variant} searchable prefix={prefix} align={align} className={className} />;
}

/** Choose several people. Type to filter; a name that is not in the list can be added on the spot. */
export function PeoplePicker({
  value,
  onChange,
  placeholder = "Add people",
  exclude = [],
  single = false,
}: {
  value: PersonRef[];
  onChange: (v: PersonRef[]) => void;
  placeholder?: string;
  exclude?: string[];
  /** Pick one and close, without keeping chips (used to link a person to a project). */
  single?: boolean;
}) {
  const { data: people = [] } = useAllPeople();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const shell = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const create = useWrite((name: string) => api.post<Person>("/api/people", { name }));
  const taken = new Set([...value.map((p) => p.id), ...exclude]);
  const n = q.trim().toLowerCase();
  const matches = people.filter((p) => !taken.has(p.id) && (!n || p.name.toLowerCase().includes(n))).slice(0, 8);
  const canCreate = n.length > 1 && !people.some((p) => p.name.toLowerCase() === n);
  const rows = matches.length + (canCreate ? 1 : 0);

  const pick = (p: PersonRef) => {
    onChange(single ? [p] : [...value, p]);
    setQ("");
    setActive(0);
    // Close after each pick so the list never covers the buttons below. Typing opens it again.
    setOpen(false);
  };
  const choose = (i: number) => {
    const m = matches[i];
    if (m) pick(toRef(m));
    else if (canCreate) create.mutate(q.trim(), { onSuccess: (p) => pick(toRef(p)) });
  };

  return (
    <>
      <div ref={shell} data-open={open} className="field flex-wrap gap-1 py-1 pl-1.5" onClick={() => input.current?.focus()}>
        {value.map((p) => (
          <span key={p.id} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-surface pl-1 pr-1.5 text-[13px] shadow-1">
            <Avatar person={p} size={18} />
            {p.name}
            <button type="button" className="press rounded-full p-0.5 text-faint hover:text-fg" onClick={() => onChange(value.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.name}`}>
              <Icon name="x" size={11} />
            </button>
          </span>
        ))}
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, rows - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && open && rows > 0) {
              e.preventDefault();
              choose(active);
            } else if (e.key === "Backspace" && !q && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          placeholder={value.length ? "" : placeholder}
          aria-label={placeholder}
          className="h-7 min-w-24 flex-1 bg-transparent px-1.5 outline-none placeholder:text-faint"
        />
      </div>
      <Popover anchor={shell} open={open && rows > 0} onClose={() => setOpen(false)} width="anchor" label={placeholder} float>
        {matches.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => choose(i)}
            className={`press flex min-h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left text-sm max-sm:min-h-11 ${i === active ? "bg-field" : ""}`}
          >
            <Avatar person={p} size={20} />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="truncate text-[12px] text-faint">{p.role}</span>
          </button>
        ))}
        {canCreate && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(matches.length)}
            onClick={() => choose(matches.length)}
            className={`press flex min-h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left text-sm max-sm:min-h-11 ${active === matches.length ? "bg-field" : ""}`}
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-field text-muted">
              <Icon name="plus" size={12} />
            </span>
            Add “{q.trim()}” as a new person
          </button>
        )}
      </Popover>
    </>
  );
}

// ---------- projects ----------

/** Choose a project. Projects on the desk you are at are listed first. */
export function ProjectPicker({
  value,
  onChange,
  label = "Project",
  noneLabel = "No project",
  allowNone = true,
  variant = "field",
  placeholder = "Choose a project",
  align,
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  noneLabel?: string;
  allowNone?: boolean;
  variant?: "field" | "pill";
  placeholder?: string;
  align?: "start" | "end";
}) {
  const { data = [] } = useAllProjects();
  const { scope } = useScope();
  const options = useMemo(() => {
    const open = data.filter((p) => p.status !== "done");
    const sorted = [...open.filter((p) => p.area === scope), ...open.filter((p) => p.area !== scope)];
    const list: Option<string>[] = sorted.map((p) => ({ value: p.id, label: p.title, icon: <Sigil scope={p.area} /> }));
    return allowNone ? [{ value: "", label: noneLabel }, ...list] : list;
  }, [data, scope, allowNone, noneLabel]);
  return <Picker label={label} value={value || (allowNone ? "" : null)} onChange={onChange} options={options} variant={variant} placeholder={placeholder} searchable align={align} />;
}

// ---------- dates ----------

/** Choose a day. Shortcuts for the common answers, a calendar for the rest. */
export function DatePicker({
  value,
  onChange,
  label,
  variant = "field",
  placeholder = "No date",
  prefix,
  tone,
  align,
  allowClear = true,
  futureOnly = false,
  icon = "calendar",
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
  variant?: "field" | "pill";
  placeholder?: string;
  prefix?: string;
  /** Leave "Today" out of the shortcuts (for snoozing). */
  futureOnly?: boolean;
  icon?: string;
  /** "late" tints the date in the warning color. */
  tone?: "late" | null;
  align?: "start" | "end";
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const today = todayYmd();
  const toMonday = (8 - weekdayOf(today)) % 7 || 7;
  const toFriday = (5 - weekdayOf(today) + 7) % 7;
  const shortcuts: Option<string>[] = [
    ...(futureOnly ? [] : [{ value: today, label: "Today", hint: fmtDay(today) }]),
    { value: addDaysYmd(today, 1), label: "Tomorrow", hint: fmtWeekday(addDaysYmd(today, 1)).slice(0, 3) },
    ...(toFriday > 1 ? [{ value: addDaysYmd(today, toFriday), label: "This Friday", hint: fmtDay(addDaysYmd(today, toFriday)) }] : []),
    { value: addDaysYmd(today, toMonday), label: "Next Monday", hint: fmtDay(addDaysYmd(today, toMonday)) },
    { value: addDaysYmd(today, 14), label: "In two weeks", hint: fmtDay(addDaysYmd(today, 14)) },
  ];
  const set = (v: string | null) => {
    onChange(v);
    setOpen(false);
    anchor.current?.focus({ preventScroll: true });
  };
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-open={open}
        onClick={() => setOpen(!open)}
        className={`field press gap-2 text-left ${variant === "pill" ? "field-pill" : ""}`}
      >
        <Icon name={icon} size={14} className="text-faint" />
        {prefix && <span className="text-faint">{prefix}</span>}
        <span className={`truncate ${value ? (tone === "late" ? "text-danger" : "") : "text-faint"}`}>{value ? fmtDay(value) : placeholder}</span>
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} align={align} width={248} label={label}>
        <MenuList options={shortcuts} value={value ?? undefined} searchable={false} onPick={set} />
        <div className="mt-1.5 flex items-center gap-1.5 px-1 pb-1 pt-1.5 shadow-[inset_0_1px_0_var(--line)]">
          <input type="date" aria-label="Pick a date" min={futureOnly ? addDaysYmd(today, 1) : undefined} value={value ?? ""} onChange={(e) => e.target.value && set(e.target.value)} className="field min-w-0 flex-1" />
          {allowClear && value && (
            <button type="button" onClick={() => set(null)} className="press h-9 rounded-[10px] px-2.5 text-[13px] font-medium text-muted hover:bg-field hover:text-fg">
              Clear
            </button>
          )}
        </div>
      </Popover>
    </>
  );
}

// ---------- switching views ----------

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className = "",
}: {
  value: T;
  options: { value: T; label: string; icon?: string }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`inline-flex rounded-[10px] bg-field p-0.5 ${className}`} role="tablist" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={`press flex h-8 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium ${on ? "bg-surface text-fg shadow-1" : "text-muted hover:text-fg"}`}
          >
            {o.icon && <Icon name={o.icon} size={14} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
