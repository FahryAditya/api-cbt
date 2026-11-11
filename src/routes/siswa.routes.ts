import { Router } from "express";
import {
  getStudentsController,
  importStudentsController,
  parseExcelStudentsController,
  deleteStudentController,
} from "../controllers/siswa.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";

const router = Router();

router.get("/", authMiddleware, requireRole(["ADMIN", "GURU"]), getStudentsController);
router.post("/import", authMiddleware, requireRole(["ADMIN", "GURU"]), importStudentsController);
router.post("/parse-excel", authMiddleware, requireRole(["ADMIN", "GURU"]), parseExcelStudentsController);
router.delete("/:id", authMiddleware, requireRole(["ADMIN", "GURU"]), deleteStudentController);

export default router;
