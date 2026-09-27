import { chainById } from "@/lib/wallets/chains";

/** Small label naming the blockchain an asset is held on, e.g. "Base". */
export function NetworkBadge({ network }: { network: string }) {
  return (
    <span className="shrink-0 rounded border border-border px-1.5 py-px text-[11px] leading-4 text-muted">
      {chainById(network)?.label ?? network}
    </span>
  );
}
