import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { cacheGet, cacheSet } from "../config/redis";

export const getLiveProctoringController = async (req: Request, res: Response) => {
  try {
    const ujianIdParam = req.params.ujianId ? String(req.params.ujianId) : undefined;

    let targetUjianId = ujianIdParam;
    if (!targetUjianId) {
      const activeExam = await prisma.ujian.findFirst({
        where: { status: "AKTIF" },
        orderBy: { createdAt: "desc" },
      });
      targetUjianId = activeExam?.id;
    }

    if (!targetUjianId) {
      res.json({
        success: true,
        data: {
          kpi: { activeStudents: 0, totalStudents: 0, avgProgress: 0, totalViolations: 0, globalTimer: "00:00:00" },
          students: [],
        },
      });
      return;
    }

    const [exam, sessions, totalQuestionsCount] = await Promise.all([
      (prisma.ujian.findUnique as any)({
        where: { id: targetUjianId },
        include: {
          bankSoal: {
            include: { _count: { select: { soalList: true } } },
          },
        },
      }),
      (prisma.sesiUjian.findMany as any)({
        where: { ujianId: targetUjianId },
        include: {
          siswa: {
            include: {
              siswaProfile: { include: { kelas: true } },
            },
          },
          _count: {
            select: { jawabanList: true },
          },
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.soal.count(),
    ]);

    const totalQuestions = exam?.bankSoal?._count?.soalList || totalQuestionsCount || 40;

    const formattedStudents = (sessions || []).map((s: any) => {
      const progressCount = s._count?.jawabanList || 0;
      const timeLeftSec = s.sisaWaktuDetik || 0;
      const hrs = String(Math.floor(timeLeftSec / 3600)).padStart(2, "0");
      const mins = String(Math.floor((timeLeftSec % 3600) / 60)).padStart(2, "0");
      const secs = String(timeLeftSec % 60).padStart(2, "0");

      let connectionStatus: "online" | "idle" | "offline" = "online";
      if (s.status === "SELESAI") {
        connectionStatus = "offline";
      } else if (s.status === "BELUM_MULAI") {
        connectionStatus = "idle";
      }

      return {
        id: s.id,
        siswaId: s.siswaId,
        name: s.siswa?.nama || "Siswa",
        nis: s.siswa?.siswaProfile?.nisn || s.siswa?.username || "-",
        class: s.siswa?.siswaProfile?.kelas?.nama || "Umum",
        status: connectionStatus,
        progress: progressCount,
        totalQ: totalQuestions,
        violations: s.jumlahPelanggaran || 0,
        timeLeft: `${hrs}:${mins}:${secs}`,
      };
    });

    const activeCount = formattedStudents.filter((s: any) => s.status === "online").length;
    const totalViolations = formattedStudents.reduce((acc: number, curr: any) => acc + curr.violations, 0);
    const avgProgress = formattedStudents.length > 0
      ? Math.round((formattedStudents.reduce((acc: number, curr: any) => acc + curr.progress, 0) / (formattedStudents.length * totalQuestions)) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        kpi: {
          activeStudents: activeCount,
          totalStudents: formattedStudents.length,
          avgProgress,
          totalViolations,
          globalTimer: "01:50:21",
        },
        students: formattedStudents,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const resetLoginController = async (req: Request, res: Response) => {
  try {
    const { studentId, sesiId } = req.body;

    if (sesiId) {
      await prisma.sesiUjian.update({
        where: { id: String(sesiId) },
        data: { status: "BELUM_MULAI" },
      });
    } else if (studentId) {
      await prisma.sesiUjian.updateMany({
        where: { siswaId: String(studentId) },
        data: { status: "BELUM_MULAI" },
      });
    }

    res.json({
      success: true,
      message: "Sesi login siswa berhasil di-reset di database. Siswa dapat login kembali.",
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addTimeController = async (req: Request, res: Response) => {
  try {
    const { studentId, sesiId, minutes = 10 } = req.body;
    const additionalSeconds = Number(minutes) * 60;

    if (sesiId) {
      await prisma.sesiUjian.update({
        where: { id: String(sesiId) },
        data: { sisaWaktuDetik: { increment: additionalSeconds } },
      });
    } else if (studentId) {
      await prisma.sesiUjian.updateMany({
        where: { siswaId: String(studentId) },
        data: { sisaWaktuDetik: { increment: additionalSeconds } },
      });
    }

    res.json({
      success: true,
      message: `+${minutes} Menit berhasil ditambahkan ke sisa waktu pengerjaan di database.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const warnStudentController = async (req: Request, res: Response) => {
  try {
    const { studentId, sesiId } = req.body;

    if (sesiId) {
      await prisma.sesiUjian.update({
        where: { id: String(sesiId) },
        data: { jumlahPelanggaran: { increment: 1 } },
      });
    } else if (studentId) {
      await prisma.sesiUjian.updateMany({
        where: { siswaId: String(studentId) },
        data: { jumlahPelanggaran: { increment: 1 } },
      });
    }

    res.json({
      success: true,
      message: "Peringatan pelanggaran berhasil dikirim dan dicatat di database.",
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const broadcastController = async (req: Request, res: Response) => {
  try {
    const { message, target = "all" } = req.body;
    if (!message) {
      res.status(400).json({ success: false, message: "Pesan broadcast tidak boleh kosong" });
      return;
    }

    const payload = {
      message: String(message).trim(),
      target,
      timestamp: new Date().toISOString(),
    };

    await cacheSet("cbt:broadcast:latest", payload, 3600);

    res.json({
      success: true,
      message: "Pesan broadcast berhasil dikirim ke seluruh layar siswa melalui Redis cache.",
      data: payload,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getActiveBroadcastController = async (_req: Request, res: Response) => {
  try {
    const broadcast = await cacheGet("cbt:broadcast:latest");
    res.json({
      success: true,
      data: broadcast,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};
