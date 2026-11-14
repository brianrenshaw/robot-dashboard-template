import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import "./styles.css";
import { queryClient } from "./api";
import { DESKS, ScopeProvider } from "./spaces";
import { Shell } from "./components/Shell";
import { Dashboard } from "./pages/Dashboard";
import { Projects } from "./pages/Projects";
import { ProjectPage } from "./pages/Project";
import { People, PersonPage } from "./pages/People";
import { Notes } from "./pages/Notes";
import { Tasks } from "./pages/Tasks";
import { TagPage } from "./pages/Tag";
import { Activity } from "./pages/Activity";
import { SettingsPage } from "./pages/Settings";

// Addresses:
//   /                      Today, the overview of all three desks
//   /projects, /people     everything, across desks
//   /work, /personal, /side            a desk
//   /work/projects, /work/people       that desk's projects and people
//   /projects/:id, /people/:id         one project, one person
//   /activity, /settings
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ScopeProvider>
          <Shell>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/people" element={<People />} />
              <Route path="/notes" element={<Notes />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/tag/:name" element={<TagPage />} />
              <Route path="/view/:id" element={<Tasks />} />
              {DESKS.flatMap((d) => [
                <Route key={d.path} path={`/${d.path}`} element={<Dashboard />} />,
                <Route key={`${d.path}-projects`} path={`/${d.path}/projects`} element={<Projects />} />,
                <Route key={`${d.path}-people`} path={`/${d.path}/people`} element={<People />} />,
                <Route key={`${d.path}-notes`} path={`/${d.path}/notes`} element={<Notes />} />,
                <Route key={`${d.path}-tasks`} path={`/${d.path}/tasks`} element={<Tasks />} />,
              ])}
              <Route path="/projects/:id" element={<ProjectPage />} />
              <Route path="/people/:id" element={<PersonPage />} />
              <Route path="/activity" element={<Activity />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<p className="py-24 text-center text-muted">That page does not exist.</p>} />
            </Routes>
          </Shell>
        </ScopeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
