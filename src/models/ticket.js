import { DataTypes } from "sequelize";
import { sequelize } from "./index.js";

export const Ticket = sequelize.define(
  "tickets",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    ticketNumber: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      autoIncrement: true,
      unique: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    ticketType: {
      type: DataTypes.ENUM("normal", "vip"),
      allowNull: false,
      defaultValue: "normal",
    },
    quantity: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
    },
    unitPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    remaining: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    scanCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    status: {
      type: DataTypes.ENUM("pending", "approved", "cancelled", "checkedin"),
      allowNull: false,
      defaultValue: "pending",
    },
    emailSent: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    sentAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    token: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    vipSeats: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    qrImageUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    whatsappSent: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    lastScanAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    finalImageUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // Simple event/tenant scoping field so multiple events can share one DB
    eventKey: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: process.env.EVENT_KEY || "default",
    },
  },
  {
    indexes: [
      { fields: ["ticketNumber"], unique: true },
      { fields: ["token"], unique: true },
      { fields: ["name"] },
      { fields: ["email"] },
      { fields: ["phone"] },
      { fields: ["status"] },
      { fields: ["eventKey"] },
    ],
  }
);

export async function findTicketByToken(token, eventKey) {
  const where = { token };
  if (eventKey) {
    where.eventKey = eventKey;
  }
  return Ticket.findOne({ where });
}

// Ensure ticketNumber auto-increment starts from at least 5000
export async function ensureTicketAutoIncrement(startFrom = 5000) {
  try {
    await sequelize.query(
      `ALTER TABLE tickets AUTO_INCREMENT = ${Number(startFrom) || 5000}`
    );
  } catch (err) {
    console.error("Failed to ensure ticket AUTO_INCREMENT", err);
  }
}

export function sanitizeTicket(ticket) {
  if (!ticket) return null;
  const plain = ticket.toJSON ? ticket.toJSON() : ticket;
  const { token, createdAt, updatedAt, ...rest } = plain;
  return {
    ...rest,
    createdAt,
    updatedAt,
  };
}
