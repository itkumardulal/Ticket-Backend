import { DataTypes } from "sequelize";
import { sequelize } from "./index.js";
import bcrypt from "bcrypt";

export const Admin = sequelize.define(
  "admins",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    username: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    passwordHash: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // Event/tenant this admin belongs to
    eventKey: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "default",
    },
  },
  {
    indexes: [
      { fields: ["username"], unique: true },
      { fields: ["eventKey"] },
    ],
  }
);

export async function ensureDefaultAdmin() {
  // Support event-specific admin credentials like:
  // EVENT_KEY=EATSTREET
  // ADMIN_USERNAME_EATSTREET=...
  // ADMIN_PASSWORD_EATSTREET=...
  const rawEventKey = process.env.EVENT_KEY || "default";
  // Keep eventKey exactly as configured so it matches tickets created
  // under the same EVENT_KEY value.
  const eventKey = rawEventKey;
  const envSuffix = rawEventKey.toUpperCase();
  const usernameFromEvent =
    process.env[`ADMIN_USERNAME_${envSuffix}`] || process.env.ADMIN_USERNAME;
  const passwordFromEvent =
    process.env[`ADMIN_PASSWORD_${envSuffix}`] || process.env.ADMIN_PASSWORD;

  const username = usernameFromEvent;
  const password = passwordFromEvent;

  if (!username || !password) {
    console.warn(
      "Admin credentials are not fully configured. Please set ADMIN_USERNAME/ADMIN_PASSWORD or ADMIN_USERNAME_<EVENT_KEY>/ADMIN_PASSWORD_<EVENT_KEY>."
    );
    return;
  }
  const existing = await Admin.findOne({ where: { username } });
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 10);
    await Admin.create({ username, passwordHash, eventKey });
    console.log(`Default admin created: ${username}`);
  } else {
    console.log("Default admin exists");
  }
}

export async function validateAdminCredentials(username, password) {
  const admin = await Admin.findOne({ where: { username } });
  if (!admin) return null;
  const ok = await bcrypt.compare(password, admin.passwordHash);
  return ok ? admin : null;
}
