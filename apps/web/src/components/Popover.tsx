// Popover.tsx
// A small floating panel attached to the control that opened it. Every menu in the app
// (status, person, project, date, "more") uses this, so they all open, close and feel the same.
//
// On a computer it floats next to its control, flipping above when there is no room below.
// On a phone it slides up from the bottom as a sheet, which is easier to reach with a thumb.
// It is drawn at the top of the page (a portal), so it is never clipped by a card or a list.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./ui";

const narrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;

export function Popover({
  anchor,
  open,
  onClose,
  children,
  align = "start",
  width = 240,
  label,
  float = false,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "start" | "end";
  /** Width on a computer. "anchor" matches the control's own width. */
  width?: number | "anchor";
  label: string;
  /** Always float next to the control, even on a phone (for menus you type into). */
  float?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const isPhone = () => !float && narrow();
  const [phone, setPhone] = useState(isPhone);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current;
      setPhone(isPhone());
      if (!a || isPhone()) return;
      const r = a.getBoundingClientRect();
      const w = width === "anchor" ? Math.max(r.width, 200) : width;
      const h = panel.current?.offsetHeight ?? 0;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const left = Math.max(8, Math.min(align === "end" ? r.right - w : r.left, vw - w - 8));
      const below = vh - r.bottom - 14;
      const above = r.top - 14;
      const up = h > below && above > below;
      setStyle(up ? { left, width: w, bottom: vh - r.top + 6, maxHeight: above } : { left, width: w, top: r.bottom + 6, maxHeight: below });
    };
    place();
    const raf = requestAnimationFrame(place); // again once the panel has a height
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, align, width, float]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // close only this menu, not the panel it sits in
      onClose();
      anchor.current?.focus();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return createPortal(
    phone ? (
      <div className="fixed inset-0 z-[60] flex items-end" role="dialog" aria-label={label}>
        <div className="anim-fade absolute inset-0 bg-black/30" />
        <div ref={panel} className="anim-sheet pb-safe relative flex max-h-[75dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-raised shadow-3">
          <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-[var(--line)]" />
          <p className="px-5 pb-1 pt-3 text-[13px] font-semibold text-muted">{label}</p>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
        </div>
      </div>
    ) : (
      <div ref={panel} role="dialog" aria-label={label} style={style} className="anim-pop fixed z-[60] flex flex-col overflow-hidden rounded-2xl bg-raised shadow-2">
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">{children}</div>
      </div>
    ),
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: string;
  onClick?: () => void;
  /** A link instead of an action. */
  href?: string;
  danger?: boolean;
}

/** The "..." button: the less common actions for a row, kept out of sight until asked for. */
export function MoreMenu({ items, label = "More actions" }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const row = "press flex min-h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-sm hover:bg-field max-sm:min-h-11";
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="press flex size-8 shrink-0 items-center justify-center rounded-[10px] text-muted hover:bg-field hover:text-fg"
      >
        <Icon name="more" size={16} />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} align="end" width={200} label={label}>
        {items.map((it) =>
          it.href ? (
            <a key={it.label} href={it.href} {...(it.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})} onClick={() => setOpen(false)} className={row}>
              {it.icon && <Icon name={it.icon} size={15} className="text-muted" />}
              {it.label}
            </a>
          ) : (
            <button
              key={it.label}
              type="button"
              onClick={() => {
                setOpen(false);
                it.onClick?.();
              }}
              className={`${row} ${it.danger ? "text-danger" : ""}`}
            >
              {it.icon && <Icon name={it.icon} size={15} className={it.danger ? "" : "text-muted"} />}
              {it.label}
            </button>
          ),
        )}
      </Popover>
    </>
  );
}
