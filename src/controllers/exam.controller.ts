import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { cacheGet, cacheSet } from "../config/redis";
import { prisma } from "../config/prisma";
import { syncAllActiveExamTokens } from "../utils/token";
import { calculateExamScore } from "../utils/grading";

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
        maxViolations: (exam as any).batasPelanggaran ?? 3,
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

/**
 * Batch Autosave Jawaban Siswa (Hemat HTTP, Redis & DB Query)
 * Memproses banyak perubahan jawaban/ragu-ragu dalam 1x Redis write & 1x prisma.$transaction
 */
export const saveAnswersBatchController = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { ujianId, items } = req.body;
    const studentId = req.user?.userId;

    if (!studentId || !ujianId || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, message: "Data batch jawaban tidak lengkap" });
      return;
    }

    // 1. Deduplikasi item dalam batch berdasarkan soalId atau questionNumber (ambil yang terbaru)
    const dedupMap = new Map<string, any>();
    for (const rawItem of items) {
      if (!rawItem) continue;
      const key = rawItem.soalId
        ? `id:${rawItem.soalId}`
        : rawItem.questionNumber !== undefined
        ? `num:${Number(rawItem.questionNumber)}`
        : null;
      if (key) dedupMap.set(key, rawItem);
    }
    const cleanItems = Array.from(dedupMap.values());
    if (cleanItems.length === 0) {
      res.json({ success: true, savedCount: 0, message: "Tidak ada perubahan jawaban." });
      return;
    }

    // 2. Cek Sesi Ujian hanya 1 kali
    const sesi = await prisma.sesiUjian.findUnique({
      where: {
        ujianId_siswaId: {
          ujianId: String(ujianId),
          siswaId: studentId,
        },
      },
      include: {
        ujian: { select: { bankSoalId: true } },
      },
    });

    if (sesi && sesi.status === "TERKUNCI") {
      res.status(403).json({
        success: false,
        isLocked: true,
        message:
          "Sesi ujian Anda terkunci karena pelanggaran. Hubungi pengawas untuk membuka kembali.",
      });
      return;
    }

    // 3. Update Redis Cache hanya 1x untuk seluruh item batch
    const cacheKey = `cbt:session:${ujianId}:${studentId}`;
    const cachedSession = (await cacheGet<any>(cacheKey)) || { answers: {}, flagged: {} };
    for (const item of cleanItems) {
      if (item.questionNumber !== undefined) {
        if (item.selectedOption !== undefined) {
          cachedSession.answers[Number(item.questionNumber)] = String(
            item.selectedOption
          ).toUpperCase();
        }
        if (item.isFlagged !== undefined) {
          cachedSession.flagged[Number(item.questionNumber)] = Boolean(item.isFlagged);
        }
      }
    }
    await cacheSet(cacheKey, cachedSession, 10800);

    // 4. Persist semua jawaban valid ke Neon PostgreSQL dalam 1 transaksi
    let savedCount = 0;
    if (sesi && sesi.status !== "SELESAI") {
      // Resolusi bulk hanya bila ada item tanpa soalId
      const missingSoalNums = cleanItems
        .filter((it) => !it.soalId && it.questionNumber !== undefined)
        .map((it) => Number(it.questionNumber));

      const soalNumMap = new Map<number, string>();
      if (missingSoalNums.length > 0 && sesi.ujian?.bankSoalId) {
        const soalRows = await prisma.soal.findMany({
          where: {
            bankSoalId: sesi.ujian.bankSoalId,
            nomorUrut: { in: missingSoalNums },
          },
          select: { id: true, nomorUrut: true },
        });
        soalRows.forEach((s) => soalNumMap.set(s.nomorUrut, s.id));
      }

      // Resolusi pilihanId bila frontend belum mengirim pilihanId
      const needOptionLookup = cleanItems.filter(
        (it) => !it.pilihanId && it.selectedOption
      );
      const optionLookupMap = new Map<string, string>();
      if (needOptionLookup.length > 0) {
        const targetSoalIds = Array.from(
          new Set(
            needOptionLookup
              .map((it) => it.soalId || soalNumMap.get(Number(it.questionNumber)))
              .filter(Boolean) as string[]
          )
        );
        if (targetSoalIds.length > 0) {
          const opts = await prisma.pilihanJawaban.findMany({
            where: { soalId: { in: targetSoalIds } },
            select: { id: true, soalId: true, label: true },
          });
          opts.forEach((o) =>
            optionLookupMap.set(`${o.soalId}:${o.label.toUpperCase()}`, o.id)
          );
        }
      }

      const txOps = [];
      for (const item of cleanItems) {
        const resolvedSoalId =
          item.soalId ||
          (item.questionNumber !== undefined
            ? soalNumMap.get(Number(item.questionNumber))
            : undefined);
        if (!resolvedSoalId) continue;

        const resolvedPilihanId =
          item.pilihanId ||
          (item.selectedOption
            ? optionLookupMap.get(
                `${resolvedSoalId}:${String(item.selectedOption).toUpperCase()}`
              ) || null
            : null);

        txOps.push(
          prisma.jawabanSiswa.upsert({
            where: {
              sesiUjianId_soalId: {
                sesiUjianId: sesi.id,
                soalId: resolvedSoalId,
              },
            },
            update: {
              pilihanId: resolvedPilihanId,
              isRaguRagu: Boolean(item.isFlagged),
            },
            create: {
              sesiUjianId: sesi.id,
              soalId: resolvedSoalId,
              pilihanId: resolvedPilihanId,
              isRaguRagu: Boolean(item.isFlagged),
            },
          })
        );
      }

      if (txOps.length > 0) {
        await prisma.$transaction(txOps);
        savedCount = txOps.length;
      }
    }

    res.json({
      success: true,
      savedCount,
      message: `${savedCount} jawaban disimpan secara batch ke Redis & Neon PostgreSQL.`,
    });
  } catch (err: any) {
    console.error("Save Answers Batch Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const recordViolationController = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { ujianId, sesiId } = req.body;
    const studentId = req.user?.userId;

    let targetSesi: any = null;
    if (sesiId) {
      targetSesi = await prisma.sesiUjian.findUnique({
        where: { id: String(sesiId) },
        include: { ujian: { select: { batasPelanggaran: true } } },
      });
    } else if (studentId && ujianId) {
      targetSesi = await prisma.sesiUjian.findUnique({
        where: { ujianId_siswaId: { ujianId: String(ujianId), siswaId: String(studentId) } },
        include: { ujian: { select: { batasPelanggaran: true } } },
      });
    }

    if (!targetSesi) {
      res.status(404).json({ success: false, message: "Sesi ujian tidak ditemukan" });
      return;
    }

    const maxViolations = targetSesi.ujian?.batasPelanggaran ?? 3;
    const currentCount = Number(targetSesi.jumlahPelanggaran || 0) + 1;
    const shouldLock = maxViolations > 0 && currentCount >= maxViolations;

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
      maxViolations,
      isLocked: updated.status === "TERKUNCI",
      status: updated.status,
      message: shouldLock
        ? `Batas pelanggaran tercapai (${maxViolations}x). Halaman ujian Anda telah diblokir/dikunci oleh sistem.`
        : maxViolations > 0
        ? `Pelanggaran dicatat (${updated.jumlahPelanggaran}/${maxViolations}x). Harap tetap berada di halaman ujian.`
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

    let sesi: any = null;
    if (sesiIdParam) {
      sesi = await prisma.sesiUjian.findUnique({
        where: { id: sesiIdParam },
        include: { ujian: { select: { tampilkanNilai: true, kkm: true } } },
      });
    } else if (studentId) {
      sesi = await prisma.sesiUjian.findFirst({
        where: { siswaId: studentId },
        include: { ujian: { select: { tampilkanNilai: true, kkm: true } } },
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
        isSubmitted: sesi.status === "SELESAI",
        score: sesi.status === "SELESAI" && sesi.ujian?.tampilkanNilai ? sesi.nilaiAkhir : null,
        kkm: sesi.ujian?.kkm ?? 75,
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
    const { score, correctCount, wrongCount, unansweredCount, isPassed } =
      calculateExamScore(
        sesi.ujian.bankSoal.soalList,
        sesi.jawabanList,
        sesi.ujian.kkm
      );

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
        unansweredCount,
        status: isPassed ? "Tuntas" : "Belum Tuntas",
      },
    });
  } catch (err: any) {
    console.error("Submit Exam Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
