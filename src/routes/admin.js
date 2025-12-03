import { Router } from "express";
import jwt from "jsonwebtoken";
import { literal, Op, fn, col, where as sequelizeWhere } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import sharp from "sharp";
import { Admin, validateAdminCredentials } from "../models/admin.js";
import { Ticket, findTicketByToken, sanitizeTicket } from "../models/ticket.js";
import {
  createRefreshToken,
  findRefreshToken,
  revokeRefreshToken,
} from "../models/refreshToken.js";
import { requireAdmin } from "../middleware/auth.js";
import { loginRateLimiter } from "../middleware/rateLimit.js";
import { sendTicketEmail } from "../mailer.js";
import { uploadQRToR2 } from "../utils/r2.js";
import { buildWhatsAppMessage } from "../utils/whatsapp.js";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || "secret";
const ACCESS_TOKEN_EXPIRY = "1h"; // 1 hour
const REFRESH_TOKEN_EXPIRY_DAYS = 7; // 7 days

// POST /api/admin/login -> returns access token + sets refresh token cookie
router.post("/login", loginRateLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password)
      return res.status(400).json({ error: "Username and password required" });
    const admin = await validateAdminCredentials(username, password);
    if (!admin) return res.status(401).json({ error: "Invalid credentials" });

    const eventKey = admin.eventKey || (process.env.EVENT_KEY || "default");

    // Generate access token (15 minutes)
    const accessToken = jwt.sign(
      {
        id: admin.id,
        username: admin.username,
        type: "access",
        eventKey,
      },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    // Generate refresh token (7 days)
    const refreshTokenValue = uuidv4();
    const refreshTokenExpiresAt = new Date();
    refreshTokenExpiresAt.setDate(
      refreshTokenExpiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS
    );

    // Store refresh token in database
    await createRefreshToken(
      admin.id,
      refreshTokenValue,
      refreshTokenExpiresAt
    );

    // Set refresh token as HTTP-only, Secure cookie
    const isProduction = process.env.NODE_ENV === "production";
    res.cookie("refreshToken", refreshTokenValue, {
      httpOnly: true,
      secure: isProduction, // HTTPS only in production
      sameSite: isProduction ? "none" : "lax", // Allow cross-site in production
      maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000, // 7 days in ms
      path: "/api/admin",
    });

    return res.json({ accessToken });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Login failed" });
  }
});

// POST /api/admin/refresh -> refresh access token using refresh token cookie
router.post("/refresh", async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: "Refresh token required" });
    }

    // Find and validate refresh token
    const tokenRecord = await findRefreshToken(refreshToken);
    if (!tokenRecord) {
      return res
        .status(401)
        .json({ error: "Invalid or expired refresh token" });
    }

    // Revoke old refresh token (token rotation)
    await revokeRefreshToken(refreshToken);

    // Look up admin to get its eventKey
    const admin = await Admin.findByPk(tokenRecord.adminId);
    if (!admin) {
      return res.status(401).json({ error: "Admin not found for token" });
    }
    const eventKey = admin.eventKey || (process.env.EVENT_KEY || "default");

    // Generate new access token
    const accessToken = jwt.sign(
      { id: admin.id, type: "access", eventKey },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    // Generate new refresh token
    const newRefreshTokenValue = uuidv4();
    const refreshTokenExpiresAt = new Date();
    refreshTokenExpiresAt.setDate(
      refreshTokenExpiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS
    );

    // Store new refresh token
    await createRefreshToken(
      tokenRecord.adminId,
      newRefreshTokenValue,
      refreshTokenExpiresAt
    );

    // Set new refresh token cookie
    const isProduction = process.env.NODE_ENV === "production";
    res.cookie("refreshToken", newRefreshTokenValue, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      path: "/api/admin",
    });

    return res.json({ accessToken });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Token refresh failed" });
  }
});

// POST /api/admin/logout -> revoke refresh token
router.post("/logout", requireAdmin, async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }
    res.clearCookie("refreshToken", { path: "/api/admin" });
    return res.json({ message: "Logged out successfully" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Logout failed" });
  }
});

const STATUS_ORDER = literal(
  "FIELD(status, 'pending','approved','cancelled','checkedin')"
);

function sanitizeLikeTerm(term = "") {
  return term.replace(/[\\%_]/g, "\\$&");
}

function buildSearchConditions(searchTerm) {
  const normalized = searchTerm.toLowerCase();
  const likePattern = `%${sanitizeLikeTerm(normalized)}%`;
  const likeComparison = { [Op.like]: likePattern };
  return [
    sequelizeWhere(fn("LOWER", col("name")), likeComparison),
    sequelizeWhere(fn("LOWER", col("email")), likeComparison),
    sequelizeWhere(fn("LOWER", col("phone")), likeComparison),
  ];
}

