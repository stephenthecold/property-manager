/**
 * Renders one-time 2FA backup codes for the user to copy/print. Server-safe
 * (no client hooks) so it can be dropped into either a server page or a client
 * step. The codes are shown ONCE and never re-fetchable.
 */
export function BackupCodesPanel({ codes }: { codes: string[] }) {
  return (
    <div className="rounded-md border bg-muted p-4">
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );
}
