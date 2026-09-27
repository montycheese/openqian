"use client";

import { useId } from "react";

type FieldProps = {
  label: string;
  name: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>;

export function Field({ label, name, hint, ...input }: FieldProps) {
  const hintId = useId();
  return (
    <div>
      <label className="block">
        <span className="label">{label}</span>
        <input name={name} className="input" aria-describedby={hint ? hintId : undefined} {...input} />
      </label>
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
