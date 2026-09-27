import { currencyOptions } from "@/lib/money";

type FieldProps = {
  label: string;
  name: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>;

export function Field({ label, name, hint, ...input }: FieldProps) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input name={name} className="input" {...input} />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

type SelectProps = {
  label: string;
  name: string;
  options: { value: string; label: string }[];
} & React.SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ label, name, options, ...select }: SelectProps) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select name={name} className="input" {...select}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CurrencySelect({ name = "currency", label = "Currency", defaultValue }: { name?: string; label?: string; defaultValue: string }) {
  return (
    <Select
      label={label}
      name={name}
      defaultValue={defaultValue}
      options={currencyOptions().map((c) => ({ value: c, label: c }))}
    />
  );
}

export function Checkbox({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-4 w-4 accent-accent" />
      {label}
    </label>
  );
}
