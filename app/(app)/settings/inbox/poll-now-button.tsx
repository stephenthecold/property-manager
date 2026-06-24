"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestInboxPollAction } from "./actions";

/**
 * "Poll now" — triggers an immediate worker poll (via a Postgres NOTIFY the
 * worker listens for) instead of waiting for the 5-minute tick, then refreshes
 * the page after a short delay so the health panel above reflects the new
 * attempt/result. Handy while configuring or debugging a mailbox connection.
 *
 * The poll runs asynchronously on the worker, so there's no synchronous result
 * to show — we wait a few seconds (a typical poll is quick) and re-render.
 */
export function PollNowButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [polling, setPolling] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Don't refresh / set state after the user has navigated away.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function onClick() {
    setNote(null);
    startTransition(async () => {
      try {
        const res = await requestInboxPollAction();
        if (res.error) {
          setNote(res.error);
          return;
        }
      } catch {
        setNote("Couldn't request a poll — try again.");
        return;
      }
      setPolling(true);
      setNote("Polling… the panel will refresh in a few seconds.");
      timer.current = setTimeout(() => {
        timer.current = null;
        setPolling(false);
        setNote(null);
        router.refresh();
      }, 5000);
    });
  }

  const busy = pending || polling;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={busy}
      >
        <RefreshCwIcon className={polling ? "animate-spin" : undefined} />
        {polling ? "Polling…" : "Poll now"}
      </Button>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}
