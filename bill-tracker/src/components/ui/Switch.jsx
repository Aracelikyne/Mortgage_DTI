// iOS on/off switch. A real <button role="switch">, so it's keyboard and
// screen-reader friendly; `label` names it when there's no visible label
// wired up with htmlFor/id.
export default function Switch({ checked, onChange, label, disabled = false, id }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      className="switch"
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  );
}
