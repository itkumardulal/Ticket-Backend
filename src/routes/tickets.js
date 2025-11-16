import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import { Ticket, findTicketByToken } from "../models/ticket.js";

const router = Router();

// Dynamic pricing based on date ranges
function calculatePrice() {
  const now = new Date();
  const ticketPrices = [
    { start: new Date("2025-11-11"), end: new Date("2025-11-17"), price: 500 },
    { start: new Date("2025-11-17"), end: new Date("2025-11-23"), price: 750 },
    { start: new Date("2025-11-24"), end: new Date("2025-12-28"), price: 1000 },
  ];

  for (const range of ticketPrices) {
    if (now >= range.start && now <= range.end) {
      return range.price;
    }
  }
  // Default price if outside all ranges
  return 1000;
}

function normalizeTicketInput(body = {}) {
  const { name, email, phone, ticketType = "normal" } = body;
  const normalizedType =
    typeof ticketType === "string" && ticketType.toLowerCase() === "vip"
      ? "vip"
      : "normal";

  if (!name || !email || !phone) {
    return { error: "Name, email and phone are required" };
  }

  const token = uuidv4();

  if (normalizedType === "vip") {
    const unitPrice = 10000;
    const vipQuantity = 5; // VIP tickets always have quantity = 5
    return {
      token,
      name,
      email,
      phone,
      ticketType: "vip",
      quantity: vipQuantity, // Force quantity = 5
      unitPrice,
      price: unitPrice, // Recalculate total price based on enforced quantity
      remaining: vipQuantity,
      vipSeats: vipQuantity,
    };
  }

  let quantity = parseInt(body.quantity, 10);
  if (!Number.isInteger(quantity) || quantity < 1) {
    quantity = 1;
  }
  const unitPrice = calculatePrice();
  const totalPrice = unitPrice * quantity;

  return {
    token,
    name,
    email,
    phone,
    ticketType: "normal",
    quantity,
    unitPrice,
    price: totalPrice,
    remaining: quantity,
    vipSeats: 0,
  };
}

// POST /api/tickets -> create ticket (no email, no QR/token return)
router.post("/", async (req, res) => {
  try {
    const normalized = normalizeTicketInput(req.body);
    if (normalized.error) {
      return res.status(400).json({ error: normalized.error });
    }

    const ticket = await Ticket.create({
      ...normalized,
      scanCount: 0,
      status: "pending",
      emailSent: false,
      sentAt: null,
    });

    return res.status(201).json({
      success: true,
      message: "Ticket booked and sent for review",
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to create ticket" });
  }
});

// GET /api/tickets/:token -> public ticket details (limited for privacy)
router.get("/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const ticket = await findTicketByToken(token);
    if (!ticket) return res.status(404).json({ error: "Invalid Ticket" });
    // For non-admin public view, only show minimal info
    return res.json({
      id: ticket.id,
      name: ticket.name,
      email: maskEmail(ticket.email),
      phone: maskPhone(ticket.phone),
      status: ticket.status,
      remaining: ticket.remaining,
      scanCount: ticket.scanCount,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to get ticket" });
  }
});

router.get("/:token/qr.png", async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ error: "Token required" });
    }
    const ticket = await findTicketByToken(token);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    const payload = JSON.stringify({ token: ticket.token });
    const buffer = await QRCode.toBuffer(payload, { type: "png", margin: 1 });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.send(buffer);
  } catch (err) {
    console.error("Failed to generate QR image", err);
    return res.status(500).json({ error: "Failed to generate QR" });
  }
});

function maskPhone(p) {
  if (!p) return "";
  const digits = p.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return digits.slice(0, -4).replace(/\d/g, "*") + digits.slice(-4);
}

function maskEmail(e) {
  if (!e || !e.includes("@")) return "***";
  const [user, domain] = e.split("@");
  const maskedUser =
    user.length <= 2
      ? user[0] + "*"
      : user[0] + "*".repeat(user.length - 2) + user[user.length - 1];
  return `${maskedUser}@${domain}`;
}

export default router;
