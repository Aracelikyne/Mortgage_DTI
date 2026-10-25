// An inline notice above a page's content. `tone`: info | success | warning
// | danger | sandbox. `action` sits on the trailing edge (a button).
export default function Banner({ tone = "info", icon, children, action, role = "status" }) {
  return (
    <div className={`banner banner-${tone}`} role={role}>
      {icon && <span className="banner-icon" aria-hidden="true">{icon}</span>}
      <div className="banner-body">{children}</div>
      {action && <div className="banner-action">{action}</div>}
    </div>
  );
}
