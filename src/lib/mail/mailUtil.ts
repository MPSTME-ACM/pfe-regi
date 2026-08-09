import nodemailer from "nodemailer";
import 'dotenv/config';
import type { EventConfig } from '@/lib/db/schema';
import type { Sku } from '@/lib/pricing/resolvePrice';

// ─────────────────────────────────────────────────────────────────────────────
// The confirmation email.
//
// Nothing about the event is written down in here. Dates, times, venue, contact
// address and the WhatsApp link all arrive on the payload, read from
// settings.eventConfig by the caller, so changing a date is an admin-panel edit
// and not a deploy. The body describes what the buyer actually bought — their
// SKU and their specific tracks — rather than 2025's single "domain" string.
//
// `html` below is COMPILED OUTPUT from src/lib/mail/mail.mjml (mjml 5.4.0, via
// `npx mjml src/lib/mail/mail.mjml -o …`; mjml is deliberately not a project
// dependency). Edit the .mjml, regenerate, paste back. Every ${…} placeholder in
// that file must match a local declared just above the literal here.
// ─────────────────────────────────────────────────────────────────────────────

const lastSentTimes = new Map<string, number>();

function canSendEmail(mail: string) {
  const now = Date.now();
  if (lastSentTimes.has(mail)) {
    const lastSent = lastSentTimes.get(mail)!;
    if (now - lastSent < 180000) {
      return false;
    }
  }
  setTimeout(() => lastSentTimes.delete(mail), 180000);
  return true;
}

/** One line of the "your days" schedule: a track, or the capstone day. */
export interface TicketItem {
  /** Display name, e.g. "Python" or "Capstone Day". */
  name: string;
  segment: 'beginner' | 'advanced' | 'capstone';
  /** ISO dates this item runs on, e.g. ['2026-09-17', '2026-09-18']. */
  dates: string[];
}

/**
 * Everything the ticket email needs, in one object.
 *
 * Structured rather than positional on purpose: the 2025 signature was
 * `(mail, domain, name, qrUrl, orderId)` and a bundle buyer cannot be described
 * by one `domain` string at all.
 */
export interface TicketMail {
  /** Recipient. Also the key for the per-process send throttle. */
  to: string;
  name: string;
  orderId: string;
  sku: Sku;
  /** What the SKU actually bought, in programme order. May be empty. */
  items: TicketItem[];
  /** data:image/png;base64 QR. Attached as cid:qr-code, never inlined. */
  qrUrl: string;
  /** settings.eventConfig — the single source of dates, venue and contacts. */
  event: EventConfig;
}

/** Buyer-facing names for the three SKUs. */
export const SKU_LABELS: Record<Sku, string> = {
  capstone: 'Capstone Day',
  single: 'Single Track',
  bundle: 'Full Bundle',
};

const SEGMENT_LABELS: Record<TicketItem['segment'], string> = {
  beginner: 'Beginner',
  advanced: 'Advanced',
  capstone: 'Capstone',
};

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** '2026-09-17' -> { day: 17, month: 9, year: '2026' }, or null if not an ISO date. */
function parseIsoDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { day, month, year: m[1] };
}

/**
 * ['2026-09-17','2026-09-18'] -> "17 & 18 Sep 2026".
 *
 * Parsed off the string rather than through `new Date`: a Date would be read in
 * the server's timezone and could render 17 September as the 16th.
 */
export function formatDates(dates: string[]): string {
  if (dates.length === 0) return '';
  const parsed = dates.map(parseIsoDate);
  if (parsed.some((p) => p === null)) return dates.join(', ');

  const parts = parsed as NonNullable<(typeof parsed)[number]>[];
  const [first] = parts;
  const oneMonth = parts.every((p) => p.month === first.month && p.year === first.year);
  if (oneMonth) {
    return `${parts.map((p) => p.day).join(' & ')} ${MONTHS[first.month - 1]} ${first.year}`;
  }
  return parts.map((p) => `${p.day} ${MONTHS[p.month - 1]} ${p.year}`).join(', ');
}

/** Registrant-typed values go into HTML; nothing else on the payload does. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** "Python (Beginner) — 17 & 18 Sep 2026" per item. */
function scheduleLines(items: TicketItem[]): string[] {
  return items.map((item) => {
    const label = item.segment === 'capstone'
      ? item.name
      : `${item.name} (${SEGMENT_LABELS[item.segment]})`;
    const when = formatDates(item.dates);
    return when ? `${label} — ${when}` : label;
  });
}

