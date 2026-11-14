// Shell.tsx
// The frame around every page: the desk switcher across the top, search, the add button and
// the "more" menu, plus the bottom bar on phones. There is no sidebar. Each desk is a place
// you walk into, and the page has the room.
//
// Keyboard (never shown on screen): Cmd+K search, N add, 1 to 4 switch desk, Esc closes.

import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { SPACES, Sigil, basePath, usePref, useScope, type Scope } from "../spaces";
import { Capture } from "./Capture";
import { SIDEBAR_WIDTH, Sidebar, SidebarDocked, useSidebarDocked } from "./Sidebar";
import { SearchPalette } from "./SearchPalette";
import { Icon, Toasts } from "./ui";

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/** The tab of a desk the current page is ("tasks", "people", ...), otherwise "". */
function useTab(): string {
  const { pathname } = useLocation();
  return /^(?:\/(?:work|personal|side))?\/(tasks|projects|people|notes)$/.exec(pathname)?.[1] ?? "";
}

export function Shell({ children }: { children: ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // The sidebar. Open or closed is remembered. On a wide screen it sits beside the page
  // ("docked"); on a narrow one it lies over it and closes when the page changes.
  const [sideOpen, setSideOpen] = usePref("sidebar-open", false);
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1180px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1180px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const docked = sideOpen && wide;
  const loc = useLocation();
  const nav = useNavigate();
  const tab = useTab();

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape") {
        setSearchOpen(false);
        setAddOpen(false);
        if (!wide) setSideOpen(false);
      } else if (plain && !isTyping(e) && e.key === "\\") {
        e.preventDefault();
        setSideOpen(!sideOpen);
      } else if (plain && !isTyping(e) && e.key === "n") {
        e.preventDefault();
        setAddOpen(true);
      } else if (plain && !isTyping(e) && ["1", "2", "3", "4"].includes(e.key)) {
        const s = SPACES[Number(e.key) - 1]!;
        nav(`${basePath(s.id)}${tab ? `/${tab}` : ""}` || "/");
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [nav, tab, sideOpen, wide, setSideOpen]);

  useEffect(() => {
    setSearchOpen(false);
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  return (
    <div className="relative min-h-dvh">
      <div className="desk-light" aria-hidden />
      <Sidebar open={sideOpen} docked={docked} onClose={() => setSideOpen(false)} />
      {/* When the sidebar is docked the page moves over to make room for it. */}
      <div className="shell-body" style={{ paddingLeft: docked ? SIDEBAR_WIDTH : 0 }}>
        <Masthead onSearch={() => setSearchOpen(true)} onAdd={() => setAddOpen(true)} sideOpen={sideOpen} onSide={() => setSideOpen(!sideOpen)} />
        <main key={loc.pathname} className="anim-page relative z-10 mx-auto max-w-[1320px] px-3 pb-32 md:px-8 md:pb-20">
          <SidebarDocked.Provider value={docked}>{children}</SidebarDocked.Provider>
        </main>
      </div>
      <PhoneBar onSearch={() => setSearchOpen(true)} onAdd={() => setAddOpen(true)} />
      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} />}
      {addOpen && <Capture onClose={() => setAddOpen(false)} />}
      <Toasts />
    </div>
  );
}

function Masthead({ onSearch, onAdd, sideOpen, onSide }: { onSearch: () => void; onAdd: () => void; sideOpen: boolean; onSide: () => void }) {
  const { scope } = useScope();
  const tab = useTab();
  return (
    <header className="sticky top-0 z-30 bg-[color-mix(in_srgb,var(--paper)_82%,transparent)] backdrop-blur-xl" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-2 px-3 md:px-7">
        {/* Opens the sidebar. Once it is open, its own button in the same spot closes it. */}
        {!sideOpen && (
          <button type="button" aria-label="Show the sidebar" aria-expanded={false} title="Lists (\\)" onClick={onSide} className="press flex size-9 shrink-0 items-center justify-center rounded-[10px] text-muted hover:bg-field hover:text-fg">
            <Icon name="sidebar" size={18} />
          </button>
        )}
        <nav className="no-scrollbar -mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 py-2 sm:gap-1" aria-label="Desks">
          {SPACES.map((s) => (
            <SpaceLink key={s.id} id={s.id} label={s.label} short={s.short} active={scope === s.id} to={`${basePath(s.id)}${tab ? `/${tab}` : ""}` || "/"} />
          ))}
        </nav>
        <button
          type="button"
          onClick={onSearch}
          aria-label="Search"
          className="press hidden h-9 w-52 shrink-0 items-center gap-2 rounded-[10px] bg-field px-3 text-[13px] text-muted hover:bg-field-hover hover:text-fg md:flex"
        >
          <Icon name="search" size={15} />
          Search
          <kbd className="ml-auto font-sans text-[11px] text-faint">⌘K</kbd>
        </button>
        <button type="button" onClick={onAdd} aria-label="Add" className="press hidden h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-accent pl-2.5 pr-3.5 text-[13px] font-medium text-on-accent shadow-1 hover:brightness-110 md:flex">
          <Icon name="plus" size={16} />
          Add
        </button>
      </div>
    </header>
  );
}

