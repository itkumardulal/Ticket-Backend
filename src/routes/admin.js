import { Router } from "express";
import jwt from "jsonwebtoken";
import { literal } from "sequelize";
import QRCode from "qrcode";
import { validateAdminCredentials } from "../models/admin.js";
import { Ticket, findTicketByToken, sanitizeTicket } from "../models/ticket.js";
import { requireAdmin } from "../middleware/auth.js";
import { sendTicketEmail } from "../mailer.js";

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

// GET /api/admin/tickets -> fetch tickets with pagination and filters
router.get("/tickets", requireAdmin, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    let limit = parseInt(req.query.limit, 10) || 20;
    if (!ALLOWED_LIMITS.has(limit)) {
      limit = 20;
    }
    const statusFilter = (req.query.status || "").toLowerCase();
    const offset = (page - 1) * limit;

    const where = {};
    if (statusFilter && statusFilter !== "all") {
      where.status = statusFilter;
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

    const items = rows.map((ticket) => sanitizeTicket(ticket));
    const totalPages = Math.max(Math.ceil(count / limit), 1);

    return res.json({
      totalItems: count,
      totalPages,
      currentPage: page,
      perPage: limit,
      items,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

// POST /api/admin/tickets/:id/approve -> send email with QR, mark as approved
router.post("/tickets/:id/approve", requireAdmin, async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id, 10);
    if (Number.isNaN(ticketId)) {
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

    const qrPayload = JSON.stringify({ token: ticket.token });
    const qrDataUrl = await QRCode.toDataURL(qrPayload);

    let responseMessage = "Ticket approved and email sent";
    let mailError = null;

    try {
      const result = await sendTicketEmail({
        toEmail: ticket.email,
        name: ticket.name,
        qrDataUrl,
        ticketType: ticket.ticketType,
        quantity: ticket.quantity,
        unitPrice: ticket.unitPrice,
        totalPrice: ticket.price,
        vipSeats: ticket.vipSeats,
      });
      ticket.emailSent = true;
      ticket.sentAt = new Date();
      console.log("Ticket email sent", {
        ticketId: ticket.id,
        email: ticket.email,
        nodemailerMessageId: result?.info?.messageId,
      });
    } catch (mailErr) {
      mailError = mailErr;
      responseMessage = "Ticket approved but email not sent";
      ticket.emailSent = false;
      ticket.sentAt = null;
      console.error("Ticket email failed", {
        ticketId: ticket.id,
        email: ticket.email,
        error: mailErr?.message || mailErr,
      });
    }

    ticket.status = "approved";
    await ticket.save();

    const payload = {
      message: responseMessage,
      ticket: sanitizeTicket(ticket),
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
    const ticketId = parseInt(req.params.id, 10);
    if (Number.isNaN(ticketId)) {
      return res.status(400).json({ error: "Invalid ticket id" });
    }
    const ticket = await Ticket.findByPk(ticketId);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    ticket.status = "cancelled";
    await ticket.save();

    return res.json({
      message: "Ticket cancelled",
      ticket: sanitizeTicket(ticket),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to cancel ticket" });
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
        });
      }
      if (ticket.remaining <= 0) {
        return res.json({
          status: "no_remaining",
          message: "Tickets already scanned — no people remaining.",
        });
      }
      return res.json({
        status: "valid",
        message:
          "Ticket booked successfully. Do not share with others. Please show this QR at the event gate.",
      });
    }

    if (ticket.status === "cancelled") {
      return res.json({
        status: "cancelled",
        message: "Ticket is cancelled. Entry not permitted.",
        ticket: sanitizeTicket(ticket),
      });
    }

    if (ticket.remaining <= 0) {
      return res.json({
        status: "no_remaining",
        message: "Tickets already scanned — no people remaining.",
        ticket: sanitizeTicket(ticket),
      });
    }

    let checkInCount = parseInt(count, 10);
    if (!Number.isInteger(checkInCount) || checkInCount <= 0) {
      if (ticket.remaining === 1) {
        checkInCount = 1;
      } else {
        return res.json({
          status: "awaiting_count",
          message: "Enter number of people to check in.",
          ticket: sanitizeTicket(ticket),
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
      ticket: sanitizeTicket(ticket),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Verification failed" });
  }
});

export default router;
