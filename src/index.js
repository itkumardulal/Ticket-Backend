import "dotenv/config";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { sequelize } from "./models/index.js";
import "./models/admin.js";
import "./models/ticket.js";
import ticketsRouter from "./routes/tickets.js";
import adminRouter from "./routes/admin.js";
import { ensureDefaultAdmin } from "./models/admin.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Sindhuli Ticket API" });
});

app.use("/api/tickets", ticketsRouter);
app.use("/api/admin", adminRouter);

async function start() {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: false });
    await ensureDefaultAdmin();
    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();
