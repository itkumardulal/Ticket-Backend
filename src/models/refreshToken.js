import { DataTypes, Op } from "sequelize";
import { sequelize } from "./index.js";

export const RefreshToken = sequelize.define(
  "refreshTokens",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    token: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    adminId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "admins",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    revoked: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    indexes: [
      { fields: ["token"], unique: true },
      { fields: ["adminId"] },
      { fields: ["expiresAt"] },
    ],
  }
);

export async function createRefreshToken(adminId, token, expiresAt) {
  return RefreshToken.create({
    adminId,
    token,
    expiresAt,
  });
}

export async function findRefreshToken(token) {
  return RefreshToken.findOne({
    where: {
      token,
      revoked: false,
      expiresAt: {
        [Op.gt]: new Date(),
      },
    },
  });
}

export async function revokeRefreshToken(token) {
  return RefreshToken.update({ revoked: true }, { where: { token } });
}

export async function revokeAllAdminTokens(adminId) {
  return RefreshToken.update(
    { revoked: true },
    { where: { adminId, revoked: false } }
  );
}

export async function cleanupExpiredTokens() {
  return RefreshToken.destroy({
    where: {
      expiresAt: {
        [Op.lt]: new Date(),
      },
    },
  });
}
