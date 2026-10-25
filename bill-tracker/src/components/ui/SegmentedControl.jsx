// A row of mutually exclusive options — iOS's segmented control. `options`
// is [{ value, label }]; the whole control is one radiogroup for screen readers.
export default function SegmentedControl({ options, value, onChange, label, className = "" }) {
  return (
    <div className={`segmented ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`segmented-option ${value === o.value ? "active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
