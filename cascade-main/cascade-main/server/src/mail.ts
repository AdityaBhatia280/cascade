// Outgoing email. With RESEND_API_KEY, NOTIFY_FROM and NOTIFY_TO set, messages go out through the
// Resend REST API; otherwise each is written as an .eml file to the site's outbox and reported as not
// sent. Demo safety: every email goes to the one NOTIFY_TO inbox whoever it is for, and its body
// names the intended recipient. Keys are read here and never logged or returned.

import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DeliveryDto } from '@cascade/core/contract';

export type Delivery = DeliveryDto;

export interface OutgoingMail {
  /** The message id; names the outbox file. */
  readonly id: string;
  readonly subject: string;
  readonly text: string;
  /** Who it is for, named in the body because the address is always the demo inbox. */
  readonly intendedFor: string;
  /** Stable per message content, so a retry after a crash is deduplicated by the provider too. */
  readonly idempotencyKey: string;
}

export interface Mailer {
  readonly kind: 'resend' | 'outbox';
  /** Never throws: a provider error comes back as a failed delivery. */
  send(mail: OutgoingMail): Promise<Delivery>;
}

const RESEND_URL = 'https://api.resend.com/emails';

function demoBody(mail: OutgoingMail): string {
  return [
    `[Cascade demo] Every email from this demo goes to one inbox. Intended recipient: ${mail.intendedFor}.`,
    '',
    mail.text,
  ].join('\n');
}

export function resendMailer(cfg: { readonly apiKey: string; readonly from: string; readonly to: string }, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    kind: 'resend',
    async send(mail) {
      let res: Response;
      try {
        res = await fetchImpl(RESEND_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json', 'idempotency-key': mail.idempotencyKey },
          body: JSON.stringify({ from: cfg.from, to: [cfg.to], subject: mail.subject, text: demoBody(mail) }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (e) {
        return { status: 'failed', reason: `could not reach Resend: ${(e as Error).name}` };
      }
      const json = (await res.json().catch(() => null)) as { id?: unknown; message?: unknown } | null;
      if (!res.ok || typeof json?.id !== 'string') {
        return { status: 'failed', reason: `Resend answered ${res.status}${typeof json?.message === 'string' ? `: ${json.message}` : ''}` };
      }
      return { status: 'sent', via: 'resend', providerId: json.id, deliveredTo: cfg.to };
    },
  };
}

/** Writes each message as an RFC 5322 .eml file; `reason` says why it was not sent. */
export function outboxMailer(cfg: { readonly dir: string; readonly shownAs: string; readonly reason: string; readonly from: string | null; readonly to: string | null }): Mailer {
  return {
    kind: 'outbox',
    async send(mail) {
      const name = `${mail.id}.eml`;
      const eml = [
        `From: ${cfg.from ?? 'cascade@localhost'}`,
        `To: ${cfg.to ?? 'undisclosed-recipients:;'}`,
        `Subject: ${mail.subject}`,
        `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
        `Message-ID: <${mail.id}.${mail.idempotencyKey.replace(/[^A-Za-z0-9.-]/g, '-')}@cascade.local>`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        `X-Cascade-Not-Sent: ${cfg.reason}`,
        '',
        demoBody(mail).replace(/\r?\n/g, '\r\n'),
        '',
      ].join('\r\n');
      await mkdir(cfg.dir, { recursive: true });
      const tmp = path.join(cfg.dir, `.${name}.tmp`);
      await writeFile(tmp, eml, 'utf8');
      await rename(tmp, path.join(cfg.dir, name));
      return { status: 'not-sent', reason: cfg.reason, file: path.join(cfg.shownAs, name) };
    },
  };
}

/** Resend when the key and both addresses are set; otherwise the outbox, with the missing piece as the reason. */
export function mailerFromEnv(env: Readonly<Record<string, string | undefined>>, outbox: { readonly dir: string; readonly shownAs: string }): Mailer {
  const read = (name: string) => env[name]?.trim() || null;
  const [apiKey, from, to] = [read('RESEND_API_KEY'), read('NOTIFY_FROM'), read('NOTIFY_TO')];
  if (apiKey && from && to) return resendMailer({ apiKey, from, to });
  const reason = !apiKey ? 'no email key' : `${[!from && 'NOTIFY_FROM', !to && 'NOTIFY_TO'].filter(Boolean).join(' and ')} not set`;
  return outboxMailer({ ...outbox, reason, from, to });
}