export async function sendMail(input: TicketMail) {
  const { to, sku, items, event, orderId, qrUrl } = input;

  if (!canSendEmail(to)) {
    return;
  }
  lastSentTimes.set(to, Date.now());
  if (!process.env.SMTP_HOST) {
    throw new Error("SMTP_HOST is not defined in env");
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === "true", // true for 465
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  // ── Template locals ────────────────────────────────────────────────────────
  // These names are the contract with mail.mjml. Renaming one here without
  // renaming it there produces "undefined" in a real email that nobody sees
  // until a student forwards it.
  const { dateRange, timeRange, venue, contactEmail, whatsappUrl } = event;
  const skuLabel = SKU_LABELS[sku] ?? sku;
  const name = esc(input.name);

  const lines = scheduleLines(items);
  // Escaped per line, then joined with the break — otherwise the `&` in
  // "17 & 18 Sep" and any punctuation in a track name land in the HTML raw.
  const scheduleHtml = lines.length ? lines.map(esc).join('<br />') : esc(skuLabel);
  const scheduleText = lines.length
    ? lines.map((l) => `    - ${l}`).join('\n')
    : `    - ${skuLabel}`;
  const summary = items.map((i) => i.name).join(' + ') || skuLabel;

  const html = `
<!doctype html>
<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">

<head>
  <title>PFE Workshop Registration Confirmed</title>
  <!--[if !mso]><!-->
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!--<![endif]-->
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style type="text/css">
    #outlook a {
      padding: 0;
    }

    body {
      margin: 0;
      padding: 0;
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }

    table,
    td {
      border-collapse: collapse;
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }

    img {
      border: 0;
      height: auto;
      line-height: 100%;
      outline: none;
      text-decoration: none;
      -ms-interpolation-mode: bicubic;
    }

    p {
      display: block;
      margin: 13px 0;
    }
  </style>
  <!--[if mso]>
    <noscript>
    <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG/>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
    </xml>
    </noscript>
    <![endif]-->
  <!--[if lte mso 11]>
    <style type="text/css">
      .mj-outlook-group-fix { width:100% !important; }
    </style>
    <![endif]-->
  <style type="text/css">
    @media only screen and (min-width:480px) {
      .mj-column-per-100 {
        width: 100% !important;
        max-width: 100%;
      }
    }
  </style>
  <style media="screen and (min-width:480px)">
    .moz-text-html .mj-column-per-100 {
      width: 100% !important;
      max-width: 100%;
    }
  </style>
</head>

<body style="word-spacing:normal;background-color:#0d0d1a;">
  <div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">Your registration for Programming For Everyone is confirmed!</div>
  <div aria-label="PFE Workshop Registration Confirmed" aria-roledescription="email" role="article" lang="en" dir="ltr" style="word-spacing:normal;background-color:#0d0d1a;">
    <!-- Header Section -->
    <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="gradient-bg-outlook" role="presentation" style="width:600px;" width="600" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    <div class="gradient-bg" style="background: linear-gradient(135deg, #1a0d1f 0%, #0d0d1a 50%, #1a0d1f 100%); margin: 0px auto; max-width: 600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;">
        <tbody>
          <tr>
            <td style="direction:ltr;font-size:0px;padding:40px 20px;text-align:center;">
              <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:560px;" ><![endif]-->
              <div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%">
                  <tbody>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:10px;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:32px;font-weight:bold;line-height:1.6;text-align:center;color:#ffffff;">PFE - Programming For Everyone</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:6px;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:18px;line-height:1.6;text-align:center;color:#f8c8fc;">by ACM MPSTME</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:14px;line-height:1.6;text-align:center;color:#cccccc;">${dateRange}</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!--[if mso | IE]></td></tr></table><![endif]-->
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!--[if mso | IE]></td></tr></table><![endif]-->
    <!-- Confirmation Message -->
    <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    <div style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;">
        <tbody>
          <tr>
            <td style="direction:ltr;font-size:0px;padding:40px 20px;text-align:center;">
              <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:560px;" ><![endif]-->
              <div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%">
                  <tbody>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:20px;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:24px;font-weight:bold;line-height:1.6;text-align:center;color:#1a0d1f;">Registration Confirmed! 🎉</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:30px;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:18px;line-height:1.6;text-align:center;color:#333333;">Hi ${name},<br> Your <span class="purple-text" style="font-weight: bold; color: #e97bfc;">${skuLabel}</span> registration is confirmed.</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!--[if mso | IE]></td></tr></table><![endif]-->
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!--[if mso | IE]></td></tr></table><![endif]-->
    <!-- Event Details -->
    <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#f8f9fa" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    <div style="background:#f8f9fa;background-color:#f8f9fa;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#f8f9fa;background-color:#f8f9fa;width:100%;">
        <tbody>
          <tr>
            <td style="direction:ltr;font-size:0px;padding:30px 20px;text-align:center;">
              <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:560px;" ><![endif]-->
              <div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%">
                  <tbody>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:20px;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:20px;font-weight:bold;line-height:1.6;text-align:center;color:#1a0d1f;">Your Registration</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="left" class="details-table" style="font-size:0px;padding:10px 25px;word-break:break-word;">
                        <table cellpadding="0" cellspacing="0" width="100%" border="0" style="color:#000000;font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:13px;line-height:22px;table-layout:auto;width:100%;border:none;">
                          <tr>
                            <td class="details-label" style="font-weight: bold; color: #1a0d1f; width: 120px; padding: 12px 0; vertical-align: top;" width="120" valign="top">Event:</td>
                            <td class="details-value" style="color: #333333; padding: 12px 0; vertical-align: top;" valign="top">Programming For Everyone</td>
                          </tr>
                          <tr>
                            <td class="details-label" style="font-weight: bold; color: #1a0d1f; width: 120px; padding: 12px 0; vertical-align: top;" width="120" valign="top">You bought:</td>
                            <td class="purple-text" style="font-weight: bold; padding: 12px 0; vertical-align: top; color: #e97bfc;" valign="top">${skuLabel}</td>
                          </tr>
                          <tr>
                            <td class="details-label" style="font-weight: bold; color: #1a0d1f; width: 120px; padding: 12px 0; vertical-align: top;" width="120" valign="top">Your days:</td>
                            <td class="details-value" style="color: #333333; padding: 12px 0; vertical-align: top;" valign="top">${scheduleHtml}</td>
                          </tr>
                          <tr>
                            <td class="details-label" style="font-weight: bold; color: #1a0d1f; width: 120px; padding: 12px 0; vertical-align: top;" width="120" valign="top">Order ID:</td>
                            <td class="purple-text" style="font-weight: bold; padding: 12px 0; vertical-align: top; color: #e97bfc;" valign="top">${orderId}</td>
                          </tr>
                          <tr>
                            <td class="details-label" style="font-weight: bold; color: #1a0d1f; width: 120px; padding: 12px 0; vertical-align: top;" width="120" valign="top">Time:</td>
                            <td class="details-value" style="color: #333333; padding: 12px 0; vertical-align: top;" valign="top">${timeRange}</td>
                          </tr>
                          <tr>
                            <td class="details-label" style="font-weight: bold; color: #1a0d1f; width: 120px; padding: 12px 0; vertical-align: top;" width="120" valign="top">Venue:</td>
                            <td class="details-value" style="color: #333333; padding: 12px 0; vertical-align: top;" valign="top">${venue} <br>(Classroom details will be shared soon)</td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!--[if mso | IE]></td></tr></table><![endif]-->
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!--[if mso | IE]></td></tr></table><![endif]-->
    <!-- QR Code Section -->
    <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    <div style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;">
        <tbody>
          <tr>
            <td style="direction:ltr;font-size:0px;padding:40px 20px;text-align:center;">
              <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:560px;" ><![endif]-->
              <div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%">
                  <tbody>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:20px;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:20px;font-weight:bold;line-height:1.6;text-align:center;color:#1a0d1f;">Your Ticket</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:20px;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:14px;line-height:1.6;text-align:center;color:#666666;">Please present this QR code at the venue for entry</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="font-size:0px;padding:0;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:16px;line-height:1.6;text-align:center;color:#333333;">
                          <div style="
            background: #ffffff;
            border: 2px dashed #e97bfc;
            border-radius: 12px;
            padding: 15px;
            display: inline-block;
          ">
                            <img src="cid:qr-code" alt="Entry QR Code" width="200px" style="display: block;">
                          </div>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 25px;padding-top:10px;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:12px;line-height:1.6;text-align:center;color:#999999;">Save this email or take a screenshot for easy access</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!--[if mso | IE]></td></tr></table><![endif]-->
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!--[if mso | IE]></td></tr></table><![endif]-->
    <!-- Important Information -->
    <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#f8f9fa" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    <div style="background:#f8f9fa;background-color:#f8f9fa;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#f8f9fa;background-color:#f8f9fa;width:100%;">
        <tbody>
          <tr>
            <td style="direction:ltr;font-size:0px;padding:30px 20px;text-align:center;">
              <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:560px;" ><![endif]-->
              <div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%">
                  <tbody>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:15px;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:18px;font-weight:bold;line-height:1.6;text-align:center;color:#1a0d1f;">Important Information</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:14px;line-height:1.6;text-align:left;color:#333333;">• Bring your laptop/device for hands-on sessions</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:14px;line-height:1.6;text-align:left;color:#333333;">• Certificate of participation will be awarded only if at least 2 lectures are attended</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:14px;line-height:1.6;text-align:left;color:#333333;">• Workshop materials will be shared digitally</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!--[if mso | IE]></td></tr></table><![endif]-->
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!--[if mso | IE]></td></tr></table><![endif]-->
    <!-- Contact Information -->
    <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    <div style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;">
        <tbody>
          <tr>
            <td style="direction:ltr;font-size:0px;padding:30px 20px;text-align:center;">
              <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:560px;" ><![endif]-->
              <div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%">
                  <tbody>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:15px;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:18px;font-weight:bold;line-height:1.6;text-align:center;color:#1a0d1f;">Need Help?</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:20px;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:14px;line-height:1.6;text-align:center;color:#333333;">Contact us at <a href="mailto:${contactEmail}" style="color: #e97bfc; text-decoration: none;">${contactEmail}</a> or,</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 20px;word-break:break-word;">
                        <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%;">
                          <tbody>
                            <tr>
                              <td align="center" bgcolor="#e97bfc" role="presentation" style="border:none;border-radius:8px;cursor:auto;mso-padding-alt:10px 25px;background:#e97bfc;" valign="middle">
                                <a href="${whatsappUrl}" style="display:inline-block;background:#e97bfc;color:#000000;font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:14px;font-weight:bold;line-height:120%;margin:0;text-decoration:none;text-transform:none;padding:10px 25px;mso-padding-alt:0px;border-radius:8px;" target="_blank"> WhatsApp Support </a>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!--[if mso | IE]></td></tr></table><![endif]-->
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!--[if mso | IE]></td></tr></table><![endif]-->
    <!-- Footer -->
    <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="gradient-bg-outlook" role="presentation" style="width:600px;" width="600" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    <div class="gradient-bg" style="background: linear-gradient(135deg, #1a0d1f 0%, #0d0d1a 50%, #1a0d1f 100%); margin: 0px auto; max-width: 600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;">
        <tbody>
          <tr>
            <td style="direction:ltr;font-size:0px;padding:30px 20px;text-align:center;">
              <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:560px;" ><![endif]-->
              <div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%">
                  <tbody>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:10px;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:16px;font-weight:bold;line-height:1.6;text-align:center;color:#f8c8fc;"><a href="https://mpst.me" style="color: #e97bfc; text-decoration: none;">ACM MPSTME</a></div>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:10px;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:12px;line-height:1.6;text-align:center;color:#cccccc;">Mukesh Patel School of Technology Management &amp; Engineering</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;">
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:10px;line-height:1.6;text-align:center;color:#999999;">This email was sent because you registered for Programming For Everyone.</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!--[if mso | IE]></td></tr></table><![endif]-->
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!--[if mso | IE]></td></tr></table><![endif]-->
  </div>
</body>

</html>
  `;

  const text = `
  PFE Registration Confirmation

  Hi ${input.name},

  Your ${skuLabel} registration for Programming For Everyone is confirmed.

  Your Registration:
  - Event: Programming For Everyone (${dateRange})
  - You bought: ${skuLabel}
  - Your days:
${scheduleText}
  - Order ID: ${orderId}
  - Time: ${timeRange}
  - Venue: ${venue} (classroom details will be shared soon)

  Your Entry Pass:
  Please use the attached file "qr.png" as your entry QR code.
  Do not share this QR code with anyone.

  Important Information:
  - Bring your laptop/device for hands-on sessions.
  - Certificate of participation will be awarded only if at least 2 lectures are attended.

  Need Help?
  Email: ${contactEmail}
  WhatsApp: ${whatsappUrl}

  —
  ACM MPSTME
  Mukesh Patel School of Technology Management & Engineering
  `

  const base64Data = qrUrl.replace(/^data:image\/png;base64,/, "");

  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: `PFE Registration Confirmation for ${input.name} - ${summary}`,
    text,
    html,
    attachments: [
      {
        filename: "qr.png",
        content: base64Data,
        encoding: "base64",
        cid: "qr-code"
      },
    ],
  });

  return info;
}
