import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export interface PickerOption<T extends string> {
  value: T;
  label: string;
  hint?: string; // shown muted on the right, e.g. a pair count
  disabled?: boolean;
}

interface Props<T extends string> {
  label: string;
  value: T;
  options: PickerOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  title?: string;
}

/** A styled replacement for <select>: native option lists can't be rounded or themed. */
export function Picker<T extends string>({ label, value, options, onChange, disabled, title }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  const show = () => {
    const i = options.findIndex((o) => o.value === value);
    setActive(i < 0 ? 0 : i);
    setOpen(true);
  };
  const choose = (o: PickerOption<T>) => {
    if (o.disabled) return;
    onChange(o.value);
    setOpen(false);
    button.current?.focus();
  };
  const step = (dir: 1 | -1) => {
    for (let n = 1; n <= options.length; n++) {
      const i = (active + dir * n + options.length) % options.length;
      if (!options[i].disabled) return setActive(i);
    }
  };

  // Keys handled here stop propagating so the page's global Enter-to-start doesn't also fire.
  const onKey = (e: KeyboardEvent) => {
    const k = e.key;
    let handled = true;
    if (!open) {
      if (k === "Enter" || k === " " || k === "ArrowDown" || k === "ArrowUp") show();
      else handled = false;
    } else if (k === "ArrowDown") step(1);
    else if (k === "ArrowUp") step(-1);
    else if (k === "Home") setActive(options.findIndex((o) => !o.disabled));
    else if (k === "End") setActive(options.length - 1 - [...options].reverse().findIndex((o) => !o.disabled));
    else if (k === "Enter" || k === " ") choose(options[active]);
    else if (k === "Escape" || k === "Tab") {
      setOpen(false);
      handled = k === "Escape";
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div className={`picker${open ? " open" : ""}`} ref={root}>
      <span className="picker-label" id={`${id}-label`}>{label}</span>
      <button
        ref={button}
        type="button"
        className="picker-button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-labelledby={`${id}-label`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        title={title}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        <span className="picker-value">
          {current?.label}
          {current?.hint && <span className="picker-hint">{current.hint}</span>}
        </span>
        <svg className="picker-chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul className="picker-menu" role="listbox" id={`${id}-list`} aria-labelledby={`${id}-label`}>
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.value === value}
              aria-disabled={o.disabled || undefined}
              className={`picker-option${i === active ? " active" : ""}`}
              onPointerEnter={() => !o.disabled && setActive(i)}
              onPointerDown={(e) => e.preventDefault()} // keep focus on the button
              onClick={() => choose(o)}
            >
              <span>{o.label}</span>
              {o.hint && <span className="picker-hint">{o.hint}</span>}
              <svg className="picker-check" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2.5 6.2 5 8.6 9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
