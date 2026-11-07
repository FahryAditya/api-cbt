import { Router } from "express";
import {
  getExamsController,
  createExamController,
  regenerateTokenController,
  updateKkmController,
  getClassesController,
  addClassController,
} from "../controllers/ujian.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";

const router = Router();

// Routes Ujian
router.get("/", getExamsController);
router.post("/", authMiddleware, requireRole(["ADMIN", "GURU"]), createExamController);
router.patch("/:id/token", authMiddleware, requireRole(["ADMIN", "GURU"]), regenerateTokenController);
router.patch("/:id/kkm", authMiddleware, requireRole(["ADMIN", "GURU"]), updateKkmController);

// Routes Kelas
router.get("/classes/all", getClassesController);
router.post("/classes", authMiddleware, requireRole(["ADMIN", "GURU"]), addClassController);

export default router;

