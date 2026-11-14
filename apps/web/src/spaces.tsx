// spaces.tsx
// The three desks. Work, Personal and Side business are separate places, each with its own
// paper color, accent and mark. "Today" (scope "all") is the overview across all three.
//
// Which desk you are at comes from the address: /work, /personal and /side are the desks,
// and / is Today. A project page switches to its project's desk. Pages that belong to no desk
// (a person, Activity, Settings) keep whichever desk you came from.
// The colors live in styles.css under :root[data-space=...].

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { Area } from "@pd/core";

export type Scope = "all" | Area;

export interface Space {
  id: Scope;
  /** First part of the address: "" for Today, "work", "personal", "side". */
  path: string;
  label: string;
  short: string;
}

export const SPACES: Space[] = [
  { id: "all", path: "", label: "Today", short: "Today" },
  { id: "work", path: "work", label: "Work", short: "Work" },
  { id: "personal", path: "personal", label: "Personal", short: "Personal" },
  { id: "side_business", path: "side", label: "Side business", short: "Side" },
];
export const DESKS = SPACES.filter((s) => s.id !== "all") as (Space & { id: Area })[];

export const AREA_LABEL: Record<Area, string> = { work: "Work", personal: "Personal", side_business: "Side business" };

export function spaceOf(scope: Scope): Space {
  return SPACES.find((s) => s.id === scope) ?? SPACES[0]!;
}

/** The address of a desk's page: basePath("work") + "/projects" is "/work/projects". */
export function basePath(scope: Scope): string {
  const p = spaceOf(scope).path;
  return p ? `/${p}` : "";
}

function scopeFromPath(pathname: string): Scope | null {
  const first = pathname.split("/")[1] ?? "";
  const match = DESKS.find((s) => s.path === first);
  if (match) return match.id;
  if (["/", "/projects", "/people", "/tasks", "/notes"].includes(pathname)) return "all";
  return null; // a project, a person, Activity, Settings: no desk of its own
}

interface ScopeValue {
  scope: Scope;
  space: Space;
  /** "" for Today (every area), otherwise the single area. Goes straight into ?areas=. */
  param: string;
  base: string;
  /** A page that knows its desk (a project page) calls this so the colors follow. */
  setScope: (s: Scope) => void;
}

const Ctx = createContext<ScopeValue | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const [scope, setScope] = useState<Scope>(() => scopeFromPath(loc.pathname) ?? "all");

  useEffect(() => {
    const s = scopeFromPath(loc.pathname);
    if (s) setScope(s);
  }, [loc.pathname]);

  useEffect(() => {
    document.documentElement.dataset.space = scope;
    // Match the phone's status bar to the desk's paper.
    const paper = getComputedStyle(document.documentElement).getPropertyValue(scope === "all" ? "--paper" : `--paper-${scope}`).trim();
    if (paper) document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", paper));
  }, [scope]);

  const value = useMemo<ScopeValue>(
    () => ({ scope, space: spaceOf(scope), param: scope === "all" ? "" : scope, base: basePath(scope), setScope }),
    [scope],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useScope(): ScopeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useScope outside ScopeProvider");
  return v;
}

/** Each desk has a shape as well as a color, so they can be told apart without relying on color. */
export function Sigil({ scope, size = 10, className = "" }: { scope: Scope; size?: number; className?: string }) {
  const color = `var(--space-${scope})`;
  const common = { width: size, height: size, viewBox: "0 0 12 12", className: `shrink-0 ${className}`, "aria-hidden": true } as const;
  if (scope === "work")
    return (
      <svg {...common}>
        <rect x="1.5" y="1.5" width="9" height="9" rx="2.2" fill={color} />
      </svg>
    );
  if (scope === "personal")
    return (
      <svg {...common}>
        <circle cx="6" cy="6" r="4.8" fill={color} />
      </svg>
    );
  if (scope === "side_business")
    return (
      <svg {...common}>
        <rect x="2" y="2" width="8" height="8" rx="1.6" fill={color} transform="rotate(45 6 6)" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="6" cy="6" r="3.9" fill="none" stroke={color} strokeWidth="1.8" />
    </svg>
  );
}

/** Read and write a small per-device preference. Never throws. */
export function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`pd-${key}`);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  return [
    value,
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(`pd-${key}`, JSON.stringify(v));
      } catch {
        /* private mode: keep in memory only */
      }
    },
  ];
}
