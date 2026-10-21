"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Themed dropdowns (native <select>/<datalist> popups can't be styled).
 * Keyboard: ↑/↓ move, Enter picks, Esc closes the list (not the surrounding modal).
 */

function useOutside(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const on = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", on);
    return () => document.removeEventListener("pointerdown", on);
  }, [ref, open, close]);
}

function scrollActive(list: HTMLElement | null, i: number) {
  const el = list?.children[i] as HTMLElement | undefined;
  el?.scrollIntoView({ block: "nearest" });
}

export function Select({
  value,
  options,
  placeholder,
  onChange,
  invalid,
  ariaLabel,
}: {
  value: string;
  options: string[];
  placeholder: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  useOutside(wrap, open, () => setOpen(false));

  const openList = () => {
    setActive(Math.max(0, options.indexOf(value)));
    setOpen(true);
  };
  useEffect(() => {
    if (open) scrollActive(list.current, active);
  }, [open, active]);

  const pick = (i: number) => {
    onChange(options[i]);
    setOpen(false);
    btn.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return openList();
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + d + options.length) % options.length);
    } else if ((e.key === "Enter" || e.key === " ") && open) {
      e.preventDefault();
      if (active >= 0) pick(active);
    } else if (e.key === "Home" && open) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && open) {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      // type-ahead by first letter
      const i = options.findIndex((o) => o.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) {
        if (!open) setOpen(true);
        setActive(i);
      }
    }
  };

  return (
    <div className={`dd ${open ? "open" : ""}`} ref={wrap} onKeyDown={onKey}>
      <button
        ref={btn}
        type="button"
        className={`dd-btn ${invalid ? "invalid" : ""} ${value ? "" : "is-empty"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openList())}
      >
        <span className="dd-value">{value || placeholder}</span>
        <span className="dd-caret" aria-hidden="true" />
      </button>
      {open && (
        <ul className="dd-list" role="listbox" id={id} ref={list} aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}>
          {options.map((o, i) => (
            <li
              key={o}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o === value}
              className={`dd-opt ${i === active ? "active" : ""}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Combobox({
  value,
  options,
  placeholder,
  onChange,
  invalid,
  ariaLabel,
}: {
  value: string;
  options: string[];
  placeholder: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  useOutside(wrap, open, () => setOpen(false));

  const q = value.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.toLowerCase().includes(q) && o.toLowerCase() !== q) : options;
  useEffect(() => {
    if (open) scrollActive(list.current, active);
  }, [open, active]);

  const pick = (o: string) => {
    onChange(o);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && shown.length) {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + d + shown.length) % shown.length);
    } else if (e.key === "Enter" && open && active >= 0 && shown[active]) {
      e.preventDefault();
      pick(shown[active]);
    }
  };

  return (
    <div className={`dd ${open && shown.length ? "open" : ""}`} ref={wrap} onKeyDown={onKey}>
      <input
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && shown.length > 0}
        aria-controls={id}
        aria-label={ariaLabel}
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        className={invalid ? "invalid" : ""}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
      />
      {open && shown.length > 0 && (
        <ul className="dd-list" role="listbox" id={id} ref={list}>
          {shown.map((o, i) => (
            <li
              key={o}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`dd-opt ${i === active ? "active" : ""}`}
              onPointerEnter={() => setActive(i)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
