import express, { Application } from "express";
import cors from "cors";
import apiRouter from "./routes";
import { notFoundHandler, errorHandler } from "./middlewares/error.middleware";
import { globalLimiter } from "./middlewares/rate-limit.middleware";

export const createApp = (): Application => {
  const app = express();
  app.set("trust proxy", 1);

  // Middlewares
  app.use(
    cors({
      origin: (_origin, callback) => callback(null, true),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
    })
  );
  app.options("*", cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // Root welcome route
  app.get(["/", "/api", "/api/"], (_req, res) => {
    res.json({
      success: true,
      message: "CBT Sekolah API is running",
      documentation: "/api/health",
      database: "Neon PostgreSQL (Connected)",
    });
  });

  // Global Rate Limiter to protect server resources
  app.use("/api", globalLimiter);

  // API Routes
  app.use("/api", apiRouter);

  // 404 & Error Handler
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
