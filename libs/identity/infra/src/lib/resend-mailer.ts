import { type Mail, type Mailer } from '@itadaki/identity/application';

/**
 * Sends mail through Resend's HTTP API.
 *
 * HTTP rather than SMTP so no dependency is needed: one fetch, no connection
 * pooling, no TLS negotiation to get wrong. Swapping to another provider means
 * writing a sibling of this file — the reset flow only knows the `Mailer` port.
 *
 * Everything it needs comes from the environment:
 *   RESEND_API_KEY   the key from resend.com
 *   MAIL_FROM        a verified sender, e.g. "Itadaki <hola@tudominio.com>"
 */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  /**
   * Reads the configuration, or returns null when it is absent.
   *
   * Null rather than a throw: a local install with no mail provider is a
   * normal state, and the composition root decides what to do about it.
   */
  static fromEnvironment(): ResendMailer | null {
    const apiKey = process.env['RESEND_API_KEY'] ?? '';
    const from = process.env['MAIL_FROM'] ?? '';
    if (apiKey === '' || from === '') return null;
    return new ResendMailer(apiKey, from);
  }

  async send(mail: Mail): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.body,
      }),
    });

    if (!response.ok) {
      // The caller turns this into a generic answer: whether an address exists
      // must not be inferable from a reset request, and neither must whether
      // our provider is having a bad day.
      const detail = await response.text().catch(() => '');
      throw new Error(`resend responded ${response.status}: ${detail.slice(0, 200)}`);
    }
  }
}
