/**
 * Generate WhatsApp wa.me link with message
 * No API credentials needed - just opens WhatsApp directly
 */

/**
 * Build WhatsApp message URL
 * @param {string} toPhone - Recipient phone number
 * @param {string} message - Message text
 * @returns {string} WhatsApp wa.me URL
 */
export function buildWhatsAppUrl(toPhone, message) {
  // Clean phone number (remove + and spaces)
  const cleanPhone = toPhone.replace(/[^0-9]/g, "");
  const recipientId = cleanPhone.startsWith("977")
    ? cleanPhone
    : `977${cleanPhone}`;

  const encodedMessage = encodeURIComponent(message);
  return `https://wa.me/${recipientId}?text=${encodedMessage}`;
}

/**
 * Build WhatsApp message for ticket with QR image URL
 */
export function buildWhatsAppMessage(ticket, qrImageUrl) {
  const totalPrice =
    ticket.totalPrice ??
    ticket.price ??
    (ticket.unitPrice
      ? Number(ticket.unitPrice) * Number(ticket.quantity || 1)
      : 0);

  const qrLink = ticket.finalImageUrl || qrImageUrl || "";
  const message = `
Hello ${ticket.name},

Sindhuli Concert - EATSTREET x NLT
Your ticket has been processed with the following details:

• Ticket Number: ${ticket.ticketNumber}
• Ticket Type: ${ticket.ticketType}
• Quantity: ${ticket.quantity}
• Total Price: Rs. ${totalPrice}
• Status: ${ticket.status}

Please present your QR code at the event entrance and avoid sharing it publicly.
QR Code Link: ${qrLink}
Sent via sindhulibazar.com
Thank you!
`;

  return message.trim();
}
