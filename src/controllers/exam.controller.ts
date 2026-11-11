import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { cacheGet, cacheSet } from "../config/redis";
import { prisma } from "../config/prisma";
import { syncAllActiveExamTokens } from "../utils/token";

export const startExamController = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { ujianId, token } = req.body;
    const studentId = req.user?.userId;

    if (!studentId) {
      res.status(401).json({ success: false, message: "Siswa belum terautentikasi" });
      return;
    }

    if (!token && !ujianId) {
      res.status(400).json({ success: false, message: "Token ujian wajib dimasukkan" });
      return;
    }

    if (!ujianId) {
      await syncAllActiveExamTokens();
    }

    // 1. Verifikasi Ujian & Token di Neon PostgreSQL
    const exam = await prisma.ujian.findFirst({
      where: {
        OR: [
          ...(ujianId ? [{ id: String(ujianId) }] : []),
          ...(token ? [{ token: String(token).toUpperCase().trim() }] : []),
        ],
        status: "AKTIF",
      },
      include: {
        bankSoal: {
          include: {
            soalList: {
              include: {
                pilihanJawaban: {
                  select: { id: true, label: true, teks: true, gambarUrl: true },
                  orderBy: { label: "asc" },
                },
              },
              orderBy: { nomorUrut: "asc" },
            },
          },
        },
      },
    });

    if (!exam) {
      res.status(404).json({ success: false, message: "Ujian tidak ditemukan atau token salah / sudah kedaluwarsa." });
      return;
    }

    // 2. Ambil atau Buat Sesi Ujian di Database (tanpa menimpa status TERKUNCI / SELESAI)
    let sesi = await prisma.sesiUjian.findUnique({
      where: {
        ujianId_siswaId: {
          ujianId: exam.id,
          siswaId: studentId,
        },
      },
      include: { jawabanList: true },
    });

    if (!sesi) {
      sesi = await prisma.sesiUjian.create({
        data: {
          ujianId: exam.id,
          siswaId: studentId,
          status: "SEDANG_MENGERJAKAN",
          waktuMulai: new Date(),
          sisaWaktuDetik: exam.durasiMenit * 60,
        },
        include: { jawabanList: true },
      });
    } else if (sesi.status === "BELUM_MULAI") {
      sesi = await prisma.sesiUjian.update({
        where: { id: sesi.id },
        data: {
          status: "SEDANG_MENGERJAKAN",
          waktuMulai: sesi.waktuMulai || new Date(),
        },
        include: { jawabanList: true },
      });
    }

    // 3. Pulihkan jawaban & flag dari database
    const cacheKey = `cbt:session:${exam.id}:${studentId}`;
    const initialAnswers: Record<number, string> = {};
    const initialAnswerIds: Record<number, string> = {};
    const initialFlagged: Record<number, boolean> = {};

    const soalById = new Map<string, any>();
    exam.bankSoal.soalList.forEach((s: any) => soalById.set(s.id, s));

    sesi.jawabanList.forEach((j: any) => {
      const soal = soalById.get(j.soalId);
      if (!soal) return;
      if (j.pilihanId) {
        const opt = soal.pilihanJawaban.find((o: any) => o.id === j.pilihanId);
        if (opt) {
          initialAnswers[soal.nomorUrut] = opt.label;
          initialAnswerIds[soal.nomorUrut] = opt.id;
        }
      }
      if (j.isRaguRagu) {
        initialFlagged[soal.nomorUrut] = true;
      }
    });

    await cacheSet(cacheKey, {
      sesiId: sesi.id,
      ujianId: exam.id,
      studentId,
      answers: initialAnswers,
      flagged: initialFlagged,
      violations: sesi.jumlahPelanggaran,
      isSubmitted: sesi.status === "SELESAI",
    }, 10800);

    // Hitung sisa waktu real jika ujian sedang berlangsung
    let remainingSecs = sesi.sisaWaktuDetik ?? exam.durasiMenit * 60;
    if (sesi.waktuMulai && sesi.status === "SEDANG_MENGERJAKAN") {
      const elapsedSecs = Math.floor((Date.now() - new Date(sesi.waktuMulai).getTime()) / 1000);
      remainingSecs = Math.max(0, exam.durasiMenit * 60 - elapsedSecs);
    }

    // Format butir soal untuk dikirim ke siswa (tanpa kunci jawaban!)
    const formattedQuestions = exam.bankSoal.soalList.map((q: any) => ({
      id: q.id,
      number: q.nomorUrut,
      text: q.pertanyaan,
      points: q.bobotNilai,
      imageUrl: q.gambarUrl,
      options: q.pilihanJawaban.map((opt: any) => ({
        id: opt.id,
        label: opt.label,
        text: opt.teks,
        imageUrl: opt.gambarUrl,
      })),
    }));

    res.json({
      success: true,
      message: "Sesi ujian berhasil dimulai",
      data: {
        sesiId: sesi.id,
        ujianId: exam.id,
        examTitle: exam.judul,
        durationMinutes: exam.durasiMenit,
        sisaWaktuDetik: remainingSecs,
        totalQuestions: formattedQuestions.length,
        questions: formattedQuestions,
        savedAnswers: initialAnswers,
        savedAnswerIds: initialAnswerIds,
        savedFlagged: initialFlagged,
        violations: sesi.jumlahPelanggaran,
        isLocked: sesi.status === "TERKUNCI",
        isSubmitted: sesi.status === "SELESAI",
        score: exam.tampilkanNilai ? sesi.nilaiAkhir : null,
        tampilkanNilai: exam.tampilkanNilai,
      },
    });
  } catch (err: any) {
    console.error("Start Exam Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Autosave Jawaban Siswa
 * Menyimpan instan ke Redis Cache dan menyinkronkan ke PostgreSQL NeonDB
 */
export const saveAnswerController = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { ujianId, soalId, questionNumber, pilihanId, selectedOption, isFlagged } = req.body;
    const studentId = req.user?.userId;

    if (!studentId || !ujianId) {
      res.status(400).json({ success: false, message: "Data pengerjaan tidak lengkap" });
      return;
    }

    const cacheKey = `cbt:session:${ujianId}:${studentId}`;

    // 1. Simpan di Redis Cache (Low latency < 5ms)
    let cachedSession = await cacheGet<any>(cacheKey) || { answers: {}, flagged: {} };
    if (questionNumber !== undefined && selectedOption !== undefined) {
      cachedSession.answers[Number(questionNumber)] = String(selectedOption).toUpperCase();
    }
    if (questionNumber !== undefined && isFlagged !== undefined) {
      cachedSession.flagged[Number(questionNumber)] = Boolean(isFlagged);
    }
    await cacheSet(cacheKey, cachedSession, 10800);

    // 2. Persist ke database Neon PostgreSQL
    const sesi = await prisma.sesiUjian.findUnique({
      where: {
        ujianId_siswaId: {
          ujianId,
          siswaId: studentId,
        },
      },
    });

    if (sesi && sesi.status === "TERKUNCI") {
      res.status(403).json({
        success: false,
        isLocked: true,
        message: "Sesi ujian Anda terkunci karena pelanggaran. Hubungi pengawas untuk membuka kembali.",
      });
      return;
    }

    if (sesi && sesi.status !== "SELESAI") {
      let resolvedSoalId = soalId;

      // Jika soalId tidak dikirim langsung, cari berdasarkan nomorUrut di bank soal ujian
      if (!resolvedSoalId && questionNumber !== undefined) {
        const ujianData = await prisma.ujian.findUnique({
          where: { id: ujianId },
          select: { bankSoalId: true },
        });
        if (ujianData) {
          const soalItem = await prisma.soal.findFirst({
            where: { bankSoalId: ujianData.bankSoalId, nomorUrut: Number(questionNumber) },
            select: { id: true },
          });
          resolvedSoalId = soalItem?.id;
        }
      }

      if (resolvedSoalId) {
        // Cari pilihanId jika hanya label (A, B, C...) yang dikirim
        let resolvedPilihanId = pilihanId;
        if (!resolvedPilihanId && selectedOption) {
          const opt = await prisma.pilihanJawaban.findFirst({
            where: { soalId: resolvedSoalId, label: String(selectedOption).toUpperCase() },
            select: { id: true },
          });
          resolvedPilihanId = opt?.id;
        }

        await prisma.jawabanSiswa.upsert({
          where: {
            sesiUjianId_soalId: {
              sesiUjianId: sesi.id,
              soalId: resolvedSoalId,
            },
          },
          update: {
            pilihanId: resolvedPilihanId || null,
            isRaguRagu: Boolean(isFlagged),
          },
          create: {
            sesiUjianId: sesi.id,
            soalId: resolvedSoalId,
            pilihanId: resolvedPilihanId || null,
            isRaguRagu: Boolean(isFlagged),
          },
        });
      }
    }

    res.json({
      success: true,
      message: "Jawaban tersimpan otomatis di Redis & Neon PostgreSQL",
    });
  } catch (err: any) {
    console.error("Save Answer Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const recordViolationController = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { ujianId, sesiId } = req.body;
    const studentId = req.user?.userId;

    let targetSesi = null;
    if (sesiId) {
      targetSesi = await prisma.sesiUjian.findUnique({
        where: { id: String(sesiId) },
      });
    } else if (studentId && ujianId) {
      targetSesi = await prisma.sesiUjian.findUnique({
        where: { ujianId_siswaId: { ujianId: String(ujianId), siswaId: String(studentId) } },
      });
    }

    if (!targetSesi) {
      res.status(404).json({ success: false, message: "Sesi ujian tidak ditemukan" });
      return;
    }

    const currentCount = Number(targetSesi.jumlahPelanggaran || 0) + 1;
    const shouldLock = currentCount >= 3;

    const updated = await prisma.sesiUjian.update({
      where: { id: targetSesi.id },
      data: {
        jumlahPelanggaran: currentCount,
        ...(shouldLock ? { status: "TERKUNCI" } : {}),
      },
    });

    res.json({
      success: true,
      violations: updated.jumlahPelanggaran,
      isLocked: updated.status === "TERKUNCI",
      status: updated.status,
      message: shouldLock
        ? "Batas pelanggaran tercapai (3x). Halaman ujian Anda telah dikunci oleh sistem."
        : `Pelanggaran dicatat (${updated.jumlahPelanggaran}x). Harap tetap berada di halaman ujian.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const checkSessionStatusController = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sesiIdParam = req.params.sesiId ? String(req.params.sesiId) : undefined;
    const studentId = req.user?.userId;

    let sesi = null;
    if (sesiIdParam) {
      sesi = await prisma.sesiUjian.findUnique({ where: { id: sesiIdParam } });
    } else if (studentId) {
      sesi = await prisma.sesiUjian.findFirst({
        where: { siswaId: studentId },
        orderBy: { updatedAt: "desc" },
      });
    }

    if (!sesi) {
      res.status(404).json({ success: false, message: "Sesi ujian tidak ditemukan" });
      return;
    }

    res.json({
      success: true,
      data: {
        sesiId: sesi.id,
        ujianId: sesi.ujianId,
        status: sesi.status,
        isLocked: sesi.status === "TERKUNCI",
        violations: sesi.jumlahPelanggaran,
        timeLeft: sesi.sisaWaktuDetik,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const submitExamController = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { ujianId } = req.body;
    const studentId = req.user?.userId;

    if (!studentId || !ujianId) {
      res.status(400).json({ success: false, message: "Data submit tidak lengkap" });
      return;
    }

    // Ambil sesi ujian dan seluruh jawaban siswa
    const sesi = await prisma.sesiUjian.findUnique({
      where: {
        ujianId_siswaId: { ujianId, siswaId: studentId },
      },
      include: {
        jawabanList: {
          include: { pilihan: true },
        },
        ujian: {
          include: {
            bankSoal: {
              include: {
                soalList: {
                  include: { pilihanJawaban: true },
                },
              },
            },
          },
        },
      },
    });

    if (!sesi) {
      res.status(404).json({ success: false, message: "Sesi ujian tidak ditemukan" });
      return;
    }

    // Koreksi Otomatis berbasis kunci jawaban riil dari Neon PostgreSQL
    const allQuestions = sesi.ujian.bankSoal.soalList;
    const totalQuestions = allQuestions.length || 1;
    let correctCount = 0;
    let wrongCount = 0;

    allQuestions.forEach((soal: any) => {
      const kunciJawaban = soal.pilihanJawaban.find((p: any) => p.isKunci);
      const jawabanSiswa = sesi.jawabanList.find((j: any) => j.soalId === soal.id);

      if (jawabanSiswa && jawabanSiswa.pilihanId) {
        if (kunciJawaban && jawabanSiswa.pilihanId === kunciJawaban.id) {
          correctCount += 1;
        } else {
          wrongCount += 1;
        }
      }
    });

    const score = Number(((correctCount / totalQuestions) * 100).toFixed(1));
    const isPassed = score >= sesi.ujian.kkm;

    // Update status sesi menjadi SELESAI dan simpan nilai akhir
    await prisma.sesiUjian.update({
      where: { id: sesi.id },
      data: {
        status: "SELESAI",
        nilaiAkhir: score,
        waktuSelesai: new Date(),
        sisaWaktuDetik: 0,
      },
    });

    // Bersihkan Redis session
    const cacheKey = `cbt:session:${ujianId}:${studentId}`;
    await cacheSet(cacheKey, { isSubmitted: true, score }, 3600);

    res.json({
      success: true,
      message: "Ujian berhasil dikumpulkan dan dinilai secara otomatis di Neon PostgreSQL",
      data: {
        score: sesi.ujian.tampilkanNilai ? score : null,
        tampilkanNilai: sesi.ujian.tampilkanNilai,
        kkm: sesi.ujian.kkm,
        correctCount,
        wrongCount,
        unansweredCount: totalQuestions - (correctCount + wrongCount),
        status: isPassed ? "Tuntas" : "Belum Tuntas",
      },
    });
  } catch (err: any) {
    console.error("Submit Exam Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
