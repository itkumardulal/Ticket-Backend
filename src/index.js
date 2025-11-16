import "dotenv/config";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { sequelize } from "./models/index.js";
import "./models/admin.js";
import "./models/ticket.js";
import "./models/refreshToken.js";
import ticketsRouter from "./routes/tickets.js";
import adminRouter from "./routes/admin.js";
import { ensureDefaultAdmin } from "./models/admin.js";

const app = express();
const PORT = process.env.PORT;

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: false, // Allow inline scripts for QR generation
    crossOriginEmbedderPolicy: false,
  })
);
app.disable("x-powered-by");

// CORS configuration - strict origins
const allowedOrigins = [
  process.env.ADMIN_URL ,
  process.env.CLIENT_URL ,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true, // Allow cookies
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(bodyParser.json());
app.use(cookieParser());

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Sindhuli Ticket API" });
});

app.use("/api/tickets", ticketsRouter);
app.use("/api/admin", adminRouter);

async function start() {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ force: false });
    await ensureDefaultAdmin();

    // Cleanup expired refresh tokens every hour
    const { cleanupExpiredTokens } = await import("./models/refreshToken.js");
    setInterval(async () => {
      try {
        await cleanupExpiredTokens();
      } catch (err) {
        console.error("Token cleanup error:", err);
      }
    }, 60 * 60 * 1000); // Every hour

    app.listen(PORT, () => {
      console.log(`Server listening on ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();
