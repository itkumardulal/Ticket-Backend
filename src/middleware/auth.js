import jwt from "jsonwebtoken";

export function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized", code: "NO_TOKEN" });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "secret");
    // Verify it's an access token
    if (payload.type !== "access") {
      return res
        .status(401)
        .json({ error: "Invalid token type", code: "INVALID_TOKEN_TYPE" });
    }
    req.admin = payload;
    return next();
  } catch (e) {
    // Token expired or invalid
    return res.status(401).json({
      error: "Token expired or invalid",
      code: e.name === "TokenExpiredError" ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
    });
  }
}
