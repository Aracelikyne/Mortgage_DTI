// The phone tab bar: icon over label, the selected tab in the tint color.
// `items` are [{ key, label, icon, badge }].
export default function TabBar({ items, activeKey, onSelect }) {
  return (
    <nav className="tabbar" aria-label="Sections">
      {items.map(({ key, label, icon: Icon, badge }) => (
        <button
          key={key}
          type="button"
          className={`tab ${activeKey === key ? "active" : ""}`}
          aria-current={activeKey === key ? "page" : undefined}
          onClick={() => onSelect(key)}
        >
          <span className="tab-icon">
            <Icon size={24} strokeWidth={activeKey === key ? 2.2 : 1.8} aria-hidden="true" />
            {badge ? <span className="tab-badge">{badge}</span> : null}
          </span>
          <span className="tab-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
