"use client";

import { useEffect, useMemo, useState } from "react";

type Role = "Owner" | "Zookeeper";
type Tab = "today" | "animals" | "trends" | "more";
type Task = {
  id: string;
  animalId: string;
  animalName: string;
  species: string;
  title: string;
  details: string;
  dueDate: string;
  complete: boolean;
};
type Animal = {
  id: string;
  name: string;
  species: string;
  group: string;
  location: string;
  weightGrams: number | null;
  weightDate: string | null;
};
type RecentEvent = {
  id: string;
  animalName: string;
  title: string;
  occurredAt: string;
  actorRole: string;
};
type WeightTrend = {
  animalId: string;
  animalName: string;
  previous: number;
  current: number;
  previousDate: string;
  currentDate: string;
};
type DashboardData = {
  date: string;
  tasks: Task[];
  animals: Animal[];
  recentEvents: RecentEvent[];
  weightTrends: WeightTrend[];
};

const navItems: Array<{ id: Tab; label: string; glyph: string }> = [
  { id: "today", label: "Today", glyph: "⌂" },
  { id: "animals", label: "Animals", glyph: "◉" },
  { id: "trends", label: "Trends", glyph: "↗" },
  { id: "more", label: "More", glyph: "•••" },
];

const formatDate = (date: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(
    new Date(`${date}T12:00:00`),
  );

const timeAgo = (value: string) => {
  const then = new Date(value).getTime();
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
};

export default function HusbandryApp() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("today");
  const [role, setRole] = useState<Role>("Owner");
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const refresh = async () => {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (!response.ok) throw new Error("Dashboard data is unavailable");
    setData(await response.json());
  };

  useEffect(() => {
    refresh().catch(() => setToast("Couldn’t load the habitat collection yet."));
    const timer = window.setInterval(() => refresh().catch(() => undefined), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const completeTask = async (task: Task) => {
    setBusyTask(task.id);
    try {
      const response = await fetch("/api/tasks/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: task.id, dueDate: task.dueDate, actorRole: role }),
      });
      if (!response.ok) throw new Error("Unable to save");
      await refresh();
      setToast(`${task.animalName}: ${task.title} recorded`);
      window.setTimeout(() => setToast(null), 2800);
    } catch {
      setToast("That update didn’t save. Please try again.");
    } finally {
      setBusyTask(null);
    }
  };

  const pending = data?.tasks.filter((task) => !task.complete) ?? [];
  const completed = data?.tasks.filter((task) => task.complete) ?? [];
  const completionPercent = data?.tasks.length ? Math.round((completed.length / data.tasks.length) * 100) : 0;
  const filteredAnimals = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data?.animals ?? [];
    return (data?.animals ?? []).filter((animal) =>
      `${animal.name} ${animal.species} ${animal.location}`.toLowerCase().includes(needle),
    );
  }, [data?.animals, query]);

  return (
    <div className="app-shell">
      <aside className="desktop-rail" aria-label="Primary navigation">
        <div className="brand-mark" aria-hidden="true"><span /></div>
        <nav>
          {navItems.map((item) => (
            <button key={item.id} className={activeTab === item.id ? "active" : ""} onClick={() => setActiveTab(item.id)}>
              <b>{item.glyph}</b><span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main>
        <header className="topbar">
          <button className="wordmark" onClick={() => setActiveTab("today")} aria-label="Open today dashboard">
            <span className="mini-mark" aria-hidden="true" />
            <span><b>Shed</b><small>Good care shows</small></span>
          </button>
          <button className={`role-chip ${role.toLowerCase()}`} onClick={() => setRole(role === "Owner" ? "Zookeeper" : "Owner")}>
            <span>{role === "Owner" ? "O" : "Z"}</span>{role}<i>⌄</i>
          </button>
        </header>

        {!data ? (
          <section className="loading-state" aria-live="polite">
            <div className="loader" /><h1>Opening Shed…</h1>
          </section>
        ) : activeTab === "today" ? (
          <section className="page today-page">
            <div className="eyebrow">{formatDate(data.date)}</div>
            <div className="page-heading">
              <div><h1>Today’s care</h1><p>{pending.length ? `${pending.length} things still need a keeper.` : "Everything is tucked in for today."}</p></div>
              {role === "Owner" && <button className="quiet-button" onClick={() => setActiveTab("more")}>Manage care plans</button>}
            </div>

            <article className="progress-card">
              <div className="progress-copy">
                <span className="sun-disc" aria-hidden="true">☀</span>
                <div><strong>{completed.length} of {data.tasks.length} complete</strong><span>{pending.length ? "A tidy little list today" : "All care completed"}</span></div>
              </div>
              <div className="progress-track" aria-label={`${completionPercent}% complete`}><span style={{ width: `${completionPercent}%` }} /></div>
              <b>{completionPercent}%</b>
            </article>

            <div className="section-title"><h2>Up next</h2><span>{pending.length} remaining</span></div>
            <div className="task-list">
              {pending.map((task) => (
                <article className="task-card" key={task.id}>
                  <div className="animal-badge" aria-hidden="true">{task.animalName.slice(0, 1)}</div>
                  <div className="task-copy">
                    <span>{task.species}</span><h3>{task.animalName}</h3><p><b>{task.title}</b> · {task.details}</p>
                  </div>
                  <button className="complete-button" disabled={busyTask === task.id} onClick={() => completeTask(task)}>
                    {busyTask === task.id ? "Saving…" : "Mark done"}<span>✓</span>
                  </button>
                </article>
              ))}
              {!pending.length && <div className="empty-card"><span>✓</span><h3>That’s everything</h3><p>There are no remaining scheduled tasks today.</p></div>}
            </div>

            <div className="section-title compact"><h2>Completed today</h2><span>{completed.length}</span></div>
            <div className="completed-list">
              {completed.map((task) => <div key={task.id}><span>✓</span><b>{task.animalName}</b><p>{task.title}</p></div>)}
            </div>

            <div className="section-title compact"><h2>Recent activity</h2><button onClick={() => setActiveTab("animals")}>View all</button></div>
            <div className="activity-list">
              {data.recentEvents.slice(0, 6).map((event) => (
                <div key={event.id}><span className="activity-dot" /><p><b>{event.animalName}</b> · {event.title}<small>{event.actorRole} · {timeAgo(event.occurredAt)}</small></p></div>
              ))}
            </div>
          </section>
        ) : activeTab === "animals" ? (
          <section className="page">
            <div className="eyebrow">The whole household</div>
            <div className="page-heading"><div><h1>Animals & habitats</h1><p>{data.animals.length} individual and community records.</p></div></div>
            <label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search animals, species, or rooms" /></label>
            <div className="animal-grid">
              {filteredAnimals.map((animal) => (
                <article className="animal-card" key={animal.id}>
                  <div className="animal-card-top"><span>{animal.name.slice(0, 1)}</span><small>{animal.group}</small></div>
                  <h2>{animal.name}</h2><p>{animal.species}</p>
                  <div className="animal-meta"><span>{animal.location}</span>{animal.weightGrams !== null && <b>{animal.weightGrams} g</b>}</div>
                </article>
              ))}
            </div>
          </section>
        ) : activeTab === "trends" ? (
          <section className="page">
            <div className="eyebrow">Growth & body condition</div>
            <div className="page-heading"><div><h1>Weight trends</h1><p>Current changes from the previous recorded weigh-in.</p></div></div>
            <div className="trend-summary"><span>6 snakes tracked</span><b>Weights are recorded in grams</b></div>
            <div className="trend-grid">
              {data.weightTrends.map((trend) => {
                const change = trend.current - trend.previous;
                const percentage = (change / trend.previous) * 100;
                const ratio = Math.min(100, Math.max(12, (trend.current / 1300) * 100));
                return <article className="trend-card" key={trend.animalId}>
                  <div><span>{trend.animalName.slice(0, 1)}</span><p><b>{trend.animalName}</b><small>{trend.currentDate}</small></p><strong>{trend.current} g</strong></div>
                  <div className="weight-bar"><i style={{ width: `${ratio}%` }} /></div>
                  <footer><span>Previous {trend.previous} g</span><b className={change >= 0 ? "gain" : "loss"}>{change >= 0 ? "+" : ""}{change} g · {percentage >= 0 ? "+" : ""}{percentage.toFixed(1)}%</b></footer>
                </article>;
              })}
            </div>
          </section>
        ) : (
          <section className="page">
            <div className="eyebrow">Household controls</div>
            <div className="page-heading"><div><h1>More</h1><p>Access, portability, and care-plan controls.</p></div></div>
            <article className="settings-card role-panel">
              <div><span className="settings-icon">{role === "Owner" ? "O" : "Z"}</span><div><h2>{role} view</h2><p>{role === "Owner" ? "Full access to schedules, records, exports, and household access." : "Can view animals and record husbandry without changing schedules or deleting history."}</p></div></div>
              <button onClick={() => setRole(role === "Owner" ? "Zookeeper" : "Owner")}>Preview {role === "Owner" ? "Zookeeper" : "Owner"}</button>
            </article>

            <div className="settings-grid">
              <article className="settings-card"><span className="settings-icon">↥</span><h2>Your data, always portable</h2><p>Download a complete open-format copy at any time. Exports use stable identifiers, ISO dates, and numeric gram values.</p><div className="export-actions"><a href="/api/export?format=json">Download JSON</a><a href="/api/export?format=csv">Download CSV</a></div></article>
              <article className="settings-card"><span className="settings-icon">⌁</span><h2>Household access</h2><p>Owner and Zookeeper permissions are designed for shared care across multiple phones.</p><div className="device-row"><span>Owner device</span><b>Full access</b></div><div className="device-row"><span>Zookeeper invitation</span><b>Ready to connect</b></div></article>
              <article className={`settings-card ${role === "Zookeeper" ? "locked" : ""}`}><span className="settings-icon">☷</span><h2>Care plans</h2><p>Daily, weekly, monthly, and every-N-day schedules live here.</p><button disabled={role === "Zookeeper"}>{role === "Zookeeper" ? "Owner access required" : "Manage schedules"}</button></article>
              <article className={`settings-card ${role === "Zookeeper" ? "locked" : ""}`}><span className="settings-icon">↺</span><h2>Backup status</h2><p>The production version will keep dated SQL, CSV, JSON, and workbook snapshots outside the live database.</p><div className="backup-status"><i />Export design ready</div></article>
            </div>
          </section>
        )}

        <nav className="mobile-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <button key={item.id} className={activeTab === item.id ? "active" : ""} onClick={() => setActiveTab(item.id)}><b>{item.glyph}</b><span>{item.label}</span></button>
          ))}
        </nav>
        {toast && <div className="toast" role="status">{toast}</div>}
      </main>
    </div>
  );
}
