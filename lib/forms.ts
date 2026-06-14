/**
 * Shared shape for form-action results. Actions RETURN this instead of throwing
 * a validation error: a returned `error` is rendered inline by the form/dialog
 * (input preserved), while a thrown error would surface as the opaque
 * production error page. `ok` signals success so the dialog can close + refresh.
 *
 * Lives in a server-safe module so both server actions and client form
 * components can import the type without crossing the "use client" boundary.
 */
export type FormState = { ok?: boolean; error?: string };
