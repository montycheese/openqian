"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import type { ActionState } from "@/lib/actions";

type Props = {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  submitClassName?: string;
  successMessage?: string;
  className?: string;
  /** Clear the fields after a successful submit (for "add" forms). */
  resetOnSuccess?: boolean;
  children?: React.ReactNode;
};

/**
 * A form bound to a Server Action that reports validation errors inline.
 * Submits via onSubmit rather than the `action` prop, because React resets
 * `action` forms after every submission, wiping input the user must correct.
 */
export function ActionForm({
  action,
  submitLabel,
  submitClassName = "btn-primary",
  successMessage,
  className = "space-y-4",
  resetOnSuccess = false,
  children,
}: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={formRef}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      {children}
      {state.error && (
        <p role="alert" className="text-sm text-negative">
          {state.error}
        </p>
      )}
      {state.ok && successMessage && !pending && (
        <p role="status" className="text-sm text-positive">
          {successMessage}
        </p>
      )}
      {state.message && !pending && <p className="text-sm text-muted">{state.message}</p>}
      <button type="submit" disabled={pending} className={submitClassName}>
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
