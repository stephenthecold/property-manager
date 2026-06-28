-- Tenant self-report → staff-confirm payment flow (payments module).
--
-- ADDITIVE ONLY. A self-reported offline payment (CashApp/Cash/ACH) is created
-- with status='pending' and reportedAt set, and crucially WITHOUT any
-- LedgerEntry or ChargeAllocation — so a pending self-report does NOT change the
-- lease balance (balance = SUM(amountCents) over LedgerEntry rows only). Staff
-- CONFIRM is the sole transition that posts (status='posted', confirmedAt/By set,
-- ledger entry + FIFO allocations written via the existing postPayment path).
-- These columns are nullable with no default: existing/staff-recorded/gateway
-- payments keep NULL and behave exactly as before.

-- AlterTable: self-report / confirm timestamps + confirming actor on Payment.
ALTER TABLE "Payment" ADD COLUMN     "reportedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN     "confirmedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN     "confirmedBy" TEXT;

-- AlterTable: which offline methods the tenant portal offers as self-report
-- options ({ cashApp, cash, ach }). Empty object == built-in defaults.
ALTER TABLE "AppSettings" ADD COLUMN     "portalPaymentMethods" JSONB NOT NULL DEFAULT '{}';
