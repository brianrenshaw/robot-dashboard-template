// mail.ts: links that open an email thread in Superhuman or Gmail.
// On a computer the Superhuman link opens the Mac app; on a phone or tablet it opens the web app.

import { mailLinks } from "@pd/core/mail";
import { useMe, useSettings } from "../api";

const IS_MOBILE = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

export interface OpenLinks {
  superhuman: string | null;
  gmail: string;
}

/** Returns a function that builds the links for anything with a source_ref or url. */
export function useMailLinks(): (item: { source_ref: string | null; url: string | null }, account?: string) => OpenLinks | null {
  const { data: settings } = useSettings();
  const { data: me } = useMe();
  return (item, account) => {
    const mail = mailLinks(item, account || settings?.mail_account || me?.email);
    if (!mail) return null;
    return { superhuman: IS_MOBILE ? mail.superhuman : mail.superhuman_app ?? mail.superhuman, gmail: mail.gmail };
  };
}

/** Links to a web address open in a new tab; app links (superhuman://) open in place. */
export function linkProps(href: string) {
  return href.startsWith("http") ? { href, target: "_blank", rel: "noreferrer" } : { href };
}