function SpaceLink({ id, label, short, active, to }: { id: Scope; label: string; short: string; active: boolean; to: string }) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={`press flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium sm:gap-2 sm:px-3.5 ${
        active ? "bg-surface text-fg shadow-1" : "text-muted hover:bg-field hover:text-fg"
      }`}
    >
      <Sigil scope={id} className={active ? "" : "opacity-60"} />
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}

/** The tabs under a desk's title: its desk, its projects, its people. Hidden on phones, where the bottom bar does this. */
export function SpaceTabs() {
  const { base } = useScope();
  const tabs = [
    { to: base || "/", label: "Dashboard" },
    { to: `${base}/tasks`, label: "Tasks" },
    { to: `${base}/people`, label: "People" },
    { to: `${base}/projects`, label: "Projects" },
    { to: `${base}/notes`, label: "Notes" },
  ];
  return (
    <nav className="hidden gap-6 md:flex" aria-label="Sections">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          className={({ isActive }) =>
            `press relative pb-2.5 text-sm font-medium ${isActive ? "text-fg after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent" : "text-muted hover:text-fg"}`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** The top of a desk page: the title, one quiet line under it, then the tabs. */
export function PageHeader({ title, summary, tinted = false, right }: { title: ReactNode; summary?: ReactNode; tinted?: boolean; right?: ReactNode }) {
  const docked = useSidebarDocked();
  return (
    <header className="pb-4 pt-4 md:pb-5 md:pt-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className={`display text-[26px] md:text-[30px] ${tinted ? "text-accent" : ""}`}>{title}</h1>
          {summary && <p className="mt-1 text-[13px] text-muted">{summary}</p>}
        </div>
        {right}
      </div>
      {/* With the sidebar docked, it is the navigation; the tabs would only repeat it. */}
      {!docked && (
        <div className="mt-4 shadow-[inset_0_-1px_0_var(--line)] max-md:hidden">
          <SpaceTabs />
        </div>
      )}
    </header>
  );
}

function PhoneBar({ onSearch, onAdd }: { onSearch: () => void; onAdd: () => void }) {
  const { base } = useScope();
  const item = "press flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium";
  const link = ({ isActive }: { isActive: boolean }) => `${item} ${isActive ? "text-accent" : "text-faint"}`;
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] shadow-[0_-1px_0_var(--line)] backdrop-blur-xl md:hidden" aria-label="Sections">
      <div className="flex h-14 items-stretch">
        <NavLink to={base || "/"} end className={link}>
          <Icon name="desk" size={20} />
          Dashboard
        </NavLink>
        <NavLink to={`${base}/tasks`} end className={link}>
          <Icon name="task" size={20} />
          Tasks
        </NavLink>
        <div className="flex flex-1 items-center justify-center">
          <button type="button" onClick={onAdd} aria-label="Add" className="press flex size-11 items-center justify-center rounded-full bg-accent text-on-accent shadow-2">
            <Icon name="plus" size={20} />
          </button>
        </div>
        <NavLink to={`${base}/people`} end className={link}>
          <Icon name="people" size={20} />
          People
        </NavLink>
        <button type="button" onClick={onSearch} className={`${item} text-faint`}>
          <Icon name="search" size={20} />
          Search
        </button>
      </div>
    </nav>
  );
}
