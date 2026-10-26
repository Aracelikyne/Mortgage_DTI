import { useCallback, useMemo, useState } from "react";
import { ArrowUpDown, Bell, Ellipsis, FileUp, FlaskConical, LogOut, NotebookPen } from "lucide-react";
import Sidebar from "./ui/Sidebar";
import TabBar from "./ui/TabBar";
import Switch from "./ui/Switch";
import CursorOverlay from "./CursorOverlay";
import NotesSheet from "./NotesSheet";
import TabOrderSheet from "./TabOrderSheet";
import ImportSheet from "./ImportSheet";
import DashboardPage from "../pages/DashboardPage";
import BudgetPage from "../pages/BudgetPage";
import TimelinePage from "../pages/TimelinePage";
import PaycheckPage from "../pages/PaycheckPage";
import DebtsPage from "../pages/DebtsPage";
import FixedPage from "../pages/FixedPage";
import MonthlyPlanPage from "../pages/MonthlyPlanPage";
import ExpensesPage from "../pages/ExpensesPage";
import ActivityPage from "../pages/ActivityPage";
import MorePage from "../pages/MorePage";
import { HouseholdContext } from "../state/HouseholdContext";
import { NAV_ITEMS, TAB_BAR_SLOTS } from "../data/nav";
import { useHousehold } from "../hooks/useHousehold";
import { useFinanceModel } from "../hooks/useFinanceModel";
import { useHouseholdActions } from "../hooks/useHouseholdActions";
import { useLiveFollow } from "../hooks/useLiveFollow";
import { useMediaQuery, WIDE_LAYOUT } from "../hooks/useMediaQuery";
import { useStoredState } from "../hooks/useStoredState";
import { usePushReminders } from "../hooks/usePushReminders";
import { useNotes } from "../hooks/useNotes";
import { THEME_OPTIONS, useTheme } from "../hooks/useTheme";
import SegmentedControl from "./ui/SegmentedControl";
import { syncStatusText } from "../utils/sync";
import { supabase } from "../lib/supabaseClient";

const PAGES = {
  dashboard: DashboardPage,
  budget: BudgetPage,
  timeline: TimelinePage,
  paycheck: PaycheckPage,
  debts: DebtsPage,
  fixed: FixedPage,
  monthly: MonthlyPlanPage,
  expenses: ExpensesPage,
  activity: ActivityPage,
  more: MorePage,
};

