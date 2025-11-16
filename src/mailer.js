import sgMail from "@sendgrid/mail";
import axios from "axios";

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

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
  qrDataUrl, // Should be R2 URL
  ticketType,
  quantity,
  unitPrice,
  totalPrice,
  vipSeats,
  ticketNumber,
}) {
  const subject = "Sindhuli Concert Ticket - BrotherHood Nepal x NLT";

  const ticketLabel =
    ticketType === "vip" ? "VIP Table (5 Persons)" : "Normal Ticket";

  const detailsHtml = `
    <table style="width:100%;max-width:520px;border-collapse:collapse;font-size:14px;margin-top:16px;">
      <tbody>
        ${
          ticketNumber
            ? `<tr>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Ticket Number</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;">${ticketNumber}</td>
        </tr>`
            : ""
        }
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
            vipSeats || 5
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

  const qrLinkHtml = qrDataUrl
    ? `<p style="margin:16px 0;padding:12px 16px;border-radius:8px;background:#f3f4f6;color:#111;">
        QR Code Link: <a href="${qrDataUrl}" style="color:#2563eb;text-decoration:underline;">${qrDataUrl}</a>
      </p>`
    : "";

  const html = `
    <div style="font-family: Arial, sans-serif;color:#111;">
      <h2 style="margin-bottom:8px;">Sindhuli Concert - Your Ticket</h2>
      <p style="margin:0 0 12px;">Hello ${name},</p>
      <p style="margin:0 0 16px;">Thank you for choosing BrotherHood Nepal x NLT. Please present this QR code at the event entrance.</p>
      ${qrLinkHtml}
      ${vipInfo}
      ${detailsHtml}
      <p style="margin:16px 0 0;font-size:13px;color:#4b5563;">Show this QR code at the gate during the event. Do not share with others.</p>
      <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;"/>
      <p style="margin:0;font-size:13px;color:#6b7280;">BrotherHood Nepal in collaboration with Nepal Leadership Technology (NLT)</p>
    </div>
  `;

  // Fetch QR from R2 and attach as base64 string
  let attachments = [];
  if (qrDataUrl && qrDataUrl.startsWith("http")) {
    try {
      const response = await axios.get(qrDataUrl, {
        responseType: "arraybuffer",
      });
      // Convert buffer to base64 string for SendGrid
      const base64Content = Buffer.from(response.data).toString("base64");
      attachments = [
        {
          filename: "ticket-qr.png",
          content: base64Content,
          type: "image/png",
          disposition: "attachment",
        },
      ];
    } catch (err) {
      console.error("Failed to fetch QR from R2:", err);
      // Continue without attachment
    }
  }

  const msg = {
    to: toEmail,
    from: {
      email: process.env.MAIL_USER,
      name: "SindhuliBazzar",
    },
    subject,
    html,
    attachments,
  };

  try {
    await sgMail.send(msg);
    console.log("✅ Ticket email sent successfully to:", toEmail);
  } catch (error) {
    console.error(
      "❌ Ticket email failed:",
      error.response?.body || error.message
    );
    throw error;
  }
}
