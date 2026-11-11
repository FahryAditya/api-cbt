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
import { examAnswerLimiter } from "../middlewares/rate-limit.middleware";

const router = Router();

router.post("/start", authMiddleware, startExamController);
router.get("/status/:sesiId?", authMiddleware, checkSessionStatusController);
router.put("/answers/batch", authMiddleware, examAnswerLimiter, saveAnswersBatchController);
router.put("/answer", authMiddleware, examAnswerLimiter, saveAnswerController);
router.post("/violation", authMiddleware, recordViolationController);
router.post("/submit", authMiddleware, submitExamController);

export default router;

