import nodemailer from 'nodemailer';
import { config } from './config';

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

export async function sendMail(to: string, subject: string, text: string) {
  if (config.MAIL_TRANSPORT === 'none') throw new Error('Mail is not configured');
  if (config.MAIL_TRANSPORT === 'console') {
    // Development only (rejected in production by config.ts)
    console.log(`\n📧 [dev mail] to=${to}\nsubject: ${subject}\n${text}\n`);
    return;
  }
  transporter ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  });
  await transporter.sendMail({ from: config.MAIL_FROM, to, subject, text });
}
