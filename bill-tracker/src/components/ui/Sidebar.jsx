import { PanelLeft } from "lucide-react";

// iPadOS-style sidebar for wide screens: a title, the sections as rounded
// rows (the current one filled with the tint color), and room below for
// settings. Collapses to an icon rail — a per-device preference.
export default function Sidebar({ title, items, activeKey, onSelect, collapsed, onToggleCollapsed, children, footer }) {
  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`} aria-label="Sections">
      <div className="sidebar-head">
        {!collapsed && <div className="sidebar-title">{title}</div>}
        <button type="button" className="nav-btn sidebar-toggle" onClick={onToggleCollapsed} aria-label={collapsed ? "Show sidebar" : "Collapse sidebar"} title={collapsed ? "Show sidebar" : "Collapse sidebar"}>
          <PanelLeft size={22} />
        </button>
      </div>
      <nav className="sidebar-nav">
        {items.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className={`sidebar-item ${activeKey === key ? "active" : ""}`}
            aria-current={activeKey === key ? "page" : undefined}
            onClick={() => onSelect(key)}
            title={collapsed ? label : undefined}
          >
            <Icon size={21} aria-hidden="true" />
            <span className="sidebar-label">{label}</span>
          </button>
        ))}
      </nav>
      {children}
      {footer && !collapsed && <div className="sidebar-footer">{footer}</div>}
    </aside>
  );
}
