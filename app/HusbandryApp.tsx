"use client";

import { FormEvent, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import WeekView from "./week-view";
import { AnimalProfile, BulkFeederIntake, FeederForecast, GettingStartedGuide, ManageConsole, RestorePanel, SetupGate, type FeederForecastData, type ResourceKey, type SetupSummary } from "./manage";
import { animalPhotoUrl } from "./animal-photo";
import { animalFacts, speciesGlyph } from "@/lib/animal-traits";
import { taskIsOverdue, taskLastDay } from "@/lib/care-window";
import type { Capability } from "@/lib/capabilities";

type Role = "Owner" | "Zookeeper";
type Viewer = { id: string; displayName: string; role: Role; earningEnabled?: boolean; balanceCents?: number | null };
type Session = { authenticated: boolean; authRequired: boolean; setupRequired: boolean; capabilities: Capability[]; member: Viewer | null };
type Member = {
  id: string;
  displayName: string;
  role: Role;
  active: boolean;
  earningEnabled: boolean;
  balanceCents: number;
  earnedCents: number;
  paidCents: number;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};
type Invite = { displayName: string; accessCode: string };
type ContributionReport = {
  from: string;
  to: string;
  contributions: Array<{ memberId: string; displayName: string; taskCount: number }>;
  completions: Array<{
    eventId: string;
    memberId: string;
    completedBy: string;
    animalName: string;
    title: string;
    dueDate: string | null;
    completedAt: string;
  }>;
};
type Tab = "today" | "animals" | "trends" | "more";
type Task = {
  id: string;
  taskType: string;
  animalId: string;
  animalName: string;
  species: string;
  title: string;
  details: string;
  feedingGuidance: string | null;
  dueDate: string;
  graceDays?: number;
  complete: boolean;
  outcome: "done" | "refused" | null;
  completedByMemberId: string | null;
  completedBy: string | null;
  skippedAt: string | null;
  skipReason: string | null;
  missedAt: string | null;
  missedBy: string | null;
};
type Animal = {
  id: string;
  name: string;
  species: string;
  group: string;
  location: string;
  morph: string | null;
  sex: string | null;
  birthDate: string | null;
  weightGrams: number | null;
  weightDate: string | null;
  enclosureName: string | null;
  photoUpdatedAt: string | null;
};
type RecentEvent = {
  id: string;
  animalName: string;
  title: string;
  occurredAt: string;
  actorRole: string;
  completedBy: string | null;
  outcome: "done" | "refused" | null;
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
  capabilities: Capability[];
  viewer: Viewer | null;
  tasks: Task[];
  overdue: Task[];
  animals: Animal[];
  recentEvents: RecentEvent[];
  weightTrends: WeightTrend[];
  setupSummary: SetupSummary;
};

const navItems: Array<{ id: Tab; label: string; glyph: string }> = [
  { id: "today", label: "Today", glyph: "⌂" },
  { id: "animals", label: "Animals", glyph: "◉" },
  { id: "trends", label: "Trends", glyph: "↗" },
  { id: "more", label: "More", glyph: "•••" },
];

// Internal API roles stay "Owner"/"Zookeeper" for backend compatibility;
// keepers see the household-friendly labels.
const roleLabel = (role: Role) => (role === "Owner" ? "Head Keeper" : "Keeper");

const formatCents = (cents: number) => `$${(Math.max(0, cents) / 100).toFixed(2)}`;

const formatDate = (date: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(
    new Date(`${date}T12:00:00`),
  );

const shortDate = (date: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(
    new Date(`${date}T12:00:00`),
  );

const taskDetails = (task: Task) => task.feedingGuidance ?? task.details;

const timeAgo = (value: string) => {
  const then = new Date(value).getTime();
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
};

const THEME_EVENT = "shed-theme-change";
const readTheme = () => document.documentElement.getAttribute("data-theme") === "dark";
const subscribeToTheme = (onChange: () => void) => {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
};

export default function HusbandryApp() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("today");
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [query, setQuery] = useState("");


  // ── Management overlays (Head Keeper) ──
  const [manageOpen, setManageOpen] = useState(false);
  const [manageStart, setManageStart] = useState<ResourceKey>("animal");
  const [manageFocusAnimal, setManageFocusAnimal] = useState<string | undefined>(undefined);
  const [guideOpen, setGuideOpen] = useState(false);
  const [weekOpen, setWeekOpen] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [forecastOpen, setForecastOpen] = useState(false);
  const [bulkFeedersOpen, setBulkFeedersOpen] = useState(false);
  const [forecast, setForecast] = useState<{ orderNeeded: boolean; warnings: number; reorderAcknowledged?: boolean } | null>(null);
  const [orderBusy, setOrderBusy] = useState(false);

  // The pre-paint script owns the attribute; read it rather than duplicating it
  // in state, so there is no hydration mismatch and no flash.
  const darkMode = useSyncExternalStore(subscribeToTheme, readTheme, () => false);

  const toggleTheme = () => {
    const next = !darkMode;
    if (next) document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try { localStorage.setItem("shed-theme", next ? "dark" : "light"); } catch { /* private browsing */ }
    window.dispatchEvent(new Event(THEME_EVENT));
  };

  // Quiet the reorder nudge until the shipment lands (or 30 days pass).
  const markOrderPlaced = async () => {
    setOrderBusy(true);
    try {
      const response = await fetch("/api/feeders/order", { method: "POST" });
      if (!response.ok) throw new Error("Couldn’t save that.");
      await loadForecast();
      notify("Feeder order noted — the reminder is back when it arrives.");
    } catch (orderError) {
      notify(orderError instanceof Error ? orderError.message : "Couldn’t save that.");
    } finally {
      setOrderBusy(false);
    }
  };

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  };

  // ── Sign-in (real sessions; the old role-preview toggle is gone on purpose) ──
  const [accessCodeInput, setAccessCodeInput] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // ── Household management (Head Keeper only) ──
  const [members, setMembers] = useState<Member[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [newMemberName, setNewMemberName] = useState("");
  const [memberBusy, setMemberBusy] = useState<string | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [attributionTask, setAttributionTask] = useState<Task | null>(null);
  const [timingTask, setTimingTask] = useState<{ task: Task; outcome: "done" | "refused" } | null>(null);
  const [timingDate, setTimingDate] = useState("");
  const [attributionMemberId, setAttributionMemberId] = useState("");
  const [attributionReason, setAttributionReason] = useState("Wrong household member was credited.");
  // ── Task earnings ("allowance") ──
  const [rewardInput, setRewardInput] = useState("0.25");
  const [rewardBusy, setRewardBusy] = useState(false);
  const [report, setReport] = useState<ContributionReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");

  const viewer = session?.member ?? data?.viewer ?? null;
  const authRequired = session?.authRequired ?? false;
  const signedIn = Boolean(session?.member);
  // The backend returns the same capability names its route gates enforce. UI
  // controls key off those names instead of reinterpreting a role locally.
  // Session wins over older dashboard data during account changes so an Owner
  // control can never flash for a Keeper while the dashboard is refreshing.
  const capabilities = session?.capabilities ?? data?.capabilities ?? [];
  const can = (capability: Capability) => capabilities.includes(capability);
  const gateOpen = Boolean(session && session.authRequired && !session.member);
  // The signed-in keeper's own balance (from the dashboard viewer), shown by their name.
  const earnerBalanceCents = data?.viewer?.earningEnabled ? (data.viewer.balanceCents ?? 0) : null;

  const loadSession = async () => {
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      if (!response.ok) throw new Error("Session unavailable");
      setSession((await response.json()) as Session);
    } catch {
      setSession({ authenticated: false, authRequired: false, setupRequired: false, capabilities: [], member: null });
    }
  };

  const refresh = async () => {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (response.status === 401) {
      await loadSession();
      return;
    }
    if (!response.ok) throw new Error("Dashboard data is unavailable");
    setData(await response.json());
  };

  // Lightweight forecast summary for the Today reorder nudge; the full panel refetches on open.
  const loadForecast = async () => {
    try {
      const response = await fetch("/api/feeders/forecast?horizon=30", { cache: "no-store" });
      if (!response.ok) { setForecast(null); return; }
      const payload = (await response.json()) as FeederForecastData;
      setForecast({
        orderNeeded: payload.orderNeeded,
        warnings: payload.alerts.filter((alert) => alert.severity === "warning").length,
        reorderAcknowledged: payload.reorderAcknowledged ?? false,
      });
    } catch {
      setForecast(null);
    }
  };

  useEffect(() => {
    // Deferred a tick so the effect body itself never sets state
    // (react-hooks/set-state-in-effect); polling keeps it fresh after that.
    const initial = window.setTimeout(() => {
      loadSession().catch(() => undefined);
      refresh().catch(() => setToast("Couldn’t load the habitat collection yet."));
      loadForecast().catch(() => undefined);
    }, 0);
    const timer = window.setInterval(() => refresh().catch(() => undefined), 15000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
    // Mount-only: loadSession/refresh are stable for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMembers = async () => {
    setMembersError(null);
    try {
      const response = await fetch("/api/household/members", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setMembers(null);
        return;
      }
      if (!response.ok) throw new Error("Couldn’t load household members.");
      const payload = (await response.json()) as { members: Member[]; defaultRewardCents?: number };
      setMembers(payload.members);
      if (typeof payload.defaultRewardCents === "number") {
        setRewardInput((payload.defaultRewardCents / 100).toFixed(2));
      }
    } catch {
      setMembersError("Couldn’t load household members.");
    }
  };

  const saveDefaultReward = async (event: FormEvent) => {
    event.preventDefault();
    const dollars = Number(rewardInput);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setMembersError("Enter a valid dollar amount, like 0.25.");
      return;
    }
    setRewardBusy(true);
    setMembersError(null);
    try {
      const response = await fetch("/api/household/rewards", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultRewardCents: Math.round(dollars * 100) }),
      });
      const payload = (await response.json()) as { defaultRewardCents?: number; error?: string };
      if (!response.ok || typeof payload.defaultRewardCents !== "number") throw new Error(payload.error ?? "Couldn’t save.");
      setRewardInput((payload.defaultRewardCents / 100).toFixed(2));
      notify("Per-task amount updated.");
    } catch (error) {
      setMembersError(error instanceof Error ? error.message : "Couldn’t save the amount.");
    } finally {
      setRewardBusy(false);
    }
  };

  const payOut = async (member: Member) => {
    if (!window.confirm(`Pay out ${formatCents(member.balanceCents)} to ${member.displayName}? This clears their balance and records the payout.`)) return;
    setMemberBusy(member.id);
    setMembersError(null);
    try {
      const response = await fetch(`/api/household/members/${member.id}/payout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as { paidCents?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Couldn’t record the payout.");
      notify(`Paid ${formatCents(payload.paidCents ?? 0)} to ${member.displayName}.`);
      await loadMembers();
      await refresh().catch(() => undefined);
    } catch (error) {
      setMembersError(error instanceof Error ? error.message : "Couldn’t record the payout.");
    } finally {
      setMemberBusy(null);
    }
  };

  const loadReport = async (from?: string, to?: string) => {
    setReportBusy(true);
    setReportError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const queryString = params.toString();
      const response = await fetch(`/api/household/contributions${queryString ? `?${queryString}` : ""}`, { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setReport(null);
        return;
      }
      const payload = (await response.json()) as ContributionReport & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Couldn’t load the contribution report.");
      setReport(payload);
      setReportFrom(payload.from);
      setReportTo(payload.to);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Couldn’t load the contribution report.");
    } finally {
      setReportBusy(false);
    }
  };

  const openTab = (tab: Tab) => {
    setActiveTab(tab);
    if (tab === "more" && can("household.manage")) {
      if (!members) void loadMembers();
      if (!report && !reportBusy) void loadReport();
    }
  };

  const openManager = (resource: ResourceKey = "animal", focusAnimal?: string) => {
    setManageStart(resource);
    setManageFocusAnimal(focusAnimal);
    setManageOpen(true);
  };

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    const code = accessCodeInput.trim();
    setAccessCodeInput("");
    if (!code) return;
    setLoginBusy(true);
    setLoginError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessCode: code }),
      });
      if (response.status === 401) {
        setLoginError("That access code wasn’t accepted.");
        return;
      }
      if (!response.ok) throw new Error("Sign-in failed");
      const payload = (await response.json()) as { member: Viewer; capabilities: Capability[] };
      setSession((previous) => ({
        authenticated: true,
        authRequired: previous?.authRequired ?? false,
        setupRequired: false,
        capabilities: payload.capabilities,
        member: payload.member,
      }));
      setToast(`Signed in as ${payload.member.displayName}`);
      window.setTimeout(() => setToast(null), 2800);
      await refresh().catch(() => undefined);
      if (payload.capabilities.includes("household.manage")) {
        await Promise.all([loadMembers(), loadReport()]);
      }
    } catch {
      setLoginError("Sign-in didn’t go through. Please try again.");
    } finally {
      setLoginBusy(false);
    }
  };

  const signOut = async () => {
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
    } catch {
      // The cookie clear is best-effort; the session reload below is what matters.
    }
    setMembers(null);
    setReport(null);
    setInvite(null);
    setLoginError(null);
    await loadSession();
    await refresh().catch(() => undefined);
  };

  const createMember = async (event: FormEvent) => {
    event.preventDefault();
    const displayName = newMemberName.trim();
    if (!displayName) return;
    setMemberBusy("create");
    setMembersError(null);
    try {
      const response = await fetch("/api/household/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const payload = (await response.json()) as { member?: Member; accessCode?: string; error?: string };
      if (!response.ok || !payload.member || !payload.accessCode) {
        throw new Error(payload.error ?? "Unable to add the keeper.");
      }
      setNewMemberName("");
      setInvite({ displayName: payload.member.displayName, accessCode: payload.accessCode });
      await loadMembers();
    } catch (error) {
      setMembersError(error instanceof Error ? error.message : "Unable to add the keeper.");
    } finally {
      setMemberBusy(null);
    }
  };

  const patchMember = async (member: Member, body: { active?: boolean; reissueAccessCode?: boolean; earningEnabled?: boolean }) => {
    setMemberBusy(member.id);
    setMembersError(null);
    try {
      const response = await fetch(`/api/household/members/${member.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { member?: Member; accessCode?: string | null; error?: string };
      if (!response.ok || !payload.member) throw new Error(payload.error ?? "Unable to update that keeper.");
      if (payload.accessCode) setInvite({ displayName: payload.member.displayName, accessCode: payload.accessCode });
      await loadMembers();
    } catch (error) {
      setMembersError(error instanceof Error ? error.message : "Unable to update that keeper.");
    } finally {
      setMemberBusy(null);
    }
  };

  const copyInvite = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.accessCode);
      setToast("Access code copied");
    } catch {
      setToast("Copy didn’t work — write the code down instead");
    }
    window.setTimeout(() => setToast(null), 2800);
  };

  /**
   * A task logged after its due date is ambiguous: the care may have happened
   * today, late, or on the due date with only the logging running behind. Ask
   * rather than assume, because `occurredAt` is what the animal's history is
   * ordered by. On-time work is unambiguous and is never interrupted.
   */
  const completeTask = async (task: Task, outcome: "done" | "refused" = "done") => {
    // `data.date` is the household's current day as the server computed it, so
    // a keeper in another time zone — or up past midnight — sees the same
    // "overdue" as the records do. A task still inside its grace window is not
    // late at all, so it is never asked about.
    if (data && taskIsOverdue(task.dueDate, task.graceDays ?? 0, data.date)) {
      setTimingDate("");
      setTimingTask({ task, outcome });
      return;
    }
    await recordCompletion(task, outcome);
  };

  const recordCompletion = async (
    task: Task,
    outcome: "done" | "refused" = "done",
    occurredOn?: string,
  ) => {
    setBusyTask(task.id);
    try {
      const response = await fetch("/api/tasks/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: task.id, dueDate: task.dueDate, actorRole: viewer?.role ?? "Owner", outcome, occurredOn }),
      });
      const payload = (await response.json()) as { error?: string; outcome?: "done" | "refused"; allocatedFeeder?: { sizeClass: string; preySpecies: string } | null; feederShortage?: string | null };
      if (!response.ok) throw new Error(payload.error ?? "Unable to save");
      await refresh();
      const feeder = payload.allocatedFeeder;
      const feederNote = feeder
        ? ` · ${feeder.sizeClass} ${feeder.preySpecies} used`
        : payload.feederShortage
          ? " · no feeder deducted — add it in Manage → Feeders if you used stock"
          : "";
      const action = payload.outcome === "refused" ? "refusal recorded" : `${task.title} recorded`;
      setToast(`${task.animalName}: ${action}${feederNote}${viewer ? ` by ${viewer.displayName}` : ""}`);
      window.setTimeout(() => setToast(null), payload.feederShortage ? 5200 : 2800);
    } catch (saveError) {
      setToast(saveError instanceof Error ? saveError.message : "That update didn’t save. Please try again.");
    } finally {
      setBusyTask(null);
      setTimingTask(null);
      setTimingDate("");
    }
  };

  const undoTask = async (task: Task) => {
    if (!window.confirm(
      `Mark “${task.title}” for ${task.animalName} as NOT DONE?\n\nUse this only when the care itself did not happen. It returns the task to today’s list, removes the allowance credit from ${task.completedBy ?? "the recorded keeper"}, and keeps an audited correction in history.${task.taskType === "feeding" ? " The feeder deducted for this feeding will be returned to available inventory." : ""}\n\nTo fix only who received credit, cancel and choose “Change keeper” instead.`,
    )) return;
    setBusyTask(task.id);
    try {
      const response = await fetch("/api/tasks/complete", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          dueDate: task.dueDate,
          reason: "Marked not done from Today by the Head Keeper; care did not occur.",
        }),
      });
      const payload = (await response.json()) as { error?: string; correction?: { restoredFeederCount?: number } };
      if (!response.ok) throw new Error(payload.error ?? "Unable to undo");
      await refresh();
      void loadMembers().catch(() => undefined);
      const restored = payload.correction?.restoredFeederCount ?? 0;
      setToast(`${task.animalName}: ${task.title} marked not done${restored ? ` · ${restored} feeder returned to inventory` : ""}`);
      window.setTimeout(() => setToast(null), 2800);
    } catch (undoError) {
      setToast(undoError instanceof Error ? undoError.message : "That correction didn’t save. Please try again.");
    } finally {
      setBusyTask(null);
    }
  };

  const openAttributionCorrection = (task: Task) => {
    setAttributionTask(task);
    setAttributionMemberId(task.completedByMemberId ?? "");
    setAttributionReason("Wrong household member was credited.");
    if (!members) void loadMembers();
  };

  const correctAttribution = async (event: FormEvent) => {
    event.preventDefault();
    const task = attributionTask;
    if (!task || !attributionMemberId || attributionMemberId === task.completedByMemberId) return;
    setBusyTask(task.id);
    try {
      const response = await fetch("/api/tasks/complete", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          dueDate: task.dueDate,
          targetMemberId: attributionMemberId,
          reason: attributionReason,
        }),
      });
      const payload = (await response.json()) as { error?: string; correction?: { completedBy?: string } };
      if (!response.ok) throw new Error(payload.error ?? "Unable to change completion credit");
      setAttributionTask(null);
      await Promise.all([refresh(), loadMembers()]);
      setToast(`${task.animalName}: completion credit moved to ${payload.correction?.completedBy ?? "the selected keeper"}`);
      window.setTimeout(() => setToast(null), 3200);
    } catch (correctionError) {
      setToast(correctionError instanceof Error ? correctionError.message : "That correction didn’t save. Please try again.");
    } finally {
      setBusyTask(null);
    }
  };

  const skipTask = async (task: Task) => {
    // A reason is optional but strongly worth having: in three months "skipped"
    // alone tells the keeper nothing, and "already damp" tells them everything.
    const reason = window.prompt(
      `Skip “${task.title}” for ${task.animalName}?\n\nThis records that it did not need doing, so it will not count against ${task.animalName}'s husbandry score. Add a reason if you like:`,
      "",
    );
    if (reason === null) return;
    setBusyTask(task.id);
    try {
      const response = await fetch("/api/tasks/skip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: task.id, dueDate: task.dueDate, reason: reason.trim() }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to skip");
      await refresh();
      setToast(`${task.animalName}: ${task.title} skipped${reason.trim() ? ` — ${reason.trim()}` : ""}`);
      window.setTimeout(() => setToast(null), 2800);
    } catch (skipError) {
      setToast(skipError instanceof Error ? skipError.message : "Unable to skip");
      window.setTimeout(() => setToast(null), 2800);
    } finally {
      setBusyTask(null);
    }
  };

  // Skipping is a judgement call, and judgement calls get reconsidered — the
  // enclosure turns out to be drier than it looked. This puts the task back on
  // the list exactly as it was.
  const unskipTask = async (task: Task) => {
    setBusyTask(task.id);
    try {
      const response = await fetch("/api/tasks/skip", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: task.id, dueDate: task.dueDate }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to undo the skip");
      await refresh();
      setToast(`${task.animalName}: ${task.title} back on the list`);
      window.setTimeout(() => setToast(null), 2800);
    } catch (unskipError) {
      setToast(unskipError instanceof Error ? unskipError.message : "Unable to undo the skip");
      window.setTimeout(() => setToast(null), 2800);
    } finally {
      setBusyTask(null);
    }
  };

  const refuseMeal = async (task: Task) => {
    if (!window.confirm(
      `Record that ${task.animalName} refused this meal?\n\nThe feeder is still used up, and the care counts as done — you offered it. The refusal is kept in ${task.animalName}'s feeding history, and the next meal stays on its normal date.`,
    )) return;
    await completeTask(task, "refused");
  };

  const missTask = async (task: Task) => {
    if (!window.confirm(`Mark “${task.title}” for ${task.animalName} as missed? It’ll be recorded as not done and leave the list.`)) return;
    setBusyTask(task.id);
    try {
      const response = await fetch("/api/tasks/miss", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: task.id, dueDate: task.dueDate }),
      });
      if (!response.ok) throw new Error("Unable to update");
      await refresh();
      setToast(`${task.animalName}: ${task.title} marked missed`);
      window.setTimeout(() => setToast(null), 2800);
    } catch {
      setToast("That didn’t save. Please try again.");
    } finally {
      setBusyTask(null);
    }
  };

  const startFresh = async () => {
    if (!window.confirm("Start fresh from today?\n\nThe leftover tasks from earlier days will be cleared — counted as neither done nor missed — and Shed will track care from today forward. Completed history is kept.")) return;
    setBusyTask("__all__");
    try {
      const response = await fetch("/api/care/start-fresh", { method: "POST" });
      if (!response.ok) throw new Error("Unable to update");
      await refresh();
      notify("Fresh start — Shed is tracking from today.");
    } catch {
      setToast("That didn’t save. Please try again.");
    } finally {
      setBusyTask(null);
    }
  };

  // A skipped task has been dealt with: the keeper decided it did not need
  // doing. It leaves the list rather than sitting there asking to be actioned,
  // and it leaves the day's totals too, the same way it leaves the husbandry
  // score's denominator — otherwise skipping everything would show a day stuck
  // at 0% forever. It stays visible below, undoable, rather than vanishing.
  const skipped = data?.tasks.filter((task) => task.skippedAt && !task.complete) ?? [];
  const accountable = data?.tasks.filter((task) => !task.skippedAt || task.complete) ?? [];
  // Missed is settled work too: the keeper has said it is not happening. It
  // leaves the list like a skip does, but unlike a skip it stays in the day's
  // totals, because a missed task is a lapse and the day should not read as
  // complete without it.
  const missed = accountable.filter((task) => !task.complete && task.missedAt);
  const pending = accountable.filter((task) => !task.complete && !task.missedAt);
  const completed = accountable.filter((task) => task.complete);
  const overdue = data?.overdue ?? [];
  // When every scheduled item was intentionally skipped, the day is settled:
  // showing 0% made an empty to-do list look unfinished. The separate skipped
  // count keeps 100% from pretending that care was performed.
  const completionPercent = accountable.length
    ? Math.round((completed.length / accountable.length) * 100)
    : skipped.length ? 100 : 0;
  const filteredAnimals = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data?.animals ?? [];
    return (data?.animals ?? []).filter((animal) =>
      `${animal.name} ${animal.species} ${animal.morph ?? ""} ${animal.enclosureName ?? ""} ${animal.location}`.toLowerCase().includes(needle),
    );
  }, [data?.animals, query]);

  const accessCodeField = (
    <input
      type="password"
      value={accessCodeInput}
      onChange={(event) => setAccessCodeInput(event.target.value)}
      placeholder="Access code"
      aria-label="Access code"
      autoComplete="off"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
    />
  );

  return (
    <div className="app-shell">
      <aside className="desktop-rail" aria-label="Primary navigation">
        <div className="brand-mark" aria-hidden="true"><span /></div>
        <nav>
          {navItems.map((item) => (
            <button key={item.id} className={activeTab === item.id ? "active" : ""} onClick={() => openTab(item.id)}>
              <b>{item.glyph}</b><span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main>
        <header className="topbar">
          <button className="wordmark" onClick={() => openTab("today")} aria-label="Open today dashboard">
            <span className="mini-mark" aria-hidden="true" />
            <span><b>Shed</b><small>Good care shows</small></span>
          </button>
          {viewer ? (
            <div className="viewer-cluster">
              <button className="theme-toggle" onClick={toggleTheme} title={darkMode ? "Switch to day mode" : "Switch to night mode"} aria-label={darkMode ? "Switch to day mode" : "Switch to night mode"}>{darkMode ? "☾" : "☀"}</button>
              {earnerBalanceCents !== null && (
                <button className="balance-pill" onClick={() => openTab("more")} title="Your earnings balance">
                  <i aria-hidden="true">◍</i>{formatCents(earnerBalanceCents)}
                </button>
              )}
              <button className="role-chip" onClick={() => openTab("more")} title="Household & access">
                <span>{viewer.displayName.slice(0, 1).toUpperCase()}</span>{viewer.displayName}<em>{roleLabel(viewer.role)}</em>
              </button>
            </div>
          ) : (
            <div className="viewer-cluster">
              <button className="theme-toggle" onClick={toggleTheme} title={darkMode ? "Switch to day mode" : "Switch to night mode"} aria-label={darkMode ? "Switch to day mode" : "Switch to night mode"}>{darkMode ? "☾" : "☀"}</button>
              <button className="role-chip" onClick={() => openTab("more")}>
                <span>→</span>Sign in
              </button>
            </div>
          )}
        </header>

        {session?.setupRequired ? (
          <SetupGate
            onReady={(member, memberCapabilities) => {
              setSession((previous) => ({ authenticated: true, authRequired: previous?.authRequired ?? true, setupRequired: false, capabilities: memberCapabilities, member }));
              notify(`Welcome, ${member.displayName}`);
              setGuideOpen(true);
              void refresh().catch(() => undefined);
              void loadMembers();
              void loadReport();
            }}
          />
        ) : gateOpen ? (
          <section className="auth-gate">
            <div className="auth-card">
              <span className="mini-mark" aria-hidden="true" />
              <h1>Sign in to Shed</h1>
              <p>Enter your personal access code. Ask your Head Keeper if you need a new one.</p>
              <form onSubmit={signIn}>
                {accessCodeField}
                <button disabled={loginBusy}>{loginBusy ? "Checking…" : "Sign in"}</button>
              </form>
              {loginError && <p className="form-error" role="alert">{loginError}</p>}
            </div>
          </section>
        ) : !data ? (
          <section className="loading-state" aria-live="polite">
            <div className="loader" /><h1>Opening Shed…</h1>
          </section>
        ) : activeTab === "today" ? (
          <section className="page today-page">
            <div className="eyebrow">{formatDate(data.date)}</div>
            <div className="page-heading">
              <div><h1>Today’s care</h1><p>{pending.length ? (pending.length === 1 ? "1 thing still needs a keeper." : `${pending.length} things still need a keeper.`) : "Everything is tucked in for today."}</p></div>
              <div className="page-heading-actions">
                <button className="week-button" onClick={() => setWeekOpen(true)}>See the week</button>
                {can("records.manage") && <button className="quiet-button" onClick={() => openManager()}>Manage records</button>}
              </div>
            </div>

            {can("records.manage") && (data.setupSummary.animalCount === 0 || data.setupSummary.scheduleCount === 0) && (
              <article className="onboarding-card">
                <div><span className="onboarding-glyph">↗</span><p className="eyebrow">New keeper setup</p><h2>Let’s build your care list</h2><p>Add a habitat and its animal, then create a repeating care plan. Once a care plan exists, its tasks appear here on the right days.</p></div>
                <div className="onboarding-actions"><button onClick={() => setGuideOpen(true)}>Continue setup</button><button onClick={() => openManager(data.setupSummary.animalCount ? "schedule" : data.setupSummary.enclosureCount ? "animal" : "enclosure")}>Jump to next step</button></div>
              </article>
            )}

            <article className="progress-card">
              <div className="progress-copy">
                <span className="sun-disc" aria-hidden="true">☀</span>
                <div>
                  <strong>{accountable.length ? `${completed.length} of ${accountable.length} complete` : skipped.length ? `${skipped.length} skipped · today settled` : "Nothing scheduled"}</strong>
                  <span>{pending.length ? "A tidy little list today" : skipped.length ? "Skipped items are shown below" : accountable.length ? "All care completed" : "No scheduled care was due"}</span>
                </div>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={completionPercent}
                aria-valuetext={!accountable.length && skipped.length ? "Today’s care is settled; all scheduled items were skipped" : `${completed.length} of ${accountable.length} accountable tasks complete`}
              ><span style={{ width: `${completionPercent}%` }} /></div>
              <b>{completionPercent}%</b>
            </article>

            {(signedIn || !authRequired) && forecast && !forecast.reorderAcknowledged && (forecast.orderNeeded || forecast.warnings > 0) && (
              <div className="feeder-nudge">
                <button className="feeder-nudge-main" onClick={() => setForecastOpen(true)}>
                  <span className="feeder-nudge-icon" aria-hidden="true">⊘</span>
                  <div>
                    <b>{forecast.orderNeeded ? "Reorder feeders soon" : "Feeder forecast needs a look"}</b>
                    <small>{forecast.warnings > 0 ? `${forecast.warnings} thing${forecast.warnings === 1 ? "" : "s"} need attention` : "Some upcoming feeds aren’t covered"} · tap to review</small>
                  </div>
                  <span className="feeder-nudge-go" aria-hidden="true">›</span>
                </button>
                {can("feeders.manage") && forecast.orderNeeded && (
                  <button className="feeder-nudge-done" disabled={orderBusy} onClick={markOrderPlaced}>
                    {orderBusy ? "Saving…" : "I’ve placed an order"}
                  </button>
                )}
              </div>
            )}

            {overdue.length > 0 && (
              <>
                <div className="section-title compact"><h2>Overdue</h2><div className="section-actions"><span>{overdue.length} from earlier days</span>{can("care.startFresh") && <button disabled={busyTask === "__all__"} onClick={startFresh}>{busyTask === "__all__" ? "Clearing…" : "Start fresh from today"}</button>}</div></div>
                <div className="task-list">
                  {overdue.map((task) => (
                    <article className="task-card overdue" key={task.id}>
                      <div className="animal-badge" aria-hidden="true">{task.animalName.slice(0, 1)}</div>
                      <div className="task-copy">
                        <span>{task.species} · due {shortDate(task.dueDate)}</span><h3>{task.animalName}</h3><p><b>{task.title}</b>{taskDetails(task) ? ` · ${taskDetails(task)}` : ""}</p>
                      </div>
                      <div className="overdue-actions">
                        <button className="complete-button" disabled={busyTask === task.id} onClick={() => completeTask(task)}>{busyTask === task.id ? "Saving…" : "Mark done"}<span>✓</span></button>
                        <div className="task-alt-actions">
                          {task.taskType === "feeding" && <button className="refuse-button" disabled={busyTask === task.id} onClick={() => refuseMeal(task)}>Refused</button>}
                          <button className="skip-button" disabled={busyTask === task.id} onClick={() => skipTask(task)}>Skip</button>
                          {can("care.miss") && <button className="miss-button" disabled={busyTask === task.id} onClick={() => missTask(task)}>Missed</button>}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}

            <div className="section-title"><h2>Up next</h2><span>{pending.length} remaining</span></div>
            <div className="task-list">
              {pending.map((task) => (
                <article className="task-card" key={task.id}>
                  <div className="animal-badge" aria-hidden="true">{task.animalName.slice(0, 1)}</div>
                  <div className="task-copy">
                    <span>
                      {task.species}
                      {/* Only worth saying when the task is riding its window —
                          on its own due date it is simply today's work. */}
                      {data && (task.graceDays ?? 0) > 0 && task.dueDate < data.date
                        && ` · due ${shortDate(task.dueDate)}, through ${shortDate(taskLastDay(task.dueDate, task.graceDays ?? 0))}`}
                    </span><h3>{task.animalName}</h3><p><b>{task.title}</b>{taskDetails(task) ? ` · ${taskDetails(task)}` : ""}</p>
                  </div>
                  <div className="task-actions">
                    <button className="complete-button" disabled={busyTask === task.id} onClick={() => completeTask(task)}>
                      {busyTask === task.id ? "Saving…" : "Mark done"}<span>✓</span>
                    </button>
                    <div className="task-alt-actions">
                      {task.taskType === "feeding" && (
                        <button className="refuse-button" disabled={busyTask === task.id} onClick={() => refuseMeal(task)}>Refused</button>
                      )}
                      <button className="skip-button" disabled={busyTask === task.id} onClick={() => skipTask(task)}>Skip</button>
                      {/* Missed belongs on today's card as well as on overdue ones.
                          A keeper knows at ten at night that the animal is asleep and
                          the pellets are not happening; making them wait until
                          tomorrow leaves the task on today's list pretending it might
                          still get done, and the day never reads as settled. */}
                      {can("care.miss") && <button className="miss-button" disabled={busyTask === task.id} onClick={() => missTask(task)}>Missed</button>}
                    </div>
                  </div>
                </article>
              ))}
              {!pending.length && <div className="empty-card"><span>✓</span><h3>That’s everything</h3><p>There are no remaining scheduled tasks today.</p></div>}
            </div>

            <div className="section-title compact"><h2>Completed today</h2><span>{completed.length}</span></div>
            <div className="completed-list">
              {completed.map((task) => (
                <div key={task.id}>
                  <span>✓</span>
                  <b>{task.animalName}</b>
                  <p>{task.title}{task.outcome === "refused" ? " · refused" : ""}{task.completedBy ? ` · ${task.completedBy}` : ""}</p>
                  {can("care.correct") && (
                    <span className="completion-correction-actions">
                      {authRequired && (
                        <button disabled={busyTask === task.id} onClick={() => openAttributionCorrection(task)}>
                          Change keeper
                        </button>
                      )}
                      <button className="mark-not-done" disabled={busyTask === task.id} onClick={() => void undoTask(task)}>
                        {busyTask === task.id ? "Saving…" : "Mark not done"}
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Marked missed during the day rather than discovered overdue the
                next morning. Still correctable: if it happened after all, Mark
                done clears the miss. */}
            {missed.length > 0 && (
              <>
                <div className="section-title compact"><h2>Missed today</h2><span>{missed.length}</span></div>
                <div className="completed-list missed-list">
                  {missed.map((task) => (
                    <div key={task.id}>
                      <span>!</span>
                      <b>{task.animalName}</b>
                      <p>{task.title}{task.missedBy ? ` · ${task.missedBy}` : ""}</p>
                      <span className="completion-correction-actions">
                        <button disabled={busyTask === task.id} onClick={() => void completeTask(task)}>
                          {busyTask === task.id ? "Saving…" : "Actually done"}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Skipped work is off the list but not hidden: the keeper should be
                able to see what they set aside today, and change their mind. */}
            {skipped.length > 0 && (
              <>
                <div className="section-title compact"><h2>Skipped today</h2><span>{skipped.length}</span></div>
                <div className="completed-list skipped-list">
                  {skipped.map((task) => (
                    <div key={task.id}>
                      <span>–</span>
                      <b>{task.animalName}</b>
                      <p>{task.title}{task.skipReason ? ` · ${task.skipReason}` : ""}</p>
                      {can("care.complete") && (
                        <span className="completion-correction-actions">
                          <button disabled={busyTask === task.id} onClick={() => void unskipTask(task)}>
                            {busyTask === task.id ? "Saving…" : "Put back"}
                          </button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="section-title compact"><h2>Recent activity</h2><button onClick={() => openTab("animals")}>View all</button></div>
            <div className="activity-list">
              {data.recentEvents.slice(0, 6).map((event) => (
                <div key={event.id}><span className="activity-dot" /><p><b>{event.animalName}</b> · {event.title}{event.outcome === "refused" ? " · refused" : ""}<small>{event.completedBy ?? event.actorRole} · {timeAgo(event.occurredAt)}</small></p></div>
              ))}
            </div>
          </section>
        ) : activeTab === "animals" ? (
          <section className="page">
            <div className="eyebrow">The whole household</div>
            <div className="page-heading"><div><h1>Animals & habitats</h1><p>{data.animals.length} individual and community records.</p></div></div>
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <span className="sr-only">Search animals, species, or rooms</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search animals, species, or rooms" />
            </label>
            <div className="animal-grid">
              {filteredAnimals.map((animal) => {
                const photo = animalPhotoUrl(animal.id, animal.photoUpdatedAt);
                const facts = animalFacts(animal, data.date);
                return (
                  <article className="animal-card" key={animal.id} role="button" tabIndex={0} onClick={() => setProfileId(animal.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setProfileId(animal.id); } }}>
                    <div className="animal-photo">
                      {photo
                        // Portraits come from our own API already downscaled; next/image would only add a hop.
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={photo} alt={animal.name} loading="lazy" decoding="async" />
                        : <span className="animal-photo-glyph" aria-hidden>{speciesGlyph(animal.species, animal.group)}</span>}
                      <small className="animal-group">{animal.group}</small>
                    </div>
                    <div className="animal-card-body">
                      <h2>{animal.name}</h2>
                      <p>{animal.species}{animal.morph ? ` · ${animal.morph}` : ""}</p>
                      {facts.length > 0 && <div className="animal-meta">{facts.map((fact) => <span key={fact.label}>{fact.symbol && <i className="chip-mark" aria-hidden>{fact.symbol}</i>}{fact.label}</span>)}</div>}
                    </div>
                  </article>
                );
              })}
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
              {viewer ? (
                <>
                  <div>
                    <span className="settings-icon">{viewer.displayName.slice(0, 1).toUpperCase()}</span>
                    <div>
                      <h2>{viewer.displayName}</h2>
                      <p>{roleLabel(viewer.role)} · {viewer.role === "Owner" ? "Full access to schedules, records, exports, and household access." : "Can view animals and record completed care. Schedules, exports, and history edits stay with the Head Keeper."}</p>
                    </div>
                  </div>
                  {signedIn && <button onClick={signOut}>Sign out</button>}
                </>
              ) : (
                <>
                  <div>
                    <span className="settings-icon">→</span>
                    <div>
                      <h2>Sign in</h2>
                      <p>Sign in with your access code so completed care is recorded under your name.</p>
                    </div>
                  </div>
                  <div className="panel-login">
                    <form className="inline-login" onSubmit={signIn}>
                      {accessCodeField}
                      <button disabled={loginBusy}>{loginBusy ? "Checking…" : "Sign in"}</button>
                    </form>
                    {loginError && <p className="form-error" role="alert">{loginError}</p>}
                  </div>
                </>
              )}
            </article>

            <div className="settings-grid">
              {can("records.manage") && <article className="settings-card"><span className="settings-icon">?</span><h2>Getting started</h2><p>Follow the setup checklist and learn where recurring care, one-time history, notes, equipment, and weights belong.</p><button onClick={() => setGuideOpen(true)}>Open guide</button></article>}
              {can("records.manage") && <article className="settings-card"><span className="settings-icon">☷</span><h2>Manage records</h2><p>Add and edit animals, enclosures, care plans, notes, equipment, weights, feeders, and history.</p><button onClick={() => openManager()}>Open manager</button></article>}
              <article className="settings-card"><span className="settings-icon">◷</span><h2>Feeding forecast</h2><p>Upcoming feeds by animal, which feeder in stock covers each, shortage dates, and when to reorder.</p><button onClick={() => setForecastOpen(true)}>Open forecast</button></article>
              {can("feeders.manage") && <article className="settings-card"><span className="settings-icon">＋</span><h2>Bulk add feeders</h2><p>Paste a shipment of individual gram weights into inventory at once.</p><button onClick={() => setBulkFeedersOpen(true)}>Add weighed feeders</button></article>}
              {can("records.export") && (
                <article className="settings-card"><span className="settings-icon">↥</span><h2>Your data, always portable</h2><p>Download a complete open-format copy any time — stable identifiers, ISO dates, numeric gram values.</p><div className="export-actions"><a href="/api/export?format=json">Download JSON</a><a href="/api/export?format=csv">Download CSV</a></div></article>
              )}
            </div>

            {can("records.manage") && (
              <article className="settings-card wide">
                <span className="settings-icon">↺</span>
                <h2>Restore from backup</h2>
                <p>Load a Shed JSON export. Merge keeps your current data and adds the backup on top; replace wipes husbandry data first (household sign-in stays intact).</p>
                <RestorePanel onDone={() => void refresh().catch(() => undefined)} toast={notify} />
              </article>
            )}

            {can("household.manage") && (
              <article className="settings-card wide">
                <span className="settings-icon">⌗</span>
                <h2>Household access</h2>
                <p>Every member of the household gets their own name and private access code, so completed care is credited to the right keeper.</p>

                <div className="earn-default">
                  <div>
                    <b>Task earnings</b>
                    <small>Turn on “Earning” for a keeper and they earn money as they mark tasks done. Balance shows by their name.</small>
                  </div>
                  <form className="earn-form" onSubmit={saveDefaultReward}>
                    <label>Default per task<span className="dollar"><i>$</i><input type="number" step="0.01" min="0" value={rewardInput} onChange={(event) => setRewardInput(event.target.value)} aria-label="Default reward per task in dollars" /></span></label>
                    <button disabled={rewardBusy}>{rewardBusy ? "Saving…" : "Save"}</button>
                  </form>
                </div>
                {invite && (
                  <div className="invite-reveal" role="status">
                    <b>Access code for {invite.displayName}</b>
                    <code>{invite.accessCode}</code>
                    <div className="invite-actions">
                      <button onClick={copyInvite}>Copy code</button>
                      <button onClick={() => setInvite(null)}>Done — I saved it</button>
                    </div>
                    <small>This code is shown only once. Share it privately; a new one can be issued any time.</small>
                  </div>
                )}
                {members ? (
                  <>
                    <div className="member-list">
                      {members.map((member) => (
                        <div className="member-row" key={member.id}>
                          <span className="member-avatar">{member.displayName.slice(0, 1).toUpperCase()}</span>
                          <div>
                            <b>{member.displayName}{!member.active && <i> · disabled</i>}{member.earningEnabled && <span className="earn-balance">{formatCents(member.balanceCents)}</span>}</b>
                            <small>{roleLabel(member.role)}{member.lastLoginAt ? ` · last signed in ${timeAgo(member.lastLoginAt)}` : " · never signed in"}{member.earningEnabled ? ` · earned ${formatCents(member.earnedCents)}` : ""}</small>
                          </div>
                          <div className="member-actions">
                            <button
                              className={member.earningEnabled ? "on" : ""}
                              disabled={memberBusy === member.id}
                              onClick={() => void patchMember(member, { earningEnabled: !member.earningEnabled })}
                              title="Earn money for completed tasks"
                            >
                              {member.earningEnabled ? "Earning ✓" : "Earning off"}
                            </button>
                            {member.earningEnabled && member.balanceCents > 0 && (
                              <button className="pay" disabled={memberBusy === member.id} onClick={() => void payOut(member)}>Pay out</button>
                            )}
                            <button
                              disabled={memberBusy === member.id}
                              onClick={() => {
                                if (window.confirm(`Issue a new access code for ${member.displayName}? The current code stops working immediately.`)) {
                                  void patchMember(member, { reissueAccessCode: true });
                                }
                              }}
                            >
                              New code
                            </button>
                            {member.role !== "Owner" && (
                              <button
                                disabled={memberBusy === member.id}
                                onClick={() => {
                                  if (member.active && !window.confirm(`Disable ${member.displayName}’s access? They can be re-enabled later.`)) return;
                                  void patchMember(member, { active: !member.active });
                                }}
                              >
                                {member.active ? "Disable" : "Enable"}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <form className="member-add" onSubmit={createMember}>
                      <input
                        value={newMemberName}
                        onChange={(event) => setNewMemberName(event.target.value)}
                        placeholder="New keeper’s name"
                        aria-label="New keeper’s name"
                        maxLength={40}
                      />
                      <button disabled={memberBusy === "create" || !newMemberName.trim()}>{memberBusy === "create" ? "Adding…" : "Add keeper"}</button>
                    </form>
                  </>
                ) : (
                  <p className="member-note">{signedIn ? "Loading household members…" : "Sign in with the Head Keeper code to manage household access."}</p>
                )}
                {membersError && <p className="form-error" role="alert">{membersError}</p>}
              </article>
            )}

            {can("household.manage") && (
              <article className="settings-card wide">
                <span className="settings-icon">✶</span>
                <h2>Contributions</h2>
                <p>Scheduled tasks completed by each member of the household — handy for allowance day.</p>
                {report ? (
                  <>
                    <form
                      className="report-range"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void loadReport(reportFrom, reportTo);
                      }}
                    >
                      <label>From<input type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} /></label>
                      <label>To<input type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)} /></label>
                      <button disabled={reportBusy}>{reportBusy ? "Loading…" : "Update"}</button>
                    </form>
                    {report.contributions.length ? (
                      <div className="contrib-list">
                        {report.contributions.map((contribution) => (
                          <div key={contribution.memberId}>
                            <span>{contribution.displayName.slice(0, 1).toUpperCase()}</span>
                            <b>{contribution.displayName}</b>
                            <i>{contribution.taskCount} task{contribution.taskCount === 1 ? "" : "s"}</i>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="member-note">No attributed completions in this range yet. Once keepers sign in, their completed tasks show up here.</p>
                    )}
                    {report.completions.length > 0 && (
                      <details className="report-details">
                        <summary>All {report.completions.length} completion{report.completions.length === 1 ? "" : "s"}</summary>
                        <div>
                          {report.completions.map((row) => (
                            <p key={row.eventId}><b>{row.completedBy}</b> · {row.animalName} · {row.title} <small>{timeAgo(row.completedAt)}</small></p>
                          ))}
                        </div>
                      </details>
                    )}
                  </>
                ) : (
                  <p className="member-note">{signedIn ? "Loading the report…" : "Sign in with the Head Keeper code to see the report."}</p>
                )}
                {reportError && <p className="form-error" role="alert">{reportError}</p>}
              </article>
            )}

            <footer className="about-footer">
              <div className="about-brand">
                <span className="mini-mark" aria-hidden="true" />
                <div>
                  <b>Shed</b>
                  <span>Good care shows.</span>
                </div>
              </div>
              <nav className="about-links" aria-label="Project links">
                <a href="https://animalroom.app/shed/" target="_blank" rel="noreferrer">Project page</a>
                <a href="https://github.com/jlyfshhh/shed" target="_blank" rel="noreferrer">GitHub</a>
                <a href="https://ko-fi.com/jlyfshhh" target="_blank" rel="noreferrer">🦗 Buy the animals crickets</a>
              </nav>
              <p className="about-credit">
                Lighting plans import from{" "}
                <a href="https://lightmyreptile.com/" target="_blank" rel="noreferrer">Light My Reptile</a>, an
                independent reptile lighting planner. Thanks to its developer for the share-link format.
              </p>
              <p className="about-fine">
                Free and open-source under the MIT license. A recordkeeping aid, not veterinary advice — verify
                husbandry targets against trusted sources.
              </p>
            </footer>

          </section>
        )}

        <nav className="mobile-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <button key={item.id} className={activeTab === item.id ? "active" : ""} onClick={() => openTab(item.id)}><b>{item.glyph}</b><span>{item.label}</span></button>
          ))}
        </nav>
      </main>

      {toast && <div className="toast" role="status" aria-live="polite" data-modal-live>{toast}</div>}

      {manageOpen && can("records.manage") && (
        <ManageConsole
          onClose={() => {
            setManageOpen(false);
            // Came from an animal's profile — go back to it, so the keeper sees
            // what they just changed instead of landing on the grid.
            if (manageFocusAnimal) setProfileId(manageFocusAnimal);
            setManageFocusAnimal(undefined);
          }}
          onChanged={() => { void refresh().catch(() => undefined); void loadForecast().catch(() => undefined); }}
          toast={notify}
          initialResource={manageStart}
          focusAnimalId={manageFocusAnimal}
        />
      )}
      {guideOpen && data && can("records.manage") && (
        <GettingStartedGuide
          summary={data.setupSummary}
          onClose={() => setGuideOpen(false)}
          onOpenManager={(resource) => { setGuideOpen(false); openManager(resource); }}
          onOpenHousehold={() => { setGuideOpen(false); openTab("more"); }}
        />
      )}
      {profileId && (
        <AnimalProfile
          animalId={profileId}
          onClose={() => setProfileId(null)}
          onEdit={can("records.manage") ? () => { const id = profileId; setProfileId(null); openManager("animal", id); } : undefined}
          canWritePhoto={can("animal.photo.write")}
          canRecordWeight={can("weights.record")}
          canRecordShed={can("sheds.record")}
          onPhotoChange={() => { void refresh().catch(() => undefined); }}
        />
      )}
      {weekOpen && <WeekView onClose={() => setWeekOpen(false)} />}
      {forecastOpen && <FeederForecast onClose={() => { setForecastOpen(false); void loadForecast().catch(() => undefined); }} />}
      {bulkFeedersOpen && can("feeders.manage") && <BulkFeederIntake onClose={() => setBulkFeedersOpen(false)} onSaved={(message) => { setBulkFeedersOpen(false); notify(message); void refresh().catch(() => undefined); void loadForecast().catch(() => undefined); }} />}
      {timingTask && data && (
        <div className="sheet-backdrop attribution-backdrop" role="dialog" aria-modal="true" aria-labelledby="timing-title" onClick={() => setTimingTask(null)}>
          <div className="sheet attribution-sheet" onClick={(event) => event.stopPropagation()}>
            <header className="sheet-head">
              <div>
                <h2 id="timing-title">When did this happen?</h2>
                <p>{timingTask.task.animalName} · {timingTask.task.title}</p>
              </div>
              <button type="button" className="sheet-close" onClick={() => setTimingTask(null)} aria-label="Close">✕</button>
            </header>
            <div className="attribution-body">
              <div className="correction-notice">
                <b>This was due {formatDate(timingTask.task.dueDate)}.</b>
                <span>Any answer records the care. It only sets the date this shows under in {timingTask.task.animalName}’s history.</span>
              </div>
              {/* The two buttons cover the common cases; the picker exists because
                  care given on neither of those days is just as ordinary — fed on
                  Sunday, due Friday, logged Monday. */}
              {timingTask.task.dueDate !== data.date && (
                <label>
                  <span>Or another day</span>
                  <input
                    type="date"
                    min={timingTask.task.dueDate}
                    max={data.date}
                    value={timingDate}
                    onChange={(event) => setTimingDate(event.target.value)}
                  />
                  <small>Between {shortDate(timingTask.task.dueDate)} and today.</small>
                </label>
              )}
              {timingDate && (timingDate < timingTask.task.dueDate || timingDate > data.date) && (
                <p className="form-error" role="alert">
                  Pick a day between {shortDate(timingTask.task.dueDate)} and today.
                </p>
              )}
              <div className="sheet-actions">
                {timingDate && timingDate >= timingTask.task.dueDate && timingDate <= data.date
                  && timingDate !== timingTask.task.dueDate && timingDate !== data.date && (
                  <button
                    type="button"
                    disabled={busyTask === timingTask.task.id}
                    onClick={() => recordCompletion(timingTask.task, timingTask.outcome, timingDate)}
                  >
                    {busyTask === timingTask.task.id ? "Saving…" : `On ${shortDate(timingDate)}`}
                  </button>
                )}
                <button
                  type="button"
                  className="ghost"
                  disabled={busyTask === timingTask.task.id}
                  onClick={() => recordCompletion(timingTask.task, timingTask.outcome, timingTask.task.dueDate)}
                >
                  On {shortDate(timingTask.task.dueDate)}
                </button>
                <button
                  type="button"
                  disabled={busyTask === timingTask.task.id}
                  onClick={() => recordCompletion(timingTask.task, timingTask.outcome, data.date)}
                >
                  {busyTask === timingTask.task.id ? "Saving…" : "Today"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {attributionTask && can("care.correct") && (
        <div className="sheet-backdrop attribution-backdrop" role="dialog" aria-modal="true" aria-labelledby="attribution-title" onClick={() => setAttributionTask(null)}>
          <form className="sheet attribution-sheet" onSubmit={correctAttribution} onClick={(event) => event.stopPropagation()}>
            <header className="sheet-head">
              <div>
                <h2 id="attribution-title">Change who gets credit</h2>
                <p>{attributionTask.animalName} · {attributionTask.title}</p>
              </div>
              <button type="button" className="sheet-close" onClick={() => setAttributionTask(null)} aria-label="Close">✕</button>
            </header>
            <div className="attribution-body">
              <div className="correction-notice">
                <b>The care stays completed.</b>
                <span>Only the credited keeper changes. Any feeder deduction and the original task reward stay attached to this completion.</span>
              </div>
              <label>
                <span>Credit this completion to</span>
                <select required disabled={!members} value={attributionMemberId} onChange={(event) => setAttributionMemberId(event.target.value)}>
                  <option value="">Choose a household member</option>
                  {(members ?? []).filter((member) => member.active).map((member) => (
                    <option key={member.id} value={member.id}>{member.displayName} · {roleLabel(member.role)}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Audit note</span>
                <input maxLength={500} value={attributionReason} onChange={(event) => setAttributionReason(event.target.value)} />
              </label>
              {!members && <p className="member-note">Loading household members…</p>}
              {membersError && <p className="form-error" role="alert">{membersError}</p>}
              <div className="sheet-actions">
                <button type="button" className="ghost" onClick={() => setAttributionTask(null)}>Cancel</button>
                <button disabled={busyTask === attributionTask.id || !attributionMemberId || attributionMemberId === attributionTask.completedByMemberId}>
                  {busyTask === attributionTask.id ? "Saving…" : "Move completion credit"}
                </button>
              </div>
              {attributionMemberId === attributionTask.completedByMemberId && (
                <small className="same-keeper-note">Choose someone other than the currently credited keeper.</small>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
