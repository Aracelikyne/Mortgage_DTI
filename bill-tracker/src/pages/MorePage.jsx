import { ArrowUpDown, Bell, CopyCheck, FileUp, FlaskConical, NotebookPen } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { ListButton, ListRow, ListSection } from "../components/ui/List";
import Switch from "../components/ui/Switch";
import SegmentedControl from "../components/ui/SegmentedControl";
import { THEME_OPTIONS } from "../hooks/useTheme";
import { syncStatusText } from "../utils/sync";
import { SECTION_COLORS } from "../data/nav";
import { useHouseholdContext } from "../state/HouseholdContext";

// iOS caps the tab bar at five, so on phones everything past the first four
// sections lands here, along with the tools and settings that used to sit
// in the header.
export default function MorePage() {
  const h = useHouseholdContext();
  return (
    <>
      <PageHeader title="More" />
      <div className="page-content">
        {h.moreItems.length > 0 && (
          <ListSection>
            {h.moreItems.map((item) => {
              const Icon = item.icon;
              return (
                <ListRow
                  key={item.key}
                  icon={<Icon size={17} />}
                  iconColor={SECTION_COLORS[item.key]}
                  title={item.label}
                  onClick={() => h.setPage(item.key)}
                />
              );
            })}
          </ListSection>
        )}

        <ListSection header="Tools">
          <ListRow icon={<FileUp size={17} />} iconColor="var(--green)" title="Import from Numbers" onClick={() => h.openImport("statement")} />
          <ListRow icon={<CopyCheck size={17} />} iconColor="var(--indigo)" title="Duplicates" detail={h.duplicateGroups.length || null} onClick={h.openDuplicates} />
          <ListRow icon={<NotebookPen size={17} />} iconColor="var(--yellow-icon)" title="Shared Notes" detail={h.notes.notes.length || null} onClick={h.openNotes} />
          <ListRow icon={<ArrowUpDown size={17} />} iconColor="var(--gray)" title="Reorder Tabs" onClick={h.openTabOrder} />
        </ListSection>

        <ListSection
          header="Settings"
          footer="Reminders come 3 days before a bill is due, on the due date, and the day after if it isn't marked paid (autopay bills just get the 3-day heads-up). They're per device — turning them on here doesn't change the other person's. Sandbox lets you try numbers without saving anything; it all reverts when you turn it off."
        >
          {h.push.supported && (
            <div className="row has-icon switch-row">
              <span className="row-icon" style={{ background: "var(--red)" }}><Bell size={17} /></span>
              <span className="row-body"><span className="row-title">Bill reminders</span></span>
              <Switch checked={h.push.subscribed} disabled={h.push.busy} onChange={h.push.setEnabled} label="Bill reminders" />
            </div>
          )}
          {h.push.needsHomeScreen && (
            <ListRow
              icon={<Bell size={17} />}
              iconColor="var(--red)"
              title="Bill reminders"
              subtitle="Tap Share → Add to Home Screen, open Clear to Close from there, and the switch shows up here."
            />
          )}
          <div className="row has-icon switch-row">
            <span className="row-icon" style={{ background: "var(--orange)" }}><FlaskConical size={17} /></span>
            <span className="row-body"><span className="row-title">Sandbox</span></span>
            <Switch checked={h.sandboxActive} disabled={h.spectating} onChange={(on) => (on ? h.enterSandbox() : h.exitSandbox())} label="Sandbox" />
          </div>
        </ListSection>

        <ListSection header="Appearance" footer="System follows your phone's Light/Dark setting. Saved on this device only.">
          <div className="row segmented-row">
            <SegmentedControl options={THEME_OPTIONS} value={h.theme} onChange={h.setTheme} label="Appearance" />
          </div>
        </ListSection>

        <ListSection header="Sync" footer="Changes save automatically and show up on the other person's device right away.">
          <ListRow title={syncStatusText(h.saveStatus, h.lastEditedBy)} />
        </ListSection>

        <ListSection>
          <ListButton destructive onClick={h.signOut}>Sign Out ({h.userName})</ListButton>
        </ListSection>
      </div>
    </>
  );
}

