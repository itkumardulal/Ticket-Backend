import { Router } from "express";
import jwt from "jsonwebtoken";
import { literal, Op } from "sequelize";
import QRCode from "qrcode";
import { validateAdminCredentials } from "../models/admin.js";
import { Ticket, findTicketByToken, sanitizeTicket } from "../models/ticket.js";
import { requireAdmin } from "../middleware/auth.js";
import { sendTicketEmail } from "../mailer.js";
import { uploadQRToR2 } from "../utils/r2.js";
import { buildWhatsAppUrl, buildWhatsAppMessage } from "../utils/whatsapp.js";

const router = Router();

// POST /api/admin/login -> returns JWT
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password)
      return res.status(400).json({ error: "Username and password required" });
    const admin = await validateAdminCredentials(username, password);
    if (!admin) return res.status(401).json({ error: "Invalid credentials" });
    const token = jwt.sign(
      { id: admin.id, username: admin.username },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "8h" }
    );
    return res.json({ token });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Login failed" });
  }
});

const STATUS_ORDER = literal(
  "FIELD(status, 'pending','approved','cancelled','checkedin')"
);

const ALLOWED_LIMITS = new Set([10, 20, 50, 100]);
const DEFAULT_LIMIT = 10; // Fixed to 10 items per page

async function buildSanitizedTicketWithQr(ticket, req) {
  if (!ticket) return null;
  const sanitized = sanitizeTicket(ticket);
  try {
    const payload = JSON.stringify({ token: ticket.token });
    sanitized.qrCode = await QRCode.toDataURL(payload);
    // Use stored R2 URL if available, otherwise fallback
    sanitized.qrImageUrl = ticket.qrImageUrl || sanitized.qrCode;
  } catch (err) {
    console.error("Failed to generate QR for ticket", ticket.id, err);
    sanitized.qrCode = null;
    sanitized.qrImageUrl = ticket.qrImageUrl || null;
  }
  return sanitized;
}

