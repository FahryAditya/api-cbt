import { Router } from "express";
import {
  getBankSoalController,
  createBankSoalController,
  getSoalByBankIdController,
  addSoalController,
  deleteSoalController,
} from "../controllers/bank-soal.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";

const router = Router();

// Routes untuk Bank Soal
router.get("/", getBankSoalController);
router.post("/", authMiddleware, requireRole(["ADMIN", "GURU"]), createBankSoalController);
router.get("/:id/soal", getSoalByBankIdController);
router.post("/:id/soal", authMiddleware, requireRole(["ADMIN", "GURU"]), addSoalController);
router.delete("/soal/:soalId", authMiddleware, requireRole(["ADMIN", "GURU"]), deleteSoalController);

export default router;

