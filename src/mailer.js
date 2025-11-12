import nodemailer from "nodemailer";

let cachedTransporter = null;

async function getTransporter() {
  // Use real SMTP if configured properly
  const host = process.env.MAIL_HOST;
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASS;

  const usingPlaceholder =
    !host ||
    host === "smtp.example.com" ||
    !user ||
    !pass ||
    String(user).includes("example.com");

  if (usingPlaceholder) {
    // Development fallback: create Ethereal test account (no real email sent)
    const account = await nodemailer.createTestAccount();
    return nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: account.user,
        pass: account.pass,
      },
    });
  }

  // Cache real transporter
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host,
      port: Number(process.env.MAIL_PORT || 587),
      secure: false,
      auth: { user, pass },
    });
  }
  return cachedTransporter;
}

function formatCurrency(value) {
  const amount = Number(value);
  if (Number.isNaN(amount)) return value;
  return `Rs. ${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export async function sendTicketEmail({
  toEmail,
  name,
  qrDataUrl,
  ticketType,
  quantity,
  unitPrice,
  totalPrice,
  vipSeats,
}) {
  const subject = "Sindhuli Concert Ticket - BrotherHood Nepal x NLT";
  // Extract base64 from data URL if present
  let qrContentBase64 = null;
  let qrContentType = "image/png";
  if (qrDataUrl && qrDataUrl.startsWith("data:")) {
    const match = qrDataUrl.match(/^data:(.+);base64,(.+)$/);
    if (match) {
      qrContentType = match[1] || "image/png";
      qrContentBase64 = match[2];
    }
  }

  const ticketLabel =
    ticketType === "vip" ? "VIP Table (8 Persons)" : "Normal Ticket";

  const detailsHtml = `
    <table style="width:100%;max-width:520px;border-collapse:collapse;font-size:14px;margin-top:16px;">
      <tbody>
        <tr>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Ticket Type</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;">${ticketLabel}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Quantity</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;">${quantity}</td>
        </tr>
        ${
          ticketType === "vip"
            ? `<tr>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Seats Included</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;">${
            vipSeats || 8
          } people</td>
        </tr>`
            : ""
        }
        <tr>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Unit Price</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;">${formatCurrency(
            unitPrice
          )}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Total Price</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;">${formatCurrency(
            totalPrice
          )}</td>
        </tr>
      </tbody>
    </table>
  `;

  const vipInfo =
    ticketType === "vip"
      ? `<p style="margin:16px 0;padding:12px 16px;border-radius:8px;background:#f3f4f6;color:#111;">
          VIP tables are located at the front of the stage with premium seating for your group. Please arrive early to enjoy the experience.
        </p>`
      : "";

  const html = `
		<div style="font-family: Arial, sans-serif;color:#111;">
			<h2 style="margin-bottom:8px;">Sindhuli Concert - Your Ticket</h2>
			<p style="margin:0 0 12px;">Hello ${name},</p>
			<p style="margin:0 0 16px;">Thank you for choosing BrotherHood Nepal x NLT. Please present this QR code at the event entrance.</p>
			<p style="margin:0 0 16px;text-align:center;">
        <img src="cid:ticketqr" alt="Ticket QR" style="max-width:280px;border:1px solid #e5e7eb;border-radius:8px;" />
      </p>
      ${vipInfo}
      ${detailsHtml}
			<p style="margin:16px 0 0;font-size:13px;color:#4b5563;">Do not share this QR code publicly. It grants entry for the number of people listed above.</p>
			<hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;"/>
			<p style="margin:0;font-size:13px;color:#6b7280;">BrotherHood Nepal in collaboration with Nepal Leadership Technology (NLT)</p>
		</div>
	`;
  const transporter = await getTransporter();
  const mailOptions = {
    from: process.env.MAIL_USER || "no-reply@sindhuli.local",
    to: toEmail,
    subject,
    html,
  };
  if (qrContentBase64) {
    mailOptions.attachments = [
      {
        filename: "ticket-qr.png",
        content: Buffer.from(qrContentBase64, "base64"),
        encoding: "base64",
        contentType: qrContentType,
        cid: "ticketqr",
      },
    ];
  }
  const info = await transporter.sendMail(mailOptions);
  const previewUrl = nodemailer.getTestMessageUrl(info) || null;
  return { info, previewUrl };
}
