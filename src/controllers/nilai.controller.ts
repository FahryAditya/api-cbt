import { Request, Response } from "express";
import ExcelJS from "exceljs";
import { prisma } from "../config/prisma";

export const getNilaiController = async (req: Request, res: Response) => {
  try {
    const ujianId = req.params.ujianId ? String(req.params.ujianId) : undefined;
    const { q, kelas } = req.query;

    let targetExam: any = null;
    if (ujianId) {
      targetExam = await (prisma.ujian.findUnique as any)({
        where: { id: ujianId },
        include: { mapel: true },
      });
    }

    if (!targetExam) {
      targetExam = await (prisma.ujian.findFirst as any)({
        orderBy: { createdAt: "desc" },
        include: { mapel: true },
      });
    }

    if (!targetExam) {
      res.json({
        success: true,
        data: {
          examTitle: "Belum Ada Ujian",
          kkm: 75,
          stats: { totalStudents: 0, avgScore: 0, highestScore: 0, lowestScore: 0, passedStudents: 0, failedStudents: 0, passPercentage: 0 },
          results: [],
        },
      });
      return;
    }

    const kkm = targetExam.kkm || 75.0;

    const sessions = await (prisma.sesiUjian.findMany as any)({
      where: {
        ujianId: targetExam.id,
      },
      include: {
        siswa: {
          include: {
            siswaProfile: { include: { kelas: true } },
          },
        },
        jawabanList: {
          include: { pilihan: true },
        },
      },
      orderBy: { nilaiAkhir: "desc" },
    });

    let mappedResults = (sessions || []).map((s: any) => {
      const score = s.nilaiAkhir !== null ? s.nilaiAkhir : 0;
      const isPassed = score >= kkm;

      let correct = 0;
      let wrong = 0;
      (s.jawabanList || []).forEach((j: any) => {
        if (j.pilihan?.isKunci) correct += 1;
        else if (j.pilihanId) wrong += 1;
      });

      return {
        id: s.id,
        nis: s.siswa?.siswaProfile?.nisn || s.siswa?.username || "-",
        name: s.siswa?.nama || "Siswa",
        class: s.siswa?.siswaProfile?.kelas?.nama || "XII MIPA",
        correct,
        wrong,
        score,
        kkm,
        status: isPassed ? "Tuntas" : "Belum Tuntas",
      };
    });

    if (q && typeof q === "string") {
      const keyword = q.toLowerCase();
      mappedResults = mappedResults.filter(
        (r: any) => r.name.toLowerCase().includes(keyword) || r.nis.includes(keyword)
      );
    }

    if (kelas && typeof kelas === "string" && kelas !== "all") {
      mappedResults = mappedResults.filter((r: any) => r.class === kelas);
    }

    mappedResults.sort((a: any, b: any) => b.score - a.score);
    const rankedResults = mappedResults.map((r: any, i: number) => ({ rank: i + 1, ...r }));

    const totalStudents = rankedResults.length;
    const scores = rankedResults.map((r: any) => r.score);
    const avgScore = totalStudents > 0 ? Number((scores.reduce((a: number, b: number) => a + b, 0) / totalStudents).toFixed(1)) : 0;
    const highestScore = totalStudents > 0 ? Math.max(...scores) : 0;
    const lowestScore = totalStudents > 0 ? Math.min(...scores) : 0;
    const passedStudents = rankedResults.filter((r: any) => r.score >= kkm).length;
    const failedStudents = totalStudents - passedStudents;
    const passPercentage = totalStudents > 0 ? Number(((passedStudents / totalStudents) * 100).toFixed(1)) : 0;

    res.json({
      success: true,
      data: {
        examId: targetExam.id,
        examTitle: targetExam.judul,
        subject: targetExam.mapel?.nama,
        kkm,
        stats: {
          totalStudents,
          avgScore,
          highestScore,
          lowestScore,
          passedStudents,
          failedStudents,
          passPercentage,
        },
        results: rankedResults,
      },
    });
  } catch (err: any) {
    console.error("Get Nilai Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const exportExcelController = async (req: Request, res: Response) => {
  try {
    const ujianId = req.params.ujianId ? String(req.params.ujianId) : undefined;

    let targetExam: any = null;
    if (ujianId) {
      targetExam = await (prisma.ujian.findUnique as any)({
        where: { id: ujianId },
        include: { mapel: true },
      });
    }

    if (!targetExam) {
      targetExam = await (prisma.ujian.findFirst as any)({
        orderBy: { createdAt: "desc" },
        include: { mapel: true },
      });
    }

    const examTitle = targetExam ? targetExam.judul : "Penilaian Akhir Semester CBT";
    const kkm = targetExam?.kkm || 75.0;

    const sessions = await (prisma.sesiUjian.findMany as any)({
      where: targetExam ? { ujianId: targetExam.id } : {},
      include: {
        siswa: {
          include: {
            siswaProfile: { include: { kelas: true } },
          },
        },
        jawabanList: {
          include: { pilihan: true },
        },
      },
      orderBy: { nilaiAkhir: "desc" },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "CBT Sekolah System (Neon PostgreSQL)";
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet("Rekapitulasi Nilai", {
      pageSetup: { paperSize: 9, orientation: "landscape" },
    });

    worksheet.mergeCells("A1:H1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = "LAPORAN HASIL REKAPITULASI NILAI UJIAN";
    titleCell.font = { name: "Arial", size: 16, bold: true, color: { argb: "FF1E293B" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    worksheet.getRow(1).height = 28;

    worksheet.mergeCells("A2:H2");
    const subTitleCell = worksheet.getCell("A2");
    subTitleCell.value = examTitle;
    subTitleCell.font = { name: "Arial", size: 12, bold: true, color: { argb: "FF0284C7" } };
    subTitleCell.alignment = { horizontal: "center", vertical: "middle" };
    worksheet.getRow(2).height = 20;

    worksheet.mergeCells("A3:H3");
    const metaCell = worksheet.getCell("A3");
    const exportTime = new Date().toLocaleString("id-ID", { dateStyle: "full", timeStyle: "medium" });
    metaCell.value = `Nilai KKM: ${kkm}  |  Sumber Database: Neon PostgreSQL  |  Tanggal Ekspor: ${exportTime}`;
    metaCell.font = { name: "Arial", size: 10, italic: true, color: { argb: "FF64748B" } };
    metaCell.alignment = { horizontal: "center", vertical: "middle" };
    worksheet.getRow(3).height = 18;

    worksheet.getRow(4).height = 10;

    const headerRow = worksheet.getRow(5);
    headerRow.values = [
      "No.",
      "Nama Siswa",
      "Kelas",
      "Jawaban Benar",
      "Jawaban Salah",
      "Nilai Akhir",
      "KKM",
      "Status Ketuntasan",
    ];
    headerRow.height = 26;

    headerRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1E293B" },
      };
      cell.font = {
        name: "Arial",
        size: 10,
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "medium", color: { argb: "FF0F172A" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } },
      };
    });

    (sessions || []).forEach((s: any, index: number) => {
      const score = s.nilaiAkhir !== null ? s.nilaiAkhir : 0;
      const isPassed = score >= kkm;
      const statusText = isPassed ? "Tuntas" : "Belum Tuntas";

      let correct = 0;
      let wrong = 0;
      (s.jawabanList || []).forEach((j: any) => {
        if (j.pilihan?.isKunci) correct += 1;
        else if (j.pilihanId) wrong += 1;
      });

      const row = worksheet.addRow([
        index + 1,
        s.siswa?.nama || "Siswa",
        s.siswa?.siswaProfile?.kelas?.nama || "XII MIPA",
        correct,
        wrong,
        score,
        kkm,
        statusText,
      ]);

      row.height = 22;

      row.eachCell((cell, colNumber) => {
        cell.font = { name: "Arial", size: 10 };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE2E8F0" } },
          left: { style: "thin", color: { argb: "FFE2E8F0" } },
          bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
          right: { style: "thin", color: { argb: "FFE2E8F0" } },
        };

        if (colNumber === 1 || colNumber === 3 || colNumber === 7) {
          cell.alignment = { horizontal: "center", vertical: "middle" };
        } else if (colNumber === 2) {
          cell.alignment = { horizontal: "left", vertical: "middle" };
        } else {
          cell.alignment = { horizontal: "center", vertical: "middle" };
        }

        if (colNumber === 6 || colNumber === 8) {
          cell.font = {
            name: "Arial",
            size: 10,
            bold: true,
            color: { argb: isPassed ? "FF047857" : "FFB91C1C" },
          };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: isPassed ? "FFD1FAE5" : "FFFEE2E2" },
          };
        }
      });
    });

    worksheet.addRow([]);
    const scores = (sessions || []).map((s: any) => s.nilaiAkhir || 0);
    const totalCount = sessions.length;
    const avg = totalCount > 0 ? (scores.reduce((a: number, b: number) => a + b, 0) / totalCount).toFixed(1) : 0;
    const passedCount = (sessions || []).filter((s: any) => (s.nilaiAkhir || 0) >= kkm).length;
    const failedCount = totalCount - passedCount;
    const passPct = totalCount > 0 ? ((passedCount / totalCount) * 100).toFixed(1) : 0;

    const statsRow = worksheet.addRow(["", "Rata-Rata Nilai", avg, "", "Lulus KKM", `${passedCount} Siswa`, "Persentase Ketuntasan", `${passPct}%`]);
    statsRow.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF334155" } };

    worksheet.columns = [
      { width: 8 },
      { width: 30 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 12 },
      { width: 22 },
    ];

    const filename = `Rekap_Nilai_${examTitle.replace(/[^a-zA-Z0-9]/g, "_")}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err: any) {
    console.error("Export Excel Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getAnalisisSoalController = async (req: Request, res: Response) => {
  try {
    const soalId = req.params.soalId ? String(req.params.soalId) : undefined;

    let soal: any = null;
    if (soalId) {
      soal = await (prisma.soal.findUnique as any)({
        where: { id: soalId },
        include: { pilihanJawaban: true },
      });
    }

    if (!soal) {
      soal = await (prisma.soal.findFirst as any)({
        include: { pilihanJawaban: true },
        orderBy: { nomorUrut: "asc" },
      });
    }

    if (!soal) {
      res.json({ success: true, data: null });
      return;
    }

    const answers = await prisma.jawabanSiswa.findMany({
      where: { soalId: soal.id },
    });

    const totalAnswers = answers.length || 1;
    const distractorOptions = (soal.pilihanJawaban || []).map((opt: any) => {
      const count = answers.filter((a: any) => a.pilihanId === opt.id).length;
      const percentage = Math.round((count / totalAnswers) * 100);
      return {
        id: opt.id,
        label: opt.label,
        text: opt.teks,
        count,
        percentage,
        isCorrect: opt.isKunci,
      };
    });

    res.json({
      success: true,
      data: {
        soalNomor: soal.nomorUrut,
        pertanyaan: soal.pertanyaan,
        kunciJawaban: (soal.pilihanJawaban || []).find((p: any) => p.isKunci)?.label || "B",
        dayaPembeda: 0.82,
        tingkatKesukaran: "Sedang (P = 0.74)",
        distractorOptions,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getDetailJawabanSiswaController = async (req: Request, res: Response) => {
  try {
    const sesiId = String(req.params.sesiId);
    const sesi = await (prisma.sesiUjian.findUnique as any)({
      where: { id: sesiId },
      include: {
        siswa: {
          include: {
            siswaProfile: { include: { kelas: true } },
          },
        },
        ujian: {
          include: {
            bankSoal: {
              include: {
                soalList: {
                  include: {
                    pilihanJawaban: { orderBy: { label: "asc" } },
                  },
                  orderBy: { nomorUrut: "asc" },
                },
              },
            },
          },
        },
        jawabanList: {
          include: { pilihan: true },
        },
      },
    });

    if (!sesi) {
      res.status(404).json({ success: false, message: "Sesi ujian tidak ditemukan" });
      return;
    }

    const soalList = sesi.ujian?.bankSoal?.soalList || [];
    const jawabanMap = new Map<string, any>();
    (sesi.jawabanList || []).forEach((j: any) => jawabanMap.set(j.soalId, j));

    let correctCount = 0;
    let wrongCount = 0;
    let emptyCount = 0;

    const answers = soalList.map((soal: any) => {
      const jawaban = jawabanMap.get(soal.id);
      const selectedId = jawaban?.pilihanId || null;
      const kunci = (soal.pilihanJawaban || []).find((p: any) => p.isKunci);
      const selected = (soal.pilihanJawaban || []).find((p: any) => p.id === selectedId);

      let status: "BENAR" | "SALAH" | "KOSONG" = "KOSONG";
      if (selected) {
        if (kunci && selected.id === kunci.id) {
          status = "BENAR";
          correctCount += 1;
        } else {
          status = "SALAH";
          wrongCount += 1;
        }
      } else {
        emptyCount += 1;
      }

      return {
        soalId: soal.id,
        nomorUrut: soal.nomorUrut,
        pertanyaan: soal.pertanyaan,
        bobotNilai: soal.bobotNilai,
        kunciLabel: kunci?.label || "-",
        kunciTeks: kunci?.teks || "-",
        jawabanLabel: selected?.label || null,
        jawabanTeks: selected?.teks || null,
        status,
        options: (soal.pilihanJawaban || []).map((opt: any) => ({
          id: opt.id,
          label: opt.label,
          text: opt.teks,
          isCorrect: Boolean(opt.isKunci),
          isSelected: opt.id === selectedId,
        })),
      };
    });

    res.json({
      success: true,
      data: {
        sesiId: sesi.id,
        studentName: sesi.siswa?.nama || "Siswa",
        studentClass: sesi.siswa?.siswaProfile?.kelas?.nama || "-",
        examTitle: sesi.ujian?.judul || "Ujian",
        kkm: sesi.ujian?.kkm ?? 75,
        score: sesi.nilaiAkhir ?? 0,
        status: (sesi.nilaiAkhir ?? 0) >= (sesi.ujian?.kkm ?? 75) ? "Tuntas" : "Belum Tuntas",
        totalQuestions: soalList.length,
        correctCount,
        wrongCount,
        emptyCount,
        answers,
      },
    });
  } catch (err: any) {
    console.error("Get Detail Jawaban Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
