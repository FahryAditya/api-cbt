import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { prisma } from "../config/prisma";
import {
  ensureFreshExamToken,
  generateExamToken,
  TOKEN_ROTATION_MS,
} from "../utils/token";
import { calculateExamScore } from "../utils/grading";
import { cacheSet } from "../config/redis";

export const getExamsController = async (_req: Request, res: Response) => {
  try {
    const exams = await (prisma.ujian.findMany as any)({
      include: {
        mapel: true,
        bankSoal: {
          include: {
            _count: { select: { soalList: true } },
          },
        },
        targetKelas: {
          include: { kelas: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const formatted = await Promise.all(
      exams.map(async (ex: any) => {
        const synced = await ensureFreshExamToken(ex);
        return {
          id: ex.id,
          title: ex.judul,
          subject: ex.mapel?.nama || "Umum",
          targetClasses: (ex.targetKelas || []).map((tk: any) => tk.kelas?.nama),
          token: synced.token || "BELUM_DIATUR",
          tokenUpdatedAt: synced.tokenUpdatedAt.toISOString(),
          tokenExpiresAt: synced.tokenExpiresAt,
          tokenSecondsRemaining: synced.tokenSecondsRemaining,
          autoRotateToken: ex.autoRotateToken,
          durationMinutes: ex.durasiMenit,
          totalQuestions: ex.bankSoal?._count?.soalList || 0,
          bankSoalId: ex.bankSoalId,
          bankSoalJudul: ex.bankSoal?.judul || "-",
          kkm: ex.kkm,
          batasPelanggaran: ex.batasPelanggaran ?? 3,
          tampilkanNilai: ex.tampilkanNilai,
          status: ex.status,
          createdAt: ex.createdAt.toISOString(),
        };
      })
    );

    res.json({ success: true, data: formatted });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createExamController = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      title,
      subject,
      targetClasses,
      durationMinutes,
      token,
      kkm,
      bankSoalId,
      batasPelanggaran,
      autoRotateToken,
    } = req.body;

    if (!title || !Array.isArray(targetClasses) || targetClasses.length === 0) {
      res.status(400).json({
        success: false,
        message: "Nama Ujian dan minimal satu Target Kelas wajib diisi",
      });
      return;
    }

    let mapel = await prisma.mataPelajaran.findFirst({
      where: { nama: subject ? String(subject).trim() : "Umum" },
    });
    if (!mapel) {
      mapel = await prisma.mataPelajaran.create({
        data: {
          kode: "MP-" + Math.floor(100 + Math.random() * 900),
          nama: subject ? String(subject).trim() : "Umum",
        },
      });
    }

    let resolvedBankSoalId = bankSoalId;
    if (!resolvedBankSoalId) {
      const existingBankSoal = await prisma.bankSoal.findFirst({
        where: { mapelId: mapel.id },
      });
      if (existingBankSoal) {
        resolvedBankSoalId = existingBankSoal.id;
      } else {
        const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
        const newBankSoal = await prisma.bankSoal.create({
          data: {
            kode: "BS-" + Math.floor(1000 + Math.random() * 9000),
            judul: `Bank Soal ${title}`,
            mapelId: mapel.id,
            pembuatId: adminUser?.id || req.user!.userId,
          },
        });
        resolvedBankSoalId = newBankSoal.id;
      }
    }

    const kelasIds: string[] = [];
    for (const className of targetClasses) {
      const trimmed = String(className).trim();
      if (!trimmed) continue;

      let kelas = await prisma.kelas.findUnique({
        where: { nama: trimmed },
      });
      if (!kelas) {
        kelas = await prisma.kelas.create({
          data: {
            nama: trimmed,
            tingkat: 12,
          },
        });
      }
      kelasIds.push(kelas.id);
    }

    const now = new Date();
    const endTime = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const newExam = await (prisma.ujian.create as any)({
      data: {
        judul: String(title).trim(),
        mapelId: mapel.id,
        bankSoalId: resolvedBankSoalId,
        token: token ? String(token).toUpperCase().trim() : generateExamToken(),
        tokenUpdatedAt: now,
        autoRotateToken:
          autoRotateToken !== undefined ? Boolean(autoRotateToken) : true,
        durasiMenit: Number(durationMinutes) || 90,
        kkm: Number(kkm) || 75.0,
        batasPelanggaran:
          batasPelanggaran !== undefined && Number(batasPelanggaran) >= 0
            ? Math.floor(Number(batasPelanggaran))
            : 3,
        waktuMulai: now,
        waktuSelesai: endTime,
        status: "AKTIF",
        targetKelas: {
          create: kelasIds.map((kelasId) => ({ kelasId })),
        },
      },
      include: {
        mapel: true,
        targetKelas: { include: { kelas: true } },
      },
    });

    res.status(201).json({
      success: true,
      message: "Paket ujian berhasil diterbitkan di Neon PostgreSQL",
      data: {
        id: newExam.id,
        title: newExam.judul,
        subject: newExam.mapel?.nama,
        targetClasses: (newExam.targetKelas || []).map((tk: any) => tk.kelas?.nama),
        token: newExam.token,
        tokenUpdatedAt: newExam.tokenUpdatedAt.toISOString(),
        tokenExpiresAt: new Date(newExam.tokenUpdatedAt.getTime() + TOKEN_ROTATION_MS).toISOString(),
        tokenSecondsRemaining: Math.floor(TOKEN_ROTATION_MS / 1000),
        autoRotateToken: newExam.autoRotateToken,
        kkm: newExam.kkm,
        durationMinutes: newExam.durasiMenit,
        status: newExam.status,
      },
    });
  } catch (err: any) {
    console.error("Create Exam Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const regenerateTokenController = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const newToken = generateExamToken();
    const now = new Date();

    const updated = await prisma.ujian.update({
      where: { id },
      data: {
        token: newToken,
        tokenUpdatedAt: now,
      },
    });

    res.json({
      success: true,
      message: "Token ujian baru berhasil diaktifkan di database",
      data: {
        token: updated.token,
        tokenUpdatedAt: updated.tokenUpdatedAt.toISOString(),
        tokenExpiresAt: new Date(now.getTime() + TOKEN_ROTATION_MS).toISOString(),
        tokenSecondsRemaining: Math.floor(TOKEN_ROTATION_MS / 1000),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateKkmController = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const { kkm, tampilkanNilai, batasPelanggaran } = req.body;
    const dataToUpdate: {
      kkm?: number;
      tampilkanNilai?: boolean;
      batasPelanggaran?: number;
    } = {};

    if (kkm !== undefined) {
      const numKkm = Number(kkm);
      if (isNaN(numKkm) || numKkm < 0 || numKkm > 100) {
        res.status(400).json({ success: false, message: "Nilai KKM harus berupa angka 0-100" });
        return;
      }
      dataToUpdate.kkm = numKkm;
    }

    if (tampilkanNilai !== undefined) {
      dataToUpdate.tampilkanNilai = Boolean(tampilkanNilai);
    }

    if (batasPelanggaran !== undefined) {
      const numBatas = Math.floor(Number(batasPelanggaran));
      if (isNaN(numBatas) || numBatas < 0 || numBatas > 50) {
        res.status(400).json({
          success: false,
          message: "Batas keluar/pelanggaran harus berupa angka 0-50 (0 = nonaktif)",
        });
        return;
      }
      dataToUpdate.batasPelanggaran = numBatas;
    }

    if (Object.keys(dataToUpdate).length === 0) {
      res.status(400).json({ success: false, message: "Tidak ada pengaturan yang diubah" });
      return;
    }

    const updated = await (prisma.ujian.update as any)({
      where: { id },
      data: dataToUpdate,
    });

    res.json({
      success: true,
      message: `Pengaturan ujian berhasil diperbarui (KKM: ${updated.kkm}, Batas Blokir: ${
        updated.batasPelanggaran === 0 ? "Nonaktif" : `${updated.batasPelanggaran}x`
      })`,
      data: {
        id: updated.id,
        kkm: updated.kkm,
        tampilkanNilai: updated.tampilkanNilai,
        batasPelanggaran: updated.batasPelanggaran ?? 3,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getClassesController = async (_req: Request, res: Response) => {
  try {
    const classes = await prisma.kelas.findMany({
      orderBy: { nama: "asc" },
    });
    res.json({ success: true, data: classes.map((c: any) => c.nama) });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addClassController = async (req: Request, res: Response) => {
  try {
    const { name, tingkat, jurusan } = req.body;
    const trimmed = (name || "").trim();

    if (!trimmed) {
      res.status(400).json({ success: false, message: "Nama kelas tidak boleh kosong" });
      return;
    }

    const created = await prisma.kelas.upsert({
      where: { nama: trimmed },
      update: {},
      create: {
        nama: trimmed,
        tingkat: Number(tingkat) || 12,
        jurusan: jurusan || null,
      },
    });

    res.status(201).json({
      success: true,
      message: "Kelas berhasil disimpan di database Neon PostgreSQL",
      data: created,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getCleanupSummaryController = async (req: Request, res: Response) => {
  try {
    const ujianId = req.query.ujianId ? String(req.query.ujianId) : undefined;
    const bankSoalId = req.query.bankSoalId ? String(req.query.bankSoalId) : undefined;

    const [sesiCount, jawabanCount, siswaCount, kelasCount, emptyKelasCount, soalCount] =
      await Promise.all([
        prisma.sesiUjian.count({ where: ujianId ? { ujianId } : undefined }),
        prisma.jawabanSiswa.count({
          where: ujianId ? { sesiUjian: { ujianId } } : undefined,
        }),
        prisma.user.count({ where: { role: "SISWA" } }),
        prisma.kelas.count(),
        prisma.kelas.count({ where: { siswa: { none: {} } } }),
        prisma.soal.count({ where: bankSoalId ? { bankSoalId } : undefined }),
      ]);

    res.json({
      success: true,
      data: {
        sesiCount,
        jawabanCount,
        siswaCount,
        kelasCount,
        emptyKelasCount,
        soalCount,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const cleanupDataController = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { targets, ujianId, bankSoalId } = req.body;

    if (!Array.isArray(targets) || targets.length === 0) {
      res.status(400).json({
        success: false,
        message: "Pilih minimal 1 kategori data yang akan dibersihkan.",
      });
      return;
    }

    const targetSet = new Set(targets.map((t: any) => String(t)));
    const summary: Record<string, number> = {
      sessions: 0,
      students: 0,
      classes: 0,
      questions: 0,
    };

    // 1. Bersihkan Riwayat Sesi, Jawaban & Nilai Siswa
    if (targetSet.has("sessions")) {
      const delSesi = await prisma.sesiUjian.deleteMany({
        where: ujianId ? { ujianId: String(ujianId) } : undefined,
      });
      summary.sessions = delSesi.count;
    }

    // 2. Bersihkan Seluruh Akun Siswa (User role SISWA; Admin & Guru aman)
    if (targetSet.has("students")) {
      const delStudents = await prisma.user.deleteMany({
        where: { role: "SISWA" },
      });
      summary.students = delStudents.count;
    }

    // 3. Bersihkan Kelas Kosong (atau semua kelas tanpa siswa setelah pembersihan siswa)
    if (targetSet.has("classes")) {
      const emptyClasses = await prisma.kelas.findMany({
        where: { siswa: { none: {} } },
        select: { id: true },
      });
      if (emptyClasses.length > 0) {
        const ids = emptyClasses.map((c) => c.id);
        await prisma.ujianKelas.deleteMany({ where: { kelasId: { in: ids } } });
        const delClasses = await prisma.kelas.deleteMany({ where: { id: { in: ids } } });
        summary.classes = delClasses.count;
      }
    }

    // 4. Bersihkan Butir Soal pada Bank Soal
    if (targetSet.has("questions")) {
      const delSoal = await prisma.soal.deleteMany({
        where: bankSoalId ? { bankSoalId: String(bankSoalId) } : undefined,
      });
      summary.questions = delSoal.count;
    }

    const parts: string[] = [];
    if (targetSet.has("sessions")) parts.push(`${summary.sessions} sesi ujian`);
    if (targetSet.has("students")) parts.push(`${summary.students} akun siswa`);
    if (targetSet.has("classes")) parts.push(`${summary.classes} kelas kosong`);
    if (targetSet.has("questions")) parts.push(`${summary.questions} butir soal`);

    res.json({
      success: true,
      message: `Pembersihan data selesai: ${parts.join(", ")} dihapus permanen.`,
      data: summary,
    });
  } catch (err: any) {
    console.error("Cleanup Data Error:", err);
    res.status(500).json({
      success: false,
      message: err?.message || "Gagal membersihkan data.",
    });
  }
};

export const activateExamBankController = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const ujianId = String(req.params.id);
    const { bankSoalId, token, autoRotateToken, status } = req.body;

    const existingExam = await prisma.ujian.findUnique({ where: { id: ujianId } });
    if (!existingExam) {
      res.status(404).json({ success: false, message: "Sesi ujian tidak ditemukan." });
      return;
    }

    const targetBankId = bankSoalId ? String(bankSoalId) : existingExam.bankSoalId;
    const bank = await prisma.bankSoal.findUnique({
      where: { id: targetBankId },
      include: { _count: { select: { soalList: true } } },
    });
    if (!bank) {
      res.status(404).json({ success: false, message: "Folder Bank Soal tidak ditemukan." });
      return;
    }
    if ((bank._count?.soalList || 0) === 0) {
      res.status(400).json({
        success: false,
        message: `Folder "${bank.judul}" belum memiliki soal (0 butir). Simpan atau import soal terlebih dahulu sebelum memulai ujian.`,
      });
      return;
    }

    const cleanToken =
      token && String(token).trim()
        ? String(token).trim().toUpperCase()
        : existingExam.token || generateExamToken();

    const now = new Date();
    const nextStatus = status === "DRAFT" || status === "SELESAI" ? status : "AKTIF";

    const updated = await (prisma.ujian.update as any)({
      where: { id: ujianId },
      data: {
        bankSoalId: targetBankId,
        token: cleanToken,
        tokenUpdatedAt: now,
        autoRotateToken:
          autoRotateToken !== undefined ? Boolean(autoRotateToken) : false,
        status: nextStatus,
      },
      include: {
        bankSoal: { include: { _count: { select: { soalList: true } } } },
      },
    });

    res.json({
      success: true,
      message: `Ujian "${updated.judul}" aktif menggunakan folder "${bank.judul}" (Token: ${updated.token})!`,
      data: {
        id: updated.id,
        title: updated.judul,
        bankSoalId: updated.bankSoalId,
        bankSoalJudul: bank.judul,
        totalQuestions: updated.bankSoal?._count?.soalList || 0,
        token: updated.token,
        tokenUpdatedAt: updated.tokenUpdatedAt.toISOString(),
        tokenExpiresAt: new Date(now.getTime() + TOKEN_ROTATION_MS).toISOString(),
        tokenSecondsRemaining: Math.floor(TOKEN_ROTATION_MS / 1000),
        autoRotateToken: updated.autoRotateToken,
        status: updated.status,
      },
    });
  } catch (err: any) {
    console.error("Activate Exam Bank Error:", err);
    res.status(500).json({
      success: false,
      message: err?.message || "Gagal mengaktifkan folder soal untuk sesi ujian.",
    });
  }
};

export const finishExamSessionController = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const ujianId = String(req.params.id);

    const exam = await prisma.ujian.findUnique({
      where: { id: ujianId },
      include: {
        bankSoal: {
          include: {
            soalList: {
              include: { pilihanJawaban: true },
            },
          },
        },
        sesiUjianList: {
          where: { status: { in: ["SEDANG_MENGERJAKAN", "TERKUNCI"] } },
          include: { jawabanList: true },
        },
      },
    });

    if (!exam) {
      res.status(404).json({ success: false, message: "Sesi ujian tidak ditemukan." });
      return;
    }

    const now = new Date();
    const allQuestions = exam.bankSoal?.soalList || [];
    const activeSessions = exam.sesiUjianList || [];

    const txOps: any[] = [];
    const cacheUpdates: Promise<void>[] = [];

    for (const sesi of activeSessions) {
      const { score } = calculateExamScore(allQuestions, sesi.jawabanList, exam.kkm);
      txOps.push(
        prisma.sesiUjian.update({
          where: { id: sesi.id },
          data: {
            status: "SELESAI",
            nilaiAkhir: score,
            waktuSelesai: now,
            sisaWaktuDetik: 0,
          },
        })
      );
      const cacheKey = `cbt:session:${ujianId}:${sesi.siswaId}`;
      cacheUpdates.push(cacheSet(cacheKey, { isSubmitted: true, score }, 3600));
    }

    txOps.push(
      prisma.ujian.update({
        where: { id: ujianId },
        data: { status: "SELESAI" },
      })
    );

    await prisma.$transaction(txOps);
    await Promise.allSettled(cacheUpdates);

    res.json({
      success: true,
      message: `Sesi ujian "${exam.judul}" berhasil diakhiri! (${activeSessions.length} peserta yang masih aktif otomatis dikumpulkan & dinilai).`,
      data: {
        id: exam.id,
        title: exam.judul,
        status: "SELESAI",
        finalizedStudentsCount: activeSessions.length,
      },
    });
  } catch (err: any) {
    console.error("Finish Exam Session Error:", err);
    res.status(500).json({
      success: false,
      message: err?.message || "Gagal mengakhiri sesi ujian.",
    });
  }
};
