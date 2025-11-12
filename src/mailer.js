import nodemailer from "nodemailer";

let cachedTransporter = null;
let lastVerify = 0;
const VERIFY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function getTransporter() {
  const host = process.env.MAIL_HOST;
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASS;
  const port = Number(process.env.MAIL_PORT || 587);

  const usingPlaceholder =
    !host ||
    host === "smtp.example.com" ||
    !user ||
    !pass ||
    String(user).includes("example.com");

  if (usingPlaceholder) {
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

  if (!cachedTransporter) {
    const secure = port === 465;
    cachedTransporter = nodemailer.createTransport({
      host,
      port,
      secure,
      pool: true,
      maxConnections: 3,
      maxMessages: 50,
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }

  const now = Date.now();
  if (now - lastVerify > VERIFY_INTERVAL_MS) {
    try {
      await cachedTransporter.verify();
      lastVerify = now;
      console.log("SMTP connection verified");
    } catch (verifyError) {
      console.error("SMTP verify failed", verifyError?.message || verifyError);
      cachedTransporter.close?.();
      cachedTransporter = null;
      lastVerify = 0;
      throw verifyError;
    }
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

async function sendWithRetry(transporter, mailOptions, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      console.log("Sending ticket email", { attempt, to: mailOptions.to });
      return await transporter.sendMail(mailOptions);
    } catch (err) {
      lastError = err;
      console.error("Ticket email send attempt failed", {
        attempt,
        error: err?.message || err,
      });
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw lastError;
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
			<p style="margin:16px 0 0;font-size:13px;color:#4b5563;">Show this QR code at the gate during the event. Do not share with others.</p>
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

  return await sendWithRetry(transporter, mailOptions);
}
