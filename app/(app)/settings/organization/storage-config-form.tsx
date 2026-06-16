"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveStorageConfigAction, type OrganizationState } from "./actions";

export interface StorageConfigInitial {
  storageProvider: string;
  s3Bucket: string;
  s3Region: string;
  s3Endpoint: string;
  s3ForcePathStyle: boolean | null;
}

/**
 * Edit the NON-SECRET storage config (provider + S3 bucket/region/endpoint/
 * path-style). Secrets (S3 keys), the local dir, and the encrypt flag stay in
 * env. Leaving a field blank uses the environment value.
 */
export function StorageConfigForm({ initial }: { initial: StorageConfigInitial }) {
  const [state, action, pending] = useActionState<OrganizationState, FormData>(
    saveStorageConfigAction,
    {},
  );

  const pathStyleDefault =
    initial.s3ForcePathStyle === true
      ? "true"
      : initial.s3ForcePathStyle === false
        ? "false"
        : "";

  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.ok && (
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <p className="text-sm text-muted-foreground">
        Override the non-secret storage settings without a redeploy. Access
        keys, the local directory, and at-rest encryption stay in the
        environment. Leave a field blank to use its environment value.
      </p>

      <div className="space-y-2">
        <Label htmlFor="storageProvider">Provider</Label>
        <select
          id="storageProvider"
          name="storageProvider"
          defaultValue={initial.storageProvider}
          className="h-9 w-full rounded-md border px-3 text-sm"
        >
          <option value="">Use environment default</option>
          <option value="stub">Stub (uploads disabled)</option>
          <option value="local">Local disk / mounted share</option>
          <option value="s3">S3-compatible (S3 / R2 / B2 / MinIO)</option>
        </select>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="s3Bucket">S3 bucket</Label>
          <Input id="s3Bucket" name="s3Bucket" defaultValue={initial.s3Bucket} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="s3Region">S3 region</Label>
          <Input id="s3Region" name="s3Region" defaultValue={initial.s3Region} placeholder="us-east-1" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="s3Endpoint">S3 endpoint (R2/B2/MinIO)</Label>
          <Input id="s3Endpoint" name="s3Endpoint" defaultValue={initial.s3Endpoint} placeholder="AWS default" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="s3ForcePathStyle">Path-style addressing</Label>
          <select
            id="s3ForcePathStyle"
            name="s3ForcePathStyle"
            defaultValue={pathStyleDefault}
            className="h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">Use environment default</option>
            <option value="true">On (R2 / B2 / MinIO)</option>
            <option value="false">Off (AWS S3)</option>
          </select>
        </div>
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save storage settings"}
      </Button>
    </form>
  );
}