// GET /api/admin/tickets -> fetch tickets with pagination and filters
router.get("/tickets", requireAdmin, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    let limit = parseInt(req.query.limit, 10) || 10;
    if (!ALLOWED_LIMITS.has(limit)) {
      limit = 10;
    }
    const offset = (page - 1) * limit;

    // Backend filtering
    const statusFilter = (req.query.status || "").toLowerCase();
    const viewType = (req.query.view || "").toLowerCase(); // "review" or "book"
    const quickFilter = (req.query.quickFilter || "").toLowerCase(); // "remaining", "scanned", "all"

    const where = {};

    // View-specific status filtering
    if (viewType === "review") {
      // Review page: only show pending, approved, cancelled
      where.status = { [Op.in]: ["pending", "approved", "cancelled"] };
      if (statusFilter && statusFilter !== "all") {
        where.status = statusFilter;
      }
    } else if (viewType === "book") {
      // Book page: only show approved, checkedin
      where.status = { [Op.in]: ["approved", "checkedin"] };
      if (statusFilter && statusFilter !== "all") {
        where.status = statusFilter;
      }
    } else {
      // Default: apply status filter if provided
      if (statusFilter && statusFilter !== "all") {
        where.status = statusFilter;
      }
    }

    // Apply quick filters at DB level
    if (quickFilter === "remaining") {
      where.remaining = { [Op.gt]: 0 };
    } else if (quickFilter === "scanned") {
      where.remaining = 0;
      where.scanCount = { [Op.gt]: 0 };
    }

    const { count, rows } = await Ticket.findAndCountAll({
      where,
      limit,
      offset,
      order: [
        [STATUS_ORDER, "ASC"],
        ["createdAt", "DESC"],
      ],
    });

    const items = rows;

    // Build sanitized tickets with QR
    const sanitizedItems = await Promise.all(
      items.map((ticket) => buildSanitizedTicketWithQr(ticket, req))
    );

    const totalPages = Math.max(Math.ceil(count / limit), 1);

    return res.json({
      data: sanitizedItems,
      totalItems: count,
      totalPages,
      currentPage: page,
      limit,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

// POST /api/admin/tickets/:id/approve -> send email with QR, mark as approved
router.post("/tickets/:id/approve", requireAdmin, async (req, res) => {
  try {
    const ticketId = (req.params.id || "").trim();
    if (!ticketId) {
      return res.status(400).json({ error: "Invalid ticket id" });
    }
    const ticket = await Ticket.findByPk(ticketId);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    if (ticket.status === "cancelled") {
      return res.status(400).json({ error: "Ticket is cancelled" });
    }
    if (ticket.status === "approved") {
      return res.status(400).json({ error: "Ticket already approved" });
    }

    // Generate QR code
    const qrPayload = JSON.stringify({ token: ticket.token });
    const qrBuffer = await QRCode.toBuffer(qrPayload, { type: "png" });
    const qrDataUrl = await QRCode.toDataURL(qrPayload);

    // Upload QR to R2
    let qrImageUrl = null;
    try {
      const filename = `ticket-${ticket.token}.png`;
      qrImageUrl = await uploadQRToR2(qrBuffer, filename);
      ticket.qrImageUrl = qrImageUrl;
    } catch (r2Err) {
      console.error("Failed to upload QR to R2:", r2Err);
      // Continue without R2 URL, use data URL fallback
    }

    let responseMessage = "Ticket approved and email sent";
    let mailError = null;

    try {
      await sendTicketEmail({
        toEmail: ticket.email,
        name: ticket.name,
        qrDataUrl: qrImageUrl || qrDataUrl, // Use R2 URL if available
        ticketType: ticket.ticketType,
        quantity: ticket.quantity,
        unitPrice: ticket.unitPrice,
        totalPrice: ticket.price,
        vipSeats: ticket.vipSeats,
        ticketNumber: ticket.ticketNumber,
      });
      ticket.emailSent = true;
      ticket.sentAt = new Date();
      ticket.status = "approved";
      console.log("Ticket email sent", {
        ticketId: ticket.id,
        email: ticket.email,
        qrImageUrl,
      });
    } catch (mailErr) {
      mailError = mailErr;
      responseMessage = "Email failed to send — ticket returned to pending";
      ticket.emailSent = false;
      ticket.sentAt = null;
      ticket.status = "pending";
      console.error("Ticket email failed", {
        ticketId: ticket.id,
        email: ticket.email,
        error: mailErr?.message || mailErr,
      });
    }

    await ticket.save();

    const payload = {
      message: responseMessage,
      ticket: await buildSanitizedTicketWithQr(ticket, req),
    };
    if (mailError) {
      payload.error = mailError?.message || String(mailError);
    }

    return res.json(payload);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to approve ticket" });
  }
});

// POST /api/admin/tickets/:id/cancel -> mark as cancelled
router.post("/tickets/:id/cancel", requireAdmin, async (req, res) => {
  try {
    const ticketId = (req.params.id || "").trim();
    if (!ticketId) {
      return res.status(400).json({ error: "Invalid ticket id" });
    }
    const ticket = await Ticket.findByPk(ticketId);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    ticket.status = "cancelled";
    await ticket.save();

    return res.json({
      message: "Ticket cancelled",
      ticket: await buildSanitizedTicketWithQr(ticket, req),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to cancel ticket" });
  }
});

// POST /api/admin/tickets/:id/whatsapp -> generate WhatsApp wa.me link with QR image
router.post("/tickets/:id/whatsapp", requireAdmin, async (req, res) => {
  try {
    const ticketId = (req.params.id || "").trim();
    if (!ticketId) {
      return res.status(400).json({ error: "Invalid ticket id" });
    }
    const ticket = await Ticket.findByPk(ticketId);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    if (!ticket.phone) {
      return res.status(400).json({ error: "Phone number not available" });
    }

    // Ensure QR is uploaded to R2
    let qrImageUrl = ticket.qrImageUrl;
    if (!qrImageUrl) {
      const qrPayload = JSON.stringify({ token: ticket.token });
      const qrBuffer = await QRCode.toBuffer(qrPayload, { type: "png" });
      const filename = `ticket-${ticket.token}.png`;
      try {
        qrImageUrl = await uploadQRToR2(qrBuffer, filename);
        ticket.qrImageUrl = qrImageUrl;
        await ticket.save();
      } catch (r2Err) {
        console.error("Failed to upload QR to R2:", r2Err);
        return res.status(500).json({
          error: "Failed to generate QR image for WhatsApp",
        });
      }
    }

    // Build WhatsApp message with QR URL
    const message = buildWhatsAppMessage(ticket, qrImageUrl);

    // Generate wa.me URL
    const whatsappUrl = buildWhatsAppUrl(ticket.phone, message);

    // Mark as sent (user will open the link)
    ticket.whatsappSent = true;
    await ticket.save();

    return res.json({
      success: true,
      whatsappSent: true,
      whatsappUrl,
      ticket: await buildSanitizedTicketWithQr(ticket, req),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to generate WhatsApp link" });
  }
});

function isAdminRequest(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const tokenStr = authHeader.slice(7);
  try {
    return jwt.verify(tokenStr, process.env.JWT_SECRET || "secret");
  } catch (err) {
    return null;
  }
}

// POST /api/admin/verify -> { token: 'uuid', count?: number } verify scanned QR
router.post("/verify", async (req, res) => {
  try {
    const { token, count } = req.body || {};
    if (!token) return res.status(400).json({ error: "Token required" });

    const ticket = await findTicketByToken(token);
    if (!ticket) {
      return res.status(404).json({
        error: "Invalid QR",
        message: "Invalid QR",
      });
    }

    const adminPayload = isAdminRequest(req);
    const isAdmin = Boolean(adminPayload);

    if (!isAdmin) {
      if (ticket.status === "cancelled") {
        return res.json({
          status: "cancelled",
          message:
            "Ticket cancelled. Please contact the event support team for assistance.",
          ticket: await buildSanitizedTicketWithQr(ticket, req),
        });
      }
      if (ticket.remaining <= 0) {
        return res.json({
          status: "no_remaining",
          message: "Tickets already scanned — no people remaining.",
          ticket: await buildSanitizedTicketWithQr(ticket, req),
        });
      }
      return res.json({
        status: "valid",
        message:
          "Ticket booked successfully. Do not share with others. Show at the gate during the event.",
        ticket: await buildSanitizedTicketWithQr(ticket, req),
      });
    }

    if (ticket.status === "cancelled") {
      return res.json({
        status: "cancelled",
        message: "Ticket is cancelled. Entry not permitted.",
        ticket: await buildSanitizedTicketWithQr(ticket, req),
      });
    }

    if (ticket.remaining <= 0) {
      return res.json({
        status: "no_remaining",
        message: "Tickets already scanned — no people remaining.",
        ticket: await buildSanitizedTicketWithQr(ticket, req),
      });
    }

    const alreadyScanned = ticket.scanCount > 0;

    let checkInCount = parseInt(count, 10);
    if (!Number.isInteger(checkInCount) || checkInCount <= 0) {
      if (ticket.remaining === 1) {
        checkInCount = 1;
      } else {
        return res.json({
          status: "awaiting_count",
          message: alreadyScanned
            ? `Already scanned. People remaining: ${ticket.remaining}`
            : "Enter number of people to check in.",
          ticket: await buildSanitizedTicketWithQr(ticket, req),
        });
      }
    }

    if (checkInCount > ticket.remaining) {
      checkInCount = ticket.remaining;
    }

    ticket.remaining -= checkInCount;
    ticket.scanCount += checkInCount;
    if (ticket.remaining === 0) {
      ticket.status = "checkedin";
    }
    await ticket.save();

    return res.json({
      status: "checked_in",
      message: `${checkInCount} people entered. ${ticket.remaining} remaining.`,
      entered: checkInCount,
      ticket: await buildSanitizedTicketWithQr(ticket, req),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Verification failed" });
  }
});

export default router;
