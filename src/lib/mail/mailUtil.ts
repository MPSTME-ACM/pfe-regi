import nodemailer from "nodemailer";
import 'dotenv/config';

const lastSentTimes = new Map();

function canSendEmail(mail: string) {
  const now = Date.now();
  if (lastSentTimes.has(mail)) {
    const lastSent = lastSentTimes.get(mail);
    if (now - lastSent < 180000) {
      return false;
    }
  }
  setTimeout(() => lastSentTimes.delete(mail), 180000);
  return true;
}

export async function sendMail(mail: string, domain: string, name: string, qrUrl: string) {
  if (!canSendEmail(mail)) {
    return;
  }
  lastSentTimes.set(mail, Date.now());
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

  const html = `
    <!doctype html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><title>PFE Workshop Registration Confirmed</title><!--[if !mso]><!--><meta http-equiv="X-UA-Compatible" content="IE=edge"><!--<![endif]--><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style type="text/css">#outlook a { padding:0; }
          body { margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%; }
          table, td { border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt; }
          img { border:0;height:auto;line-height:100%; outline:none;text-decoration:none;-ms-interpolation-mode:bicubic; }
          p { display:block;margin:13px 0; }</style><!--[if mso]>
        <noscript>
        <xml>
        <o:OfficeDocumentSettings>
          <o:AllowPNG/>
          <o:PixelsPerInch>96</o:PixelsPerInch>
        </o:OfficeDocumentSettings>
        </xml>
        </noscript>
        <![endif]--><!--[if lte mso 11]>
        <style type="text/css">
          .mj-outlook-group-fix { width:100% !important; }
        </style>
        <![endif]--><style type="text/css">@media only screen and (min-width:480px) {
        .mj-column-per-100 { width:100% !important; max-width: 100%; }
      }</style><style media="screen and (min-width:480px)">.moz-text-html .mj-column-per-100 { width:100% !important; max-width: 100%; }</style><style type="text/css">@media only screen and (max-width:480px) {
      table.mj-full-width-mobile { width: 100% !important; }
      td.mj-full-width-mobile { width: auto !important; }
    }</style></head><body style="word-spacing:normal;background-color:#0d0d1a;"><div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">Your registration for Programming For Everyone workshop is confirmed!</div><div style="background-color:#0d0d1a;"><!-- Header Section --><!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="gradient-bg-outlook" style="width:600px;" width="600" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]--><div class="gradient-bg" style="background: linear-gradient(135deg, #1a0d1f 0%, #0d0d1a 50%, #1a0d1f 100%); margin: 0px auto; max-width: 600px;"><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;"><tbody><tr><td style="direction:ltr;font-size:0px;padding:40px 20px;text-align:center;"><!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:560px;" ><![endif]--><div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"><tbody><tr><td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:10px;word-break:break-word;"><div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:32px;font-weight:bold;line-height:1.6;text-align:center;color:#ffffff;">PFE - Programming For Everyone</div></td></tr><tr><td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:0;word-break:break-word;"><div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:18px;line-height:1.6;text-align:center;color:#f8c8fc;">by ACM MPSTME</div></td></tr></tbody></table></div><!--[if mso | IE]></td></tr></table><![endif]--></td></tr></tbody></table></div><!--[if mso | IE]></td></tr></table><![endif]--><!-- Confirmation Message --><!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]--><div style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;"><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;"><tbody><tr><td style="direction:ltr;font-size:0px;padding:40px 20px;text-align:center;"><!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:560px;" ><![endif]--><div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"><tbody><tr><td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:20px;word-break:break-word;"><div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:24px;font-weight:bold;line-height:1.6;text-align:center;color:#1a0d1f;">Registration Confirmed! 🎉</div></td></tr><tr><td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:30px;word-break:break-word;"><div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:18px;line-height:1.6;text-align:center;color:#333333;">Hi ${name},<br>Welcome to the <span class="purple-text" style="color: #e97bfc;">${domain}</span> track!</div></td></tr></tbody></table></div><!--[if mso | IE]></td></tr></table><![endif]--></td></tr></tbody></table></div><!--[if mso | IE]></td></tr></table><![endif]--><!-- Event Details --><!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" style="width:600px;" width="600" bgcolor="#f8f9fa" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]--><div style="background:#f8f9fa;background-color:#f8f9fa;margin:0px auto;max-width:600px;"><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#f8f9fa;background-color:#f8f9fa;width:100%;"><tbody><tr><td style="direction:ltr;font-size:0px;padding:30px 20px;text-align:center;"><!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:560px;" ><![endif]--><div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"><tbody><tr><td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:20px;word-break:break-word;"><div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:20px;font-weight:bold;line-height:1.6;text-align:center;color:#1a0d1f;">Workshop Details</div></td></tr><tr><td align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;"><table cellpadding="0" cellspacing="0" width="100%" border="0" style="color:#000000;font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:13px;line-height:22px;table-layout:auto;width:100%;border:none;"><tr style="border-bottom: 1px solid #e0e0e0;"><td style="padding: 12px 0; font-weight: bold; color: #1a0d1f;">Event:</td><td style="padding: 12px 0; color: #333;">Programming For Everyone Workshop</td></tr><tr style="border-bottom: 1px solid #e0e0e0;"><td style="padding: 12px 0; font-weight: bold; color: #1a0d1f;">Domain:</td><td style="padding: 12px 0; color: #e97bfc; font-weight: bold;">${domain}</td></tr><tr style="border-bottom: 1px solid #e0e0e0;"><td style="padding: 12px 0; font-weight: bold; color: #1a0d1f;">Dates:</td><td style="padding: 12px 0; color: #333;">16 - 18 September</td></tr><tr style="border-bottom: 1px solid #e0e0e0;"><td style="padding: 12px 0; font-weight: bold; color: #1a0d1f;">Time:</td><td style="padding: 12px 0; color: #333;">5:00 PM - 7:00 PM (All 3 days)</td></tr><tr><td style="padding: 12px 0; font-weight: bold; color: #1a0d1f;">Venue:</td><td style="padding: 12px 0; color: #333;">MPSTME Campus, Mumbai. (Classroom details will be shared soon)</td></tr></table></td></tr></tbody></table></div><!--[if mso | IE]></td></tr></table><![endif]--></td></tr></tbody></table></div><!--[if mso | IE]></td></tr></table><![endif]--><!-- QR Code Section --><!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]--><div style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;"><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;"><tbody><tr><td style="direction:ltr;font-size:0px;padding:40px 20px;text-align:center;"><!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:560px;" ><![endif]--><div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"><tbody><tr><td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:20px;word-break:break-word;"><div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:20px;font-weight:bold;line-height:1.6;text-align:center;color:#1a0d1f;">Your Entry Pass</div></td></tr><tr><td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:20px;word-break:break-word;"><div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:14px;line-height:1.6;text-align:center;color:#666666;">Please present this QR code at the venue for entry</div></td></tr><tr><td align="center" class="qr-container" style="background: rgba(255, 255, 255, 0.95); border-radius: 12px; font-size: 0px; padding: 20px; word-break: break-word;"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;"><tbody><tr><td style="width:200px;"><img alt="Entry QR Code" height="200" src="cid:qr-code" style="border:0;display:block;outline:none;text-decoration:none;height:200px;width:100%;font-size:13px;" width="200"></td></tr></tbody></table></td></tr><tr><td align="center" style="font-size:0px;padding:10px 25px;padding-top:10px;word-break:break-word;"><div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:12px;line-height:1.6;text-align:center;color:#999999;">Save this email or take a screenshot for easy access</div></td></tr></tbody></table></div><!--[if mso | IE]></td></tr></table><![endif]--></td></tr></tbody></table></div><!--[if mso | IE]></td></tr></table><![endif]--><!-- Important Information --><!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" style="width:600px;" width="600" bgcolor="#f8f9fa" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]--><div style="background:#f8f9fa;background-color:#f8f9fa;margin:0px auto;max-width:600px;"><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#f8f9fa;background-color:#f8f9fa;width:100%;"><tbody><tr><td style="direction:ltr;font-size:0px;padding:30px 20px;text-align:center;"><!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:560px;" ><![endif]--><div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"><tbody><tr><td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:15px;word-break:break-word;"><div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:18px;font-weight:bold;line-height:1.6;text-align:center;color:#1a0d1f;">Important Information</div></td></tr><tr><td align="left" style="font-size:0px;padding:10px 25px;padding-bottom:10px;word-break:break-word;"><div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:14px;line-height:1.6;text-align:left;color:#333333;">• Bring your laptop/device for hands-on sessions</div></td></tr><tr><td align="left" style="font-size:0px;padding:10px 25px;padding-bottom:10px;word-break:break-word;"><div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:14px;line-height:1.6;text-align:left;color:#333333;">• Certificate of participation will be awarded only if atleast 2 lectures are attended.</div></td></tr><tr><td align="left" style="font-size:0px;padding:10px 25px;padding-bottom:10px;word-break:break-word;"><div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:14px;line-height:1.6;text-align:left;color:#333333;">• Workshop materials will be shared digitally</div></td></tr></tbody></table></div><!--[if mso | IE]></td></tr></table><![endif]--></td></tr></tbody></table></div><!--[if mso | IE]></td></tr></table><![endif]--><!-- Contact Information --><!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]--><div style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;"><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;"><tbody><tr><td style="direction:ltr;font-size:0px;padding:30px 20px;text-align:center;"><!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:560px;" ><![endif]--><div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"><tbody><tr><td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:15px;word-break:break-word;"><div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:18px;font-weight:bold;line-height:1.6;text-align:center;color:#1a0d1f;">Need Help?</div></td></tr><tr><td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:20px;word-break:break-word;"><div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:14px;line-height:1.6;text-align:center;color:#333333;">Contact us at <a href="mailto:pfe@mpst.me" style="color: #e97bfc; text-decoration: none;">pfe@mpst.me</a> or,</div></td></tr><tr><td align="center" vertical-align="middle" style="font-size:0px;padding:10px 20px;word-break:break-word;"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%;"><tr><td align="center" bgcolor="#e97bfc" role="presentation" style="border:none;border-radius:8px;cursor:auto;mso-padding-alt:10px 25px;background:#e97bfc;" valign="middle"><a href="https://wa.me/919076195651" style="display:inline-block;background:#e97bfc;color:#000000;font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:14px;font-weight:bold;line-height:120%;margin:0;text-decoration:none;text-transform:none;padding:10px 25px;mso-padding-alt:0px;border-radius:8px;" target="_blank">WhatsApp Support</a></td></tr></table></td></tr></tbody></table></div><!--[if mso | IE]></td></tr></table><![endif]--></td></tr></tbody></table></div><!--[if mso | IE]></td></tr></table><![endif]--><!-- Footer --><!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="gradient-bg-outlook" style="width:600px;" width="600" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]--><div class="gradient-bg" style="background: linear-gradient(135deg, #1a0d1f 0%, #0d0d1a 50%, #1a0d1f 100%); margin: 0px auto; max-width: 600px;"><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;"><tbody><tr><td style="direction:ltr;font-size:0px;padding:30px 20px;text-align:center;"><!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:560px;" ><![endif]--><div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"><tbody><tr><td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:10px;word-break:break-word;"><div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:16px;font-weight:bold;line-height:1.6;text-align:center;color:#f8c8fc;"><a href="https://mpst.me" style="color: #e97bfc; text-decoration: none;">ACM MPSTME</a></div></td></tr><tr><td align="center" style="font-size:0px;padding:10px 25px;padding-bottom:10px;word-break:break-word;"><div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:12px;line-height:1.6;text-align:center;color:#cccccc;">Mukesh Patel School of Technology Management &amp; Engineering</div></td></tr><tr><td align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"><div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;font-size:10px;line-height:1.6;text-align:center;color:#999999;">This email was sent because you registered and paid for the PFE Workshop 2025.</div></td></tr></tbody></table></div><!--[if mso | IE]></td></tr></table><![endif]--></td></tr></tbody></table></div><!--[if mso | IE]></td></tr></table><![endif]--></div></body></html>
  `;

  const text = `
  🎉 PFE Workshop Registration Confirmed

  Hi ${name},

  Your registration for the "${domain}" track at the Programming For Everyone Workshop has been confirmed.

  📌 Workshop Details:
  - Event: Programming For Everyone Workshop
  - Domain: ${domain}
  - Dates: 16 - 18 September
  - Time: 5:00 PM - 7:00 PM (All 3 days)
  - Venue: MPSTME Campus, Mumbai (classroom details will be shared soon)

  🎟️ Your Entry Pass:
  Please use the attached file "qr.png" as your entry QR code.
  Do not share this QR code with anyone.

  ℹ️ Important Information:
  - Bring your laptop/device for hands-on sessions.
  - Certificate of participation will be awarded only if at least 2 lectures are attended.

  ❓ Need Help?
  Email: pfe@mpst.me
  WhatsApp: https://wa.me/919076195651

  —
  ACM MPSTME
  Mukesh Patel School of Technology Management & Engineering
  `

  const base64Data = qrUrl.replace(/^data:image\/png;base64,/, "");

  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: mail,
    subject: `PFE Registration Confirmation for ${name} - ${domain}`,
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