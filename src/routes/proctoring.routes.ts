import { Router } from "express";
import {
  getLiveProctoringController,
  resetLoginController,
  addTimeController,
  warnStudentController,
  broadcastController,
  getActiveBroadcastController,
} from "../controllers/proctoring.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";

const router = Router();

router.get("/:ujianId?", getLiveProctoringController);
router.post("/reset-login", authMiddleware, requireRole(["ADMIN", "GURU"]), resetLoginController);
router.post("/add-time", authMiddleware, requireRole(["ADMIN", "GURU"]), addTimeController);
router.post("/warn", authMiddleware, requireRole(["ADMIN", "GURU"]), warnStudentController);
router.post("/broadcast", authMiddleware, requireRole(["ADMIN", "GURU"]), broadcastController);
router.get("/broadcast/active", getActiveBroadcastController);

export default router;

