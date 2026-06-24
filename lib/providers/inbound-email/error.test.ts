import { describe, expect, it } from "vitest";
import { describeInboxPollError } from "@/lib/providers/inbound-email/error";

/**
 * These shapes mirror real imapflow@1.4.x errors: a failed IMAP command throws
 * `new Error("Command failed")` with the reason on side fields (lib/imap-flow.js
 * ~L805), and auth failures throw an AuthenticationFailure carrying
 * `authenticationFailed = true` (lib/tools.js). The helper must surface those
 * side fields, since the health panel only ever sees the recorded string.
 */
function imapCommandError(fields: Record<string, unknown>): Error {
  return Object.assign(new Error("Command failed"), fields);
}

describe("describeInboxPollError", () => {
  it("surfaces the server response text instead of the generic 'Command failed'", () => {
    const msg = describeInboxPollError(
      imapCommandError({
        responseStatus: "NO",
        responseText: "The specified folder name is invalid.",
        serverResponseCode: "NONEXISTENT",
      }),
    );
    expect(msg).toContain("The specified folder name is invalid.");
    expect(msg).toContain("[NONEXISTENT]");
    expect(msg).not.toBe("Command failed");
  });

  it("calls out an authentication rejection and points at the M365 IMAP fix", () => {
    const authErr = Object.assign(new Error("Authentication failed"), {
      authenticationFailed: true,
      response: "LOGIN failed.",
      serverResponseCode: "AUTHENTICATIONFAILED",
    });
    const msg = describeInboxPollError(authErr);
    expect(msg).toContain("rejected authentication");
    expect(msg).toContain("LOGIN failed.");
    expect(msg).toContain("[AUTHENTICATIONFAILED]");
    expect(msg).toContain("IMAP.AccessAsUser.All");
  });

  it("adds the M365 hint when the response text signals IMAP is disabled", () => {
    const msg = describeInboxPollError(
      imapCommandError({
        responseText:
          "IMAP4 protocol is disabled for this mailbox. Please contact your administrator.",
      }),
    );
    expect(msg).toContain("disabled for this mailbox");
    expect(msg).toContain("IMAP.AccessAsUser.All");
  });

  it("describes M365 throttling from the ETHROTTLE code with a back-off hint", () => {
    const msg = describeInboxPollError(
      imapCommandError({ code: "ETHROTTLE", throttleReset: 92415 }),
    );
    expect(msg).toContain("throttling");
    expect(msg).toContain("~92s");
    // Throttle is self-recovering — don't mislabel it as an auth problem.
    expect(msg).not.toContain("IMAP.AccessAsUser.All");
  });

  it("uses the NO/BAD status when the server gives no text (beats 'Command failed')", () => {
    // ImapFlow leaves `response` an object and sets no responseText on a terse
    // failure; the status is the only signal — still better than the generic msg.
    const msg = describeInboxPollError(
      imapCommandError({ responseStatus: "NO", response: { tag: "a01" } }),
    );
    expect(msg).toContain("rejected the request (NO)");
    expect(msg).not.toBe("Command failed");
    expect(msg).not.toContain("IMAP.AccessAsUser.All");
  });

  it("does not add the IMAP hint for an unrelated '<extension> disabled' notice", () => {
    const msg = describeInboxPollError(
      imapCommandError({
        responseText: "THREAD=REFS extension is disabled on this server.",
      }),
    );
    expect(msg).toContain("disabled");
    expect(msg).not.toContain("IMAP.AccessAsUser.All");
  });

  it("falls back to the plain message when there's nothing richer (no hint)", () => {
    expect(describeInboxPollError(new Error("getaddrinfo ENOTFOUND mail"))).toBe(
      "getaddrinfo ENOTFOUND mail",
    );
  });

  it("does not append the M365 hint for an ordinary command failure", () => {
    const msg = describeInboxPollError(
      imapCommandError({ responseText: "Server busy, try again later." }),
    );
    expect(msg).toContain("Server busy");
    expect(msg).not.toContain("IMAP.AccessAsUser.All");
  });

  it("handles non-Error throws without blowing up", () => {
    expect(describeInboxPollError("boom")).toBe("boom");
    expect(describeInboxPollError(null)).toBe("Unknown error");
  });
});
