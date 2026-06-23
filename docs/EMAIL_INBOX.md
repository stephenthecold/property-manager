# Email inbox — capturing invoices/receipts from a mailbox

The **Email inbox** module (`mailbox`) polls a mailbox over IMAP and lands every
message in a staff inbox at **`/inbox`**. From there an emailed invoice/receipt
can be **reviewed and posted to Financials as a `PropertyExpense`** — the
attachment is stored and the amount/date are OCR-prefilled, but **nothing
financial is created without a human** confirming it. Inbound email is treated
as untrusted input: bodies are shown as text (never rendered as HTML),
attachments are size/type-capped, and capture is read-only (messages are marked
*seen*, never deleted) and de-duplicated on `Message-ID`.

> The inbox is also a general mailbox — a message that isn't an invoice can be
> read and archived. (Threading replies onto a specific tenant request/work
> order is a planned follow-up; v1 is invoice/receipt capture.)

## 1. Turn it on

1. **Settings → Modules → Email inbox (invoice & mail capture)** → on.
2. **Settings → Email inbox** → choose a provider and save (details below).
3. Make sure the **worker** is running (`npm run worker` / the `worker` service in
   `docker compose`). It polls every 5 minutes (override with `INBOX_POLL_CRON`)
   and on startup. `OCR_ENABLED=true` enables amount/date prefill from
   attachments (otherwise you just key the numbers in by hand).

Try it without a real mailbox first: set the provider to **Stub** — the next
poll injects a couple of canned messages (including one with an invoice
attachment) so you can see the inbox and the review→expense flow end to end.

## 2. Microsoft 365 (Exchange Online)

Microsoft **disabled IMAP Basic Auth** for Exchange Online, so a username +
password login will fail. Authenticate with **OAuth2 (XOAUTH2)** instead. For a
service mailbox the cleanest option is the **client-credentials (app-only)**
grant — no user password, no expiring refresh token.

**a. Register an app** (Entra ID / Azure AD → App registrations → New):
   - **API permissions → Add → APIs my organization uses → Office 365 Exchange
     Online → Application permissions → `IMAP.AccessAsApp`** → add, then **Grant
     admin consent**.
   - **Certificates & secrets → New client secret** → copy the value.
   - Note the **Application (client) ID** and your **Directory (tenant) ID**.

**b. Scope the app to just the mailbox** (Exchange Online PowerShell) so it can
   only read that one inbox, not the whole tenant:

   ```powershell
   New-ApplicationAccessPolicy -AppId <client-id> `
     -PolicyScopeGroupId invoices@yourdomain.com `
     -AccessRight RestrictAccess `
     -Description "Property-manager email inbox"
   ```

**c. Configure Settings → Email inbox:**
   - Provider **IMAP**, host **`outlook.office365.com`**, port **993**, TLS on.
   - Mailbox address = the inbox (e.g. `invoices@yourdomain.com`).
   - Authentication **OAuth2 / XOAUTH2**.
   - **Client ID** = the app's client id; **Client secret** = the secret value.
   - **Token URL** = `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token`.
   - **Scope** = leave blank (defaults to `https://outlook.office365.com/.default`).
   - **Refresh token** = leave blank → app-only client-credentials grant.

> Prefer a **delegated** login instead? Use the `IMAP.AccessAsUser.All` +
> `offline_access` scopes, obtain a refresh token via the auth-code flow, and
> paste it into **Refresh token** — the app then uses the `refresh_token` grant.

## 3. Gmail / Google Workspace

Enable 2-Step Verification on the mailbox and create an **App password**. Then:
provider **IMAP**, host **`imap.gmail.com`**, port **993**, TLS on, mailbox =
the address, authentication **Password**, password = the 16-character app
password. (Google also supports XOAUTH2 if you'd rather not use an app password.)

## 4. Self-hosted IMAP (Dovecot, etc.)

Provider **IMAP**, your host + port (usually **993** implicit TLS, or 143 +
STARTTLS — uncheck "Implicit TLS"), mailbox username, authentication
**Password**.

## 5. How capture works

- The worker searches the folder (default **INBOX**) for **unseen** messages,
  parses each, records it, and only then marks it **\Seen**. A crash before that
  leaves the message for the next poll; the recorder de-duplicates on
  `Message-ID`, so a re-fetch never creates a duplicate row.
- Attachments are stored via the configured file storage and OCR'd
  best-effort. Allowed types: PDFs, images, and common office/text docs, each
  capped at 25 MB, up to 10 per message.
- The secrets (IMAP password / OAuth client secret / refresh token) are stored
  **AES-256-GCM encrypted** (like the SMTP-send secrets) and are only ever
  decrypted in the worker at poll time.

## 6. Capabilities

- Reading/triaging the inbox requires **`mailbox.manage`** (manager+ by default).
- **Posting an emailed invoice as an expense additionally requires
  `financials.manage`** and the Financials module — so the same money guardrails
  as a hand-entered expense apply.

## 7. Verify

- Stub provider → next worker poll → `/inbox` shows the two demo messages; open
  the invoice one → attachment is listed, amount is prefilled → **Review & post
  expense** → it appears in Financials and the inbox item flips to **Posted**.
- Real mailbox → send a test email with a PDF invoice to the configured address →
  within a poll interval it appears in `/inbox` with the PDF attached.
