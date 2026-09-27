"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/actions";

type Props = {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  submitClassName?: string;
  successMessage?: string;
  className?: string;
  children: React.ReactNode;
};

/** A form bound to a Server Action that reports validation errors inline. */
export function ActionForm({
  action,
  submitLabel,
  submitClassName = "btn-primary",
  successMessage,
  className = "space-y-4",
  children,
}: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      {children}
      {state.error && (
        <p role="alert" className="text-sm text-negative">
          {state.error}
        </p>
      )}
      {state.ok && successMessage && !pending && <p className="text-sm text-positive">{successMessage}</p>}
      <button type="submit" disabled={pending} className={submitClassName}>
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
