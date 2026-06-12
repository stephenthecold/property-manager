"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

/**
 * Draw-your-signature canvas for forms. Pointer-events based (mouse, touch,
 * pen), devicePixelRatio-aware so strokes stay crisp on retina screens. The
 * current drawing is exposed to the surrounding <form> as a PNG data URL in a
 * hidden input (`name`), refreshed after every stroke; `onEmptyChange` lets
 * the parent disable submit until something is drawn.
 */
export function SignaturePad({
  name,
  width = 480,
  height = 160,
  onEmptyChange,
}: {
  /** Hidden-input name carrying the PNG data URL ("" while empty). */
  name: string;
  width?: number;
  height?: number;
  onEmptyChange?: (empty: boolean) => void;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const drawing = React.useRef(false);
  const last = React.useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = React.useState(true);

  // Size the backing store by devicePixelRatio once mounted.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1a202c"; // ink color — fixed so the PNG prints well
    }
  }, [width, height]);

  function setEmptyState(next: boolean) {
    setEmpty(next);
    onEmptyChange?.(next);
  }

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    // Map CSS pixels to the logical (pre-DPR-scale) coordinate space.
    return {
      x: ((e.clientX - rect.left) / rect.width) * width,
      y: ((e.clientY - rect.top) / rect.height) * height,
    };
  }

  function handleDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
  }

  function handleMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    e.preventDefault();
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (empty) setEmptyState(false);
  }

  function handleUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    // A tap without movement still leaves a dot.
    if (ctx && last.current) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(last.current.x + 0.1, last.current.y + 0.1);
      ctx.stroke();
      if (empty) setEmptyState(false);
    }
    drawing.current = false;
    last.current = null;
    // Refresh the hidden input after each completed stroke.
    if (inputRef.current && canvasRef.current) {
      inputRef.current.value = canvasRef.current.toDataURL("image/png");
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    if (inputRef.current) inputRef.current.value = "";
    setEmptyState(true);
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Signature drawing area"
        className="w-full max-w-full touch-none rounded-md border bg-white"
        style={{ aspectRatio: `${width} / ${height}` }}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
      />
      <input ref={inputRef} type="hidden" name={name} defaultValue="" />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {empty ? "Draw your signature above." : "Looks good? You can redraw any time."}
        </p>
        <Button type="button" variant="ghost" size="xs" onClick={clear} disabled={empty}>
          Clear
        </Button>
      </div>
    </div>
  );
}
