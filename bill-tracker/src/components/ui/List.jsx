import { useId } from "react";
import { ChevronRight, ChevronsUpDown } from "lucide-react";
import Switch from "./Switch";

// Inset grouped list: a rounded block of rows with an optional uppercase
// header above it and explanatory footer below — the Settings-app layout.
export function ListSection({ header, headerDetail, footer, children, className = "" }) {
  return (
    <section className={`list-section ${className}`}>
      {(header || headerDetail) && (
        <div className="list-header">
          <span>{header}</span>
          {headerDetail && <span className="list-header-detail">{headerDetail}</span>}
        </div>
      )}
      <div className="list">{children}</div>
      {footer && <div className="list-footer">{footer}</div>}
    </section>
  );
}

// One row. Tappable (a <button>) when it has onClick, with a chevron unless
// `accessory` says otherwise; `accessory` can also be any element (a
// switch, a badge) shown at the trailing edge.
export function ListRow({ icon, iconColor, title, subtitle, detail, accessory = "auto", onClick, destructive = false, className = "", children, ...rest }) {
  const Tag = onClick ? "button" : "div";
  const chevron = accessory === "chevron" || (accessory === "auto" && !!onClick);
  const custom = accessory !== "auto" && accessory !== "chevron" && accessory !== "none" ? accessory : null;
  return (
    <Tag
      type={onClick ? "button" : undefined}
      className={`row ${onClick ? "row-button" : ""} ${icon ? "has-icon" : ""} ${destructive ? "destructive" : ""} ${className}`}
      onClick={onClick}
      {...rest}
    >
      {icon && <span className="row-icon" style={{ background: iconColor }}>{icon}</span>}
      <span className="row-body">
        <span className="row-title">{title}</span>
        {subtitle && <span className="row-subtitle">{subtitle}</span>}
      </span>
      {detail !== undefined && detail !== null && detail !== "" && <span className="row-detail">{detail}</span>}
      {children}
      {custom}
      {chevron && <ChevronRight className="row-chevron" size={18} strokeWidth={2.5} aria-hidden="true" />}
    </Tag>
  );
}

// A centered action row ("Sign Out", "Delete Debt").
export function ListButton({ children, onClick, destructive = false, disabled = false }) {
  return (
    <button type="button" className={`row row-button row-action ${destructive ? "destructive" : ""}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

// Form row: label on the left, control on the right — how iOS lays out
// editable fields in grouped lists.
export function FieldRow({ label, children, hint }) {
  return (
    <label className="row field-row">
      <span className="field-label">{label}</span>
      <span className="field-control">{children}</span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function TextField({ label, value, onChange, placeholder, type = "text", inputMode, hint, ...rest }) {
  return (
    <FieldRow label={label} hint={hint}>
      <input
        type={type}
        inputMode={inputMode}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </FieldRow>
  );
}

// Numbers come back as strings; "" stays "" so a cleared field reads as
// empty, not 0. Callers decide what an empty value means when they save.
export function NumberField({ label, value, onChange, placeholder, hint, step = "any", min, max }) {
  return (
    <TextField
      label={label}
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      max={max}
      value={value}
      placeholder={placeholder}
      onChange={onChange}
      hint={hint}
    />
  );
}

export function SelectField({ label, value, onChange, options }) {
  return (
    <FieldRow label={label}>
      <span className="select-wrap">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
        <ChevronsUpDown size={14} aria-hidden="true" />
      </span>
    </FieldRow>
  );
}

export function SwitchRow({ label, subtitle, checked, onChange, disabled }) {
  const id = useId();
  return (
    <div className="row switch-row">
      <label className="row-body" htmlFor={id}>
        <span className="row-title">{label}</span>
        {subtitle && <span className="row-subtitle">{subtitle}</span>}
      </label>
      <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}
