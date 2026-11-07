import express, { Application } from "express";
import cors from "cors";
import apiRouter from "./routes";
import { notFoundHandler, errorHandler } from "./middlewares/error.middleware";
import { globalLimiter } from "./middlewares/rate-limit.middleware";

export const createApp = (): Application => {
  const app = express();

  // Middlewares
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Global Rate Limiter to protect server resources
  app.use("/api", globalLimiter);

  // Root welcome route
  app.get("/", (_req, res) => {
    res.json({
      message: "CBT Sekolah API is running",
      documentation: "/api/health",
    });
  });

  // API Routes
  app.use("/api", apiRouter);

  // 404 & Error Handler
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