const ALLOWED_LIMITS = new Set([10, 20, 50, 100]);
const DEFAULT_LIMIT = 10; // Fixed to 10 items per page

/**
 * Generate final ticket image with background + QR + details
 * @param {string} qrUrl - QR code image URL
 * @param {Object} ticket - Ticket object
 * @returns {Promise<Buffer>} Final ticket image buffer
 */
const EVENT_KEY = process.env.EVENT_KEY || "default";
const IS_EATSTREET = EVENT_KEY.toUpperCase() === "EATSTREET";

async function generateFinalTicketImage({ qrUrl, ticket }) {
  const CANVAS_WIDTH = 700;
  // Height tuned so full ticket area is visible
  const CANVAS_HEIGHT = 690;
  const QR_SIZE = 200;
  const QR_MARGIN = 24;
  // Cache background image in memory so approving tickets is faster
  if (!generateFinalTicketImage.bgBuffer) {
    const bgResponse = await fetch("https://i.imgur.com/8tRnbkd.png");
    generateFinalTicketImage.bgBuffer = Buffer.from(
      await bgResponse.arrayBuffer()
    );
  }
  const bgBuffer = generateFinalTicketImage.bgBuffer;

  let qrBuffer;
  if (qrUrl.startsWith("data:")) {
    const [, base64Data] = qrUrl.split(",");
    qrBuffer = Buffer.from(base64Data || "", "base64");
  } else {
    const qrResponse = await fetch(qrUrl);
    qrBuffer = Buffer.from(await qrResponse.arrayBuffer());
  }

  const bookedDate = ticket.createdAt
    ? new Date(ticket.createdAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

  const price = ticket.price || "0.00";
  const formattedPrice = typeof price === "string" ? price : price.toFixed(2);

  let ticketTypeText;
  if (ticket.ticketType === "vip") {
    ticketTypeText = "VIP";
  } else if (IS_EATSTREET) {
    ticketTypeText = "Pre Sale";
  } else {
    ticketTypeText = "Normal";
  }
  const quantityValue =
    typeof ticket.quantity === "number"
      ? ticket.quantity
      : Number(ticket.quantity) || 1;

 const qrLeft = (CANVAS_WIDTH - QR_SIZE - QR_MARGIN - 40) * 0.5-20;
  const qrTop = CANVAS_HEIGHT - QR_SIZE - QR_MARGIN-50;

  const svgText = `
    <svg width='${CANVAS_WIDTH}' height='${CANVAS_HEIGHT}' xmlns='http://www.w3.org/2000/svg'>
      <style>
        .box-text {
          fill: #0f172a;
          font-size: 18px;
          font-weight: 700;
          font-family: "Arial", sans-serif;
        }
   
      </style>
      <rect width='100%' height='100%' fill='transparent' />
      <text x='340' y='340' class='box-text'>${
     ticket.ticketNumber}</text>
      <text x='590' y='425' class='box-text'>${ticketTypeText}</text>
      <text x='550' y='460' class='box-text'>${formattedPrice}</text>
      <text x='510' y='510' class='box-text'>${ticket.name || "--"}</text>
      <text x='510' y='567' class='box-text'>${bookedDate}</text>
      <text x='510' y='538' class='box-text'> ${quantityValue}</text>
    </svg>`;

  const bgImage = sharp(bgBuffer);
  // Use cover to avoid black boxes and fill the entire canvas
  const resizedBg = await bgImage
    .resize(CANVAS_WIDTH, CANVAS_HEIGHT, {
      fit: "cover",
      position: "centre",
    })
    .toBuffer();

  const qrResized = await sharp(qrBuffer)
    .resize(QR_SIZE, QR_SIZE, { fit: "contain" })
    .toBuffer();

  const finalImage = await sharp(resizedBg)
    .composite([
      { input: qrResized, top: qrTop, left: qrLeft },
      { input: Buffer.from(svgText), top: 0, left: 0 },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true })
    .toBuffer();

  return finalImage;
}

async function buildSanitizedTicketWithQr(ticket, req) {
  if (!ticket) return null;
  const sanitized = sanitizeTicket(ticket);
  try {
    // QR encodes website URL with embedded token so admin scanner can verify
    const qrUrl = `https://sindhulibazar.com/?token=${encodeURIComponent(
      ticket.token
    )}`;
    sanitized.qrCode = await QRCode.toDataURL(qrUrl);
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
    const searchTerm = (req.query.search || "").trim();

    const adminEventKey = req.admin?.eventKey || "default";
    const where = {
      // Scope tickets to the logged-in admin's event
      eventKey: adminEventKey,
    };

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

    // Apply search filter (name, email, phone)
    if (searchTerm) {
      where[Op.or] = buildSearchConditions(searchTerm);
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

    // Calculate summary totals from ALL matching tickets (not just current page)
    // Only for book view
    let summary = null;
    let totalValue = 0;
    if (viewType === "book") {
      const summaryRow =
        (await Ticket.findOne({
          where,
          attributes: [
            [literal("COALESCE(SUM(quantity), 0)"), "totalPeople"],
            [literal("COALESCE(SUM(remaining), 0)"), "totalRemaining"],
            [literal("COALESCE(SUM(scanCount), 0)"), "totalScanned"],
            [literal("COALESCE(SUM(price), 0)"), "totalValue"],
          ],
          raw: true,
        })) || {};
      totalValue = Number(summaryRow.totalValue || 0);
      summary = {
        totalPeople: Number(summaryRow.totalPeople || 0),
        totalRemaining: Number(summaryRow.totalRemaining || 0),
        totalScanned: Number(summaryRow.totalScanned || 0),
        totalPrice: totalValue,
        totalValue,
      };
    }

    // Build sanitized tickets with QR
    const sanitizedItems = await Promise.all(
      items.map((ticket) => buildSanitizedTicketWithQr(ticket, req))
    );

    const totalPages = Math.max(Math.ceil(count / limit), 1);

    const response = {
      items: sanitizedItems,
      data: sanitizedItems, // Keep for backward compatibility
      totalCount: count,
      totalItems: count, // Keep for backward compatibility
      totalPages,
      page,
      currentPage: page, // Keep for backward compatibility
      limit,
    };

    // Add summary + total value for book view
    if (summary) {
      response.summary = summary;
      response.totalValue = summary.totalValue ?? summary.totalPrice ?? 0;
    } else {
      response.totalValue = totalValue;
    }

    return res.json(response);
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
    const adminEventKey = req.admin?.eventKey || (process.env.EVENT_KEY || "default");
    if (ticket.eventKey && ticket.eventKey !== adminEventKey) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    if (ticket.status === "cancelled") {
      return res.status(400).json({ error: "Ticket is cancelled" });
    }
    if (ticket.status === "approved") {
      return res.status(400).json({ error: "Ticket already approved" });
    }

    // Generate QR code that opens website with embedded token
    const qrPayload = `https://sindhulibazar.com/?token=${encodeURIComponent(
      ticket.token
    )}`;
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

    // Generate final ticket image with background + QR + details
    let finalImageUrl = null;
    if (qrImageUrl) {
      try {
        const finalImageBuffer = await generateFinalTicketImage({
          qrUrl: qrImageUrl,
          ticket: {
            name: ticket.name,
            ticketNumber: ticket.ticketNumber,
            ticketType: ticket.ticketType,
            quantity: ticket.quantity,
            price: ticket.price,
            createdAt: ticket.createdAt,
          },
        });

        // Upload final image to R2
        const finalFilename = `ticket-final-${ticket.token}.png`;
        finalImageUrl = await uploadQRToR2(finalImageBuffer, finalFilename);
        ticket.finalImageUrl = finalImageUrl;
      } catch (finalErr) {
        console.error("Failed to generate final ticket image:", finalErr);
        // Continue without final image
      }
    }

    let responseMessage = "Ticket approved and email sent";
    let mailError = null;

    try {
      await sendTicketEmail({
        toEmail: ticket.email,
        name: ticket.name,
        finalImageUrl: finalImageUrl || qrImageUrl || qrDataUrl, // Use final image URL if available
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
    const adminEventKey = req.admin?.eventKey || (process.env.EVENT_KEY || "default");
    if (ticket.eventKey && ticket.eventKey !== adminEventKey) {
      return res.status(404).json({ error: "Ticket not found" });
    }

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

// GET /api/admin/settlements -> summary for approved tickets (for current admin's event)
router.get("/settlements", requireAdmin, async (req, res) => {
  try {
    const adminEventKey = req.admin?.eventKey || "default";
    const where = {
      status: "approved",
      eventKey: adminEventKey,
    };

    const summaryRow =
      (await Ticket.findOne({
        where,
        attributes: [
          [literal("COALESCE(SUM(price), 0)"), "totalPrice"],
          [literal("COUNT(*)"), "approvedCount"],
        ],
        raw: true,
      })) || {};

    const totalPrice = Number(summaryRow.totalPrice || 0);
    const approvedCount = Number(summaryRow.approvedCount || 0);
    const settleAmount = Number((totalPrice * 0.1285).toFixed(2));

    return res.json({
      totalPrice,
      approvedCount,
      settleAmount,
      rate: 12.85,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to fetch settlements summary" });
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
    const adminEventKey = req.admin?.eventKey || (process.env.EVENT_KEY || "default");
    if (ticket.eventKey && ticket.eventKey !== adminEventKey) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    if (!ticket.phone) {
      return res.status(400).json({ error: "Phone number not available" });
    }

    // Use final image URL if available, otherwise use QR image URL
    let imageUrl = ticket.finalImageUrl || ticket.qrImageUrl;

    // If no final image, ensure QR is uploaded to R2
    if (!imageUrl) {
      const qrPayload = `https://sindhulibazar.com/?token=${encodeURIComponent(
        ticket.token
      )}`;
      const qrBuffer = await QRCode.toBuffer(qrPayload, { type: "png" });
      const filename = `ticket-${ticket.token}.png`;
      try {
        imageUrl = await uploadQRToR2(qrBuffer, filename);
        ticket.qrImageUrl = imageUrl;
        await ticket.save();
      } catch (r2Err) {
        console.error("Failed to upload QR to R2:", r2Err);
        return res.status(500).json({
          error: "Failed to generate QR image for WhatsApp",
        });
      }
    }

    // Build WhatsApp message with ticket details
    const message = buildWhatsAppMessage(
      {
        ...ticket.toJSON(),
        totalPrice: ticket.price,
        finalImageUrl: ticket.finalImageUrl,
      },
      imageUrl
    );

    // Generate WhatsApp URL with encoded message
    const cleanPhone = ticket.phone.replace(/[^0-9]/g, "");
    const phoneNumber = cleanPhone.startsWith("977")
      ? cleanPhone
      : `977${cleanPhone}`;
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${phoneNumber}&text=${encodeURIComponent(
      message
    )}`;

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
    const payload = jwt.verify(tokenStr, JWT_SECRET);
    // Verify it's an access token
    if (payload.type !== "access") return null;
    return payload;
  } catch (err) {
    return null;
  }
}

// POST /api/admin/verify -> { token: 'uuid', count?: number } verify scanned QR
router.post("/verify", async (req, res) => {
  try {
    const { token, count } = req.body || {};

    const adminPayload = isAdminRequest(req);
    const isAdmin = Boolean(adminPayload);
    const adminEventKey = adminPayload?.eventKey || undefined;

    // For non-admin, return plain text even if token is missing
    if (!token) {
      if (!isAdmin) {
        return res.type("text/plain").send("https://sindhulibazar.com/");
      }
      return res.status(400).json({ error: "Token required" });
    }

    const ticket = await findTicketByToken(
      token,
      isAdmin ? adminEventKey : undefined
    );
    if (!ticket) {
      // For non-admin, return plain text even for invalid QR
      if (!isAdmin) {
        return res.type("text/plain").send("https://sindhulibazar.com/");
      }
      return res.status(404).json({
        error: "Invalid QR",
        message: "Invalid QR",
      });
    }

    if (!isAdmin) {
      // Non-admin: return plain text, no JSON, no ticket details or token
      return res.type("text/plain").send("https://sindhulibazar.com/");
    }

    if (ticket.status === "cancelled") {
      return res.json({
        status: "cancelled",
        message: "Ticket is cancelled. Entry not permitted.",
        ticket: await buildSanitizedTicketWithQr(ticket, req),
      });
    }

    if (ticket.remaining <= 0) {
      const lastScanTime = ticket.lastScanAt
        ? new Date(ticket.lastScanAt).toLocaleString()
        : null;
      return res.json({
        status: "no_remaining",
        message: lastScanTime
          ? `Ticket already scanned — no people remaining. Last scan time: ${lastScanTime}.`
          : "Ticket already scanned — no people remaining.",
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

    const originalRemaining = ticket.remaining;

    // Update lastScanAt only when scanning happens
    ticket.lastScanAt = new Date();

    ticket.remaining -= checkInCount;
    ticket.scanCount += checkInCount;
    if (ticket.remaining === 0) {
      ticket.status = "checkedin";
    }
    await ticket.save();

    // Build message based on scan scenario
    let message = "";
    if (originalRemaining === 1) {
      // Special case: if only 1 person remaining, show specific message
      message = "Ticket scanned successfully. Let 1 person enter.";
    } else if (checkInCount < originalRemaining) {
      message = `Enter only ${checkInCount} people — ticket scanned successfully.`;
    } else if (ticket.remaining === 0) {
      message = "Ticket scanned successfully. No people remaining.";
    } else {
      message = `${checkInCount} people entered. ${ticket.remaining} remaining.`;
    }

    return res.json({
      status: "checked_in",
      message,
      entered: checkInCount,
      ticket: await buildSanitizedTicketWithQr(ticket, req),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Verification failed" });
  }
});

export default router;
