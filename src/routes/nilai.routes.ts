import { Router } from "express";
import {
  getNilaiController,
  exportExcelController,
  getAnalisisSoalController,
} from "../controllers/nilai.controller";

const router = Router();

router.get("/:ujianId?", getNilaiController);
router.get("/:ujianId/export-excel", exportExcelController);
router.get("/:ujianId/analisis-soal/:soalId", getAnalisisSoalController);

export default router;

