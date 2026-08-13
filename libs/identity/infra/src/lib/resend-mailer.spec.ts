import { ResendMailer } from './resend-mailer';

describe('sending a reset link for real', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    jest.restoreAllMocks();
  });

  it('is absent until both settings are there', () => {
    // Half-configured is not configured: a key with no verified sender sends
    // nothing, and pretending otherwise hides the problem until someone is
    // locked out.
    delete process.env['RESEND_API_KEY'];
    delete process.env['MAIL_FROM'];
    expect(ResendMailer.fromEnvironment()).toBeNull();

    process.env['RESEND_API_KEY'] = 'key';
    expect(ResendMailer.fromEnvironment()).toBeNull();

    process.env['MAIL_FROM'] = 'Itadaki <hola@itadaki.ar>';
    expect(ResendMailer.fromEnvironment()).not.toBeNull();
  });

  it('treats an empty setting as missing', () => {
    process.env['RESEND_API_KEY'] = '';
    process.env['MAIL_FROM'] = 'Itadaki <hola@itadaki.ar>';
    expect(ResendMailer.fromEnvironment()).toBeNull();
  });

  it('sends the message to the provider', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    await new ResendMailer('secreta', 'Itadaki <hola@itadaki.ar>').send({
      to: 'duena@resto.test',
      subject: 'Recuperar tu contraseña',
      body: 'https://admin.itadaki.ar/reset?token=abc',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');

    const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(sent['to']).toEqual(['duena@resto.test']);
    expect(sent['from']).toBe('Itadaki <hola@itadaki.ar>');
    expect(sent['text']).toContain('token=abc');
  });

  it('carries the key in the header, never in the body', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    await new ResendMailer('secreta', 'Itadaki <hola@itadaki.ar>').send({
      to: 'x@y.test',
      subject: 's',
      body: 'b',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secreta');
    expect(String(init.body)).not.toContain('secreta');
  });

  it('fails loudly when the provider rejects it', async () => {
    // Swallowing this would leave the caller believing the mail went out.
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('dominio no verificado', { status: 403 }));

    await expect(
      new ResendMailer('key', 'Itadaki <hola@itadaki.ar>').send({
        to: 'x@y.test',
        subject: 's',
        body: 'b',
      }),
    ).rejects.toThrow('403');
  });
});
