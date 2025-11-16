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
  const priceValue = Number(ticket.price || 0).toLocaleString();
  const ticketTypeLabel =
    ticket.ticketType === "vip" ? "VIP Table (5 Persons)" : "Normal Ticket";

  const details = [
    ticket.ticketNumber ? `• Ticket Number: ${ticket.ticketNumber}` : null,
    `• Ticket Type: ${ticketTypeLabel}`,
    `• Quantity: ${ticket.quantity}`,
    `• Total Price: Rs. ${priceValue}`,
    `• Status: ${ticket.status}`,
  ].filter(Boolean);

  let message = `Hello ${
    ticket.name
  },\n\nSindhuli Concert - BrotherHood Nepal x NLT\n\nYour ticket has been processed with the following details:\n${details.join(
    "\n"
  )}\n\nPlease present your QR code at the event entrance and avoid sharing it publicly.\n\n`;

  if (qrImageUrl) {
    message += `QR Code Link: ${qrImageUrl}\n\n`;
  }

  message += `Sent via sindhulibazar.com\nThank you!`;

  return message;
}
