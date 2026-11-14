// Sidebar.tsx
// The sidebar: every list in one column, in the manner of Things. It is not always there.
// The button at the top left (or the \ key) slides it in; on a wide screen it then stays
// beside the page until closed, and on a narrow one it lies over the page and closes when a
// row is chosen. Whether it is open is remembered on this device.
//
// Top to bottom, with space between the groups instead of headings (as Things does):
//   Today and Tasks; the views (built in, then the ones he saved, then the look-back);
//   People, Projects and Notes; his tags; Activity and Settings at the foot.
// It carries no counts: he finds rows of numbers overwhelming.

import { createContext, useContext, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useHome, useViews } from "../api";
import { BUILT_IN, filterHref } from "../lib/views";
import { useScope } from "../spaces";
import { Icon } from "./ui";

export const SIDEBAR_WIDTH = 252;

/**
 * True while the sidebar is docked beside the page. Pages use it to leave out navigation the
 * sidebar already shows (the tabs under a title, the row of views on Tasks), so nothing is
 * on screen twice.
 */
export const SidebarDocked = createContext(false);
export const useSidebarDocked = () => useContext(SidebarDocked);

export function Sidebar({ open, docked, onClose }: { open: boolean; docked: boolean; onClose: () => void }) {
  const { base } = useScope();
  const { pathname, search } = useLocation();
  const { data: home } = useHome();
  const views = useViews();
  const here = pathname + search;
  const pick = () => {
    if (!docked) onClose(); // lying over the page: get out of the way once something is chosen
  };

  const Row = ({ to, icon, tone = "muted", children, active }: { to: string; icon: string; tone?: string; children: ReactNode; active?: boolean }) => {
    const on = active ?? here === to;
    return (
      <Link to={to} onClick={pick} aria-current={on ? "page" : undefined} className={`press flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-[14px] max-md:h-11 ${on ? "bg-field font-semibold" : "hover:bg-field"}`}>
        <span className="flex size-5 shrink-0 items-center justify-center" style={{ color: tone === "muted" ? "var(--muted)" : `var(--${tone})` }}>
          <Icon name={icon} size={16} />
        </span>
        <span className="truncate">{children}</span>
      </Link>
    );
  };
  const gap = <div className="h-4" aria-hidden />;

  return (
    <>
      {/* Lying over the page, a dim layer behind it closes it. */}
      {open && !docked && <div className="anim-fade fixed inset-0 z-40 bg-black/25" onClick={onClose} aria-hidden />}
      <aside className="sidebar fixed inset-y-0 left-0 z-40 flex flex-col bg-surface shadow-2" data-open={open} style={{ width: SIDEBAR_WIDTH, paddingTop: "env(safe-area-inset-top)" }} aria-label="Lists" inert={!open}>
        {/* Sits exactly where the button that opened it was, so the same spot opens and closes it. */}
        <div className="flex h-14 shrink-0 items-center px-3">
          <button type="button" aria-label="Hide the sidebar" title="Hide (\\)" onClick={onClose} className="press flex size-9 items-center justify-center rounded-[10px] text-muted hover:bg-field hover:text-fg">
            <Icon name="sidebar" size={18} />
          </button>
        </div>
        <nav className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2.5 pb-4 pt-1">
          <Row to={base || "/"} icon="desk" tone="soon" active={pathname === (base || "/")}>
            Today
          </Row>
          <Row to="/tasks" icon="task" tone="ok" active={pathname.endsWith("/tasks") && !search}>
            Tasks
          </Row>
          {gap}
          {BUILT_IN.map((v) => (
            <Row key={v.name} to={filterHref(v.filter)} icon={v.icon} tone={v.tone}>
              {v.name}
            </Row>
          ))}
          {(views.data ?? []).map((v) => (
            <Row key={v.id} to={`/view/${v.id}`} icon="decision" tone="accent">
              {v.name}
            </Row>
          ))}
          {gap}
          <Row to={`${base}/people`} icon="people" active={pathname.endsWith("/people") || pathname.startsWith("/people/")}>
            People
          </Row>
          <Row to={`${base}/projects`} icon="projects" active={pathname.endsWith("/projects") || pathname.startsWith("/projects/")}>
            Projects
          </Row>
          <Row to={`${base}/notes`} icon="note" active={pathname.endsWith("/notes")}>
            Notes
          </Row>
          {(home?.tags.length ?? 0) > 0 && (
            <>
              {gap}
              {home!.tags.slice(0, 14).map((t) => {
                const to = `/tag/${encodeURIComponent(t.name)}`;
                return (
                  <Link key={t.id} to={to} onClick={pick} className={`press flex h-8 items-center gap-2.5 rounded-[10px] px-2.5 text-[13px] max-md:h-10 ${pathname === to ? "bg-field font-semibold" : "text-muted hover:bg-field hover:text-fg"}`}>
                    <span className="flex size-5 shrink-0 items-center justify-center text-faint">#</span>
                    <span className="truncate">{t.name}</span>
                  </Link>
                );
              })}
            </>
          )}
        </nav>
        <div className="px-2.5 pb-3 pt-2 shadow-[inset_0_1px_0_var(--line)]" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <Row to="/activity" icon="activity">
            Activity
          </Row>
          <Row to="/settings" icon="settings">
            Settings
          </Row>
        </div>
      </aside>
    </>
  );
}
