import { Router } from "express";
import {
  getNilaiController,
  exportExcelController,
  getAnalisisSoalController,
  getDetailJawabanSiswaController,
} from "../controllers/nilai.controller";

const router = Router();

router.get("/detail/:sesiId", getDetailJawabanSiswaController);
router.get("/:ujianId/export-excel", exportExcelController);
router.get("/:ujianId/analisis-soal/:soalId", getAnalisisSoalController);
router.get("/:ujianId?", getNilaiController);

export default router;
