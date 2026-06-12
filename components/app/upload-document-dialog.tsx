"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const UPLOAD_TYPES = ["receipt_photo", "lease", "tenant_document", "other"] as const;

const MAX_FILE_BYTES = 15 * 1024 * 1024;

const STORAGE_NOT_CONFIGURED_FALLBACK =
  "File storage is not configured (STORAGE_PROVIDER=stub). Set STORAGE_PROVIDER=s3 and the S3_* vars to enable uploads.";

export function UploadDocumentDialog({
  tenantId,
  paymentId,
  receiptId,
  trigger = "Upload document",
}: {
  tenantId?: string;
  paymentId?: string;
  /** Attaching to a receipt locks the type to receipt_photo. */
  receiptId?: string;
  trigger?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);

  const defaultType = tenantId || paymentId || receiptId ? "receipt_photo" : "other";

  function handleOpenChange(next: boolean) {
    if (next) {
      setError(null);
      setUploadedId(null);
    }
    setOpen(next);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);

    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a file to upload.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("That file is larger than 15 MB. Please choose a smaller file.");
      return;
    }

    setError(null);
    setUploadedId(null);
    setPending(true);
    try {
      const res = await fetch("/api/uploads", { method: "POST", body: fd });
      if (res.status === 201) {
        const data = (await res.json()) as { documentId: string };
        setUploadedId(data.documentId);
        form.reset();
        router.refresh();
      } else {
        let message: string | null = null;
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          // Non-JSON error body; fall through to the defaults below.
        }
        if (!message) {
          message =
            res.status === 503 ? STORAGE_NOT_CONFIGURED_FALLBACK : "Upload failed.";
        }
        setError(message);
      }
    } catch {
      setError("Upload failed — check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button>{trigger}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>
            Photos (camera OK), PDFs, or text files up to 15 MB.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {tenantId && <input type="hidden" name="tenantId" value={tenantId} />}
          {paymentId && <input type="hidden" name="paymentId" value={paymentId} />}
          {receiptId && <input type="hidden" name="receiptId" value={receiptId} />}
          <div className="space-y-2">
            <Label htmlFor="file">File</Label>
            <input
              id="file"
              type="file"
              name="file"
              accept="image/*,application/pdf,text/plain"
              capture="environment"
              className="text-sm"
              required
            />
          </div>
          {receiptId ? (
            <input type="hidden" name="uploadType" value="receipt_photo" />
          ) : (
            <div className="space-y-2">
              <Label htmlFor="uploadType">Document type</Label>
              <select
                id="uploadType"
                name="uploadType"
                defaultValue={defaultType}
                className="h-9 w-full rounded-md border px-3 text-sm capitalize"
              >
                {UPLOAD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" placeholder="Optional" />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {uploadedId && (
            <Alert>
              <AlertDescription>
                Uploaded. <a href={`/documents/${uploadedId}`}>View document</a>
              </AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Uploading…" : "Upload"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
