import { Router } from "express";
import {
  loginController,
  studentEnterController,
  meController,
} from "../controllers/auth.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authLimiter } from "../middlewares/rate-limit.middleware";

const router = Router();

router.post("/login", authLimiter, loginController);
router.post("/student-enter", authLimiter, studentEnterController);
router.get("/me", authMiddleware, meController);

export default router;

