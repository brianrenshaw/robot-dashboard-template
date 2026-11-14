// mail.ts
// Links back to an email thread. Gmail and Superhuman use the same thread ID (a hex string such as
// 1a13ac066450e2b6), so one saved ID gives both links. The ID comes from an entry's source_ref
// ("gmail:<thread id>") or, failing that, from a saved Gmail link ("#all/thread-f:<decimal id>"
// or "#inbox/<hex id>").

export interface MailLinks {
  thread_id: string;
  /** Opens the thread in Superhuman on the web (and on phones). */
  superhuman: string | null;
  /** Opens the thread in the Superhuman Mac app (its registered superhuman:// link type). */
  superhuman_app: string | null;
  gmail: string;
}

const HEX = /^[0-9a-f]{12,20}$/i;

/** The Gmail thread ID for an entry, or null when it isn't a Gmail or Superhuman email. */
export function mailThreadId(entry: { source_ref: string | null; url: string | null }): string | null {
  const ref = entry.source_ref?.trim() ?? "";
  const m = /^(?:gmail|superhuman|email):(.+)$/i.exec(ref);
  if (m && HEX.test(m[1]!)) return m[1]!.toLowerCase();
  const url = entry.url ?? "";
  if (/mail\.google\.com/.test(url)) {
    const dec = /thread-f:(\d{10,25})/.exec(url);
    if (dec) {
      try {
        return BigInt(dec[1]!).toString(16);
      } catch {
        /* not a number */
      }
    }
    const hex = /#[a-z-]+\/([0-9a-f]{12,20})(?:[/?]|$)/i.exec(url);
    if (hex) return hex[1]!.toLowerCase();
  }
  const sh = /mail\.superhuman\.com\/[^/]+\/thread\/([0-9a-f]{12,20})/i.exec(url);
  if (sh) return sh[1]!.toLowerCase();
  return null;
}

/** Superhuman and Gmail links for an entry. `account` is the mailbox address the thread lives in. */
export function mailLinks(
  entry: { source_ref: string | null; url: string | null },
  account: string | null | undefined,
): MailLinks | null {
  const id = mailThreadId(entry);
  if (!id) return null;
  // Plain email in the path, as Superhuman's own links use. Reject anything that is not an address.
  const acct = account?.trim() && /^[^\s/?#@]+@[^\s/?#@]+$/.test(account.trim()) ? account.trim() : null;
  return {
    thread_id: id,
    superhuman: acct ? `https://mail.superhuman.com/${acct}/thread/${id}` : null,
    superhuman_app: acct ? `superhuman://${acct}/thread/${id}` : null,
    gmail: `https://mail.google.com/mail/${acct ? `?authuser=${encodeURIComponent(acct)}` : "u/0/"}#all/${id}`,
  };
}