// The signed-in app: shared data + sync (useHousehold), the numbers derived
// from it, live follow, and the iOS chrome around whichever page is open —
// a tab bar on phones, a sidebar on iPad/desktop.
export default function AppShell({ saved, userId, userName, initialLastEditedBy, initialPendingIdRepair, loadError }) {
  const [page, setPageState] = useState("dashboard");
  const isWide = useMediaQuery(WIDE_LAYOUT);

  // Fires directly from the incoming broadcast (inside useLiveFollow), not
  // from an effect reacting to state afterward — mirrors whoever we're
  // following: their page switch, and their scroll position within it.
  function handleLeaderUpdate(payload) {
    setPageState(payload.page);
    const doc = document.documentElement;
    const maxScroll = Math.max(1, doc.scrollHeight - doc.clientHeight);
    window.scrollTo(0, payload.scrollFrac * maxScroll);
  }
  const live = useLiveFollow({ userId, userName, page, onLeaderUpdate: handleLeaderUpdate });
  const spectating = !!live.followingId;

  const household = useHousehold({ saved, userId, userName, initialLastEditedBy, initialPendingIdRepair, spectating });
  const model = useFinanceModel(household);
  const actions = useHouseholdActions(household, model);
  const push = usePushReminders({ userId, userName });
  const notes = useNotes({ userId, userName });
  const [theme, setTheme] = useTheme();
  const [showNotes, setShowNotes] = useState(false);
  const [showTabOrder, setShowTabOrder] = useState(false);
  const [importTarget, setImportTarget] = useState(null); // "debts" | "fixed" | "expenses" while the import sheet is open

  // Per-device preferences — which tabs matter most, and whether the
  // sidebar is collapsed, don't need to match between two people.
  const [navOrder, setNavOrder] = useStoredState("ctc-nav-order", NAV_ITEMS.map((n) => n.key));
  const [sidebarCollapsed, setSidebarCollapsed] = useStoredState("ctc-sidebar-collapsed", false);
  // A saved order can predate a section being added/removed — known keys
  // keep their saved order, anything new lands at the end instead of
  // vanishing from the nav entirely.
  const orderedNavItems = useMemo(() => {
    const byKey = new Map(NAV_ITEMS.map((n) => [n.key, n]));
    const saved = Array.isArray(navOrder) ? navOrder : [];
    const known = saved.map((k) => byKey.get(k)).filter(Boolean);
    const missing = NAV_ITEMS.filter((n) => !saved.includes(n.key));
    return [...known, ...missing];
  }, [navOrder]);
  const tabItems = orderedNavItems.slice(0, TAB_BAR_SLOTS);
  const moreItems = orderedNavItems.slice(TAB_BAR_SLOTS);

  // User navigation starts the new page at the top; following someone
  // goes through handleLeaderUpdate instead, which sets their scroll.
  const navigate = useCallback((key) => {
    setPageState(key);
    window.scrollTo(0, 0);
  }, []);

  const { follow, unfollow } = live;
  const { refetchHousehold, setRemoteChangePending } = household;
  const followUser = useCallback((targetId, targetName) => {
    follow(targetId, targetName);
    refetchHousehold();
    setRemoteChangePending(false); // the refetch above already catches up
  }, [follow, refetchHousehold, setRemoteChangePending]);

  const value = {
    ...household,
    ...model,
    ...actions,
    userId,
    userName,
    loadError,
    page,
    setPage: navigate,
    isWide,
    moreItems,
    moreKeys: moreItems.map((n) => n.key),
    spectating,
    followingId: live.followingId,
    followingName: live.followingName,
    onlineUsers: live.onlineUsers,
    followedByNames: live.followedByNames,
    followUser,
    unfollow,
    push,
    notes,
    openNotes: () => setShowNotes(true),
    openTabOrder: () => setShowTabOrder(true),
    openImport: (target = "debts") => setImportTarget(target),
    theme,
    setTheme,
    signOut: () => supabase.auth.signOut(),
  };

  const Page = PAGES[page] || DashboardPage;
  const tabActive = tabItems.some((n) => n.key === page) ? page : "more";

  return (
    <HouseholdContext.Provider value={value}>
      <div className="app">
        <Sidebar
          title="Clear to Close"
          items={orderedNavItems}
          activeKey={page}
          onSelect={navigate}
          collapsed={!!sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
          footer={syncStatusText(household.saveStatus, household.lastEditedBy)}
        >
          {!sidebarCollapsed && (
            <div className="sidebar-section">
              <div className="sidebar-section-title">Tools</div>
              <button type="button" className="sidebar-item" onClick={() => setImportTarget(page === "expenses" ? "expenses" : "statement")}>
                <FileUp size={21} aria-hidden="true" /><span className="sidebar-label">Import from Numbers</span>
              </button>
              <button type="button" className="sidebar-item" onClick={() => setShowNotes(true)}>
                <NotebookPen size={21} aria-hidden="true" /><span className="sidebar-label">Shared Notes</span>
                {notes.notes.length > 0 && <span className="sidebar-count num">{notes.notes.length}</span>}
              </button>
              <button type="button" className="sidebar-item" onClick={() => setShowTabOrder(true)}>
                <ArrowUpDown size={21} aria-hidden="true" /><span className="sidebar-label">Reorder Tabs</span>
              </button>
              {push.supported && (
                <div className="sidebar-item sidebar-switch">
                  <Bell size={21} aria-hidden="true" /><span className="sidebar-label">Bill reminders</span>
                  <Switch checked={push.subscribed} disabled={push.busy} onChange={push.setEnabled} label="Bill reminders" />
                </div>
              )}
              {!spectating && (
                <div className="sidebar-item sidebar-switch">
                  <FlaskConical size={21} aria-hidden="true" /><span className="sidebar-label">Sandbox</span>
                  <Switch checked={household.sandboxActive} onChange={(on) => (on ? household.enterSandbox() : household.exitSandbox())} label="Sandbox" />
                </div>
              )}
              <div className="sidebar-appearance">
                <SegmentedControl options={THEME_OPTIONS} value={theme} onChange={setTheme} label="Appearance" />
              </div>
              <button type="button" className="sidebar-item destructive" onClick={value.signOut}>
                <LogOut size={21} aria-hidden="true" /><span className="sidebar-label">Sign Out ({userName})</span>
              </button>
            </div>
          )}
        </Sidebar>

        <main className={`app-main ${spectating ? "spectating" : ""}`}>
          <Page key={page} />
        </main>

        {!isWide && (
          <TabBar
            items={[
              ...tabItems.map((n) => ({ key: n.key, label: n.tab, icon: n.icon })),
              { key: "more", label: "More", icon: Ellipsis },
            ]}
            activeKey={tabActive}
            onSelect={navigate}
          />
        )}
      </div>

      <CursorOverlay leaderState={live.leaderState} currentPage={page} />

      {showNotes && (
        <NotesSheet notes={notes.notes} loadError={notes.loadError} onAdd={notes.addNote} onRemove={notes.removeNote} onClose={() => setShowNotes(false)} />
      )}
      {importTarget && <ImportSheet initialTarget={importTarget} onClose={() => setImportTarget(null)} />}
      {showTabOrder && (
        <TabOrderSheet items={orderedNavItems} onClose={() => setShowTabOrder(false)} onSave={setNavOrder} />
      )}
    </HouseholdContext.Provider>
  );
}
