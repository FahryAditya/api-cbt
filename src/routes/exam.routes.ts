import { Router } from "express";
import {
  startExamController,
  saveAnswerController,
  saveAnswersBatchController,
  recordViolationController,
  submitExamController,
  checkSessionStatusController,
} from "../controllers/exam.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";
import { examAnswerLimiter } from "../middlewares/rate-limit.middleware";

const router = Router();
const onlyStudent = [authMiddleware, requireRole(["SISWA"])];

router.post("/start", ...onlyStudent, startExamController);
router.get("/status/:sesiId?", ...onlyStudent, checkSessionStatusController);
router.put("/answers/batch", ...onlyStudent, examAnswerLimiter, saveAnswersBatchController);
router.put("/answer", ...onlyStudent, examAnswerLimiter, saveAnswerController);
router.post("/violation", ...onlyStudent, recordViolationController);
router.post("/submit", ...onlyStudent, submitExamController);

export default router;

