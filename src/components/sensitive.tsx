/**
 * Wraps a number that private mode hides. The CSS in globals.css swaps the
 * value for asterisks when <html data-private> is set, so pages render masked
 * without any client code and nothing flashes before hydration.
 */
export function Sensitive({ children }: { children: React.ReactNode }) {
  return (
    <span className="sensitive">
      <span className="sensitive-value">{children}</span>
    </span>
  );
}

export const MASK = "*****";
