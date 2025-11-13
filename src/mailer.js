import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

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

  const mailOptions = {
    from: `SindhuliBazzar <${process.env.MAIL_USER}>`,
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

  try {
    const result = await transporter.sendMail(mailOptions);
    console.log("✅ Email sent successfully to:", toEmail);
    return result;
  } catch (error) {
    console.error("❌ Error sending email:", error);
    throw error;
  }
}
