/**
 * What the application needs from an email provider.
 *
 * A port rather than a direct dependency: swapping Resend for SendGrid, or for
 * a queue, should not reach into the reset flow. The provider is chosen at the
 * composition root, and nothing above this line knows which one it is.
 */
export interface Mail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * Development mailer: writes the message to the server log.
 *
 * Deliberately not silent — a reset flow that appears to work while sending
 * nothing is the kind of thing that is discovered in production.
 */
export class ConsoleMailer implements Mailer {
  async send(mail: Mail): Promise<void> {
    console.log(
      [
        '',
        '─────────── correo (modo desarrollo) ───────────',
        `para:    ${mail.to}`,
        `asunto:  ${mail.subject}`,
        '',
        mail.body,
        '────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
  }
}
