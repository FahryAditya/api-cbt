import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { prisma } from "../config/prisma";
import { extractTextFromDocxBase64, parseWordQuestions } from "../utils/word-parser";

export const getBankSoalController = async (_req: Request, res: Response) => {
  try {
    const bankSoalList = await (prisma.bankSoal.findMany as any)({
      include: {
        mapel: true,
        pembuat: { select: { nama: true } },
        ujianList: { select: { id: true, judul: true, status: true, token: true } },
        _count: { select: { soalList: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const formatted = bankSoalList.map((b: any) => ({
      id: b.id,
      kode: b.kode,
      judul: b.judul,
      deskripsi: b.deskripsi,
      mapel: b.mapel?.nama || "Umum",
      mapelId: b.mapelId,
      pembuat: b.pembuat?.nama || "Guru Pengampu",
      totalSoal: b._count?.soalList || 0,
      usedInExams: (b.ujianList || []).map((u: any) => ({
        id: u.id,
        judul: u.judul,
        status: u.status,
        token: u.token,
      })),
      createdAt: b.createdAt.toISOString(),
    }));

    res.json({
      success: true,
      data: formatted,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createBankSoalController = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { judul, deskripsi, mapelId, mapelNama } = req.body;
    const pembuatId = req.user?.userId;

    if (!judul || !String(judul).trim()) {
      res.status(400).json({ success: false, message: "Nama folder bank soal wajib diisi" });
      return;
    }

    if (!pembuatId) {
      res.status(401).json({ success: false, message: "User pembuat tidak teridentifikasi" });
      return;
    }

    let resolvedMapelId = mapelId;
    if (!resolvedMapelId && mapelNama) {
      let mapel = await prisma.mataPelajaran.findFirst({
        where: { nama: { equals: String(mapelNama).trim(), mode: "insensitive" } },
      });
      if (!mapel) {
        mapel = await prisma.mataPelajaran.create({
          data: {
            kode: "MP-" + Math.floor(100 + Math.random() * 900),
            nama: String(mapelNama).trim(),
          },
        });
      }
      resolvedMapelId = mapel.id;
    }

    if (!resolvedMapelId) {
      let defaultMapel = await prisma.mataPelajaran.findFirst();
      if (!defaultMapel) {
        defaultMapel = await prisma.mataPelajaran.create({
          data: {
            kode: "PAN-XII",
            nama: "Pendidikan Pancasila",
          },
        });
      }
      resolvedMapelId = defaultMapel.id;
    }

    const newBankSoal = await prisma.bankSoal.create({
      data: {
        kode: "BS-" + Math.floor(1000 + Math.random() * 9000),
        judul: String(judul).trim(),
        deskripsi: deskripsi ? String(deskripsi).trim() : null,
        mapelId: resolvedMapelId,
        pembuatId,
      },
      include: {
        mapel: true,
        pembuat: { select: { nama: true } },
      },
    });

    res.status(201).json({
      success: true,
      message: `Folder "${newBankSoal.judul}" berhasil dibuat!`,
      data: {
        id: newBankSoal.id,
        kode: newBankSoal.kode,
        judul: newBankSoal.judul,
        deskripsi: newBankSoal.deskripsi,
        mapel: newBankSoal.mapel?.nama || "Umum",
        mapelId: newBankSoal.mapelId,
        pembuat: newBankSoal.pembuat?.nama || "Guru Pengampu",
        totalSoal: 0,
        usedInExams: [],
        createdAt: newBankSoal.createdAt.toISOString(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateBankSoalController = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const { judul, deskripsi } = req.body;
    if (!judul || !String(judul).trim()) {
      res.status(400).json({ success: false, message: "Nama folder tidak boleh kosong" });
      return;
    }
    const updated = await prisma.bankSoal.update({
      where: { id },
      data: {
        judul: String(judul).trim(),
        ...(deskripsi !== undefined ? { deskripsi: deskripsi ? String(deskripsi).trim() : null } : {}),
      },
    });
    res.json({
      success: true,
      message: `Nama folder diperbarui menjadi "${updated.judul}".`,
      data: updated,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteBankSoalController = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const linkedExams = await prisma.ujian.count({ where: { bankSoalId: id } });
    if (linkedExams > 0) {
      res.status(400).json({
        success: false,
        message:
          "Folder ini sedang terhubung ke sesi ujian. Hubungkan sesi ke folder lain lewat tombol Start sebelum menghapus folder ini.",
      });
      return;
    }
    await prisma.bankSoal.delete({ where: { id } });
    res.json({
      success: true,
      message: "Folder bank soal berhasil dihapus dari database.",
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getSoalByBankIdController = async (req: Request, res: Response) => {
  try {
    const bankSoalId = String(req.params.id);
    const questions = await (prisma.soal.findMany as any)({
      where: { bankSoalId },
      include: {
        pilihanJawaban: {
          orderBy: { label: "asc" },
        },
      },
      orderBy: { nomorUrut: "asc" },
    });

    const formatted = questions.map((q: any) => ({
      id: q.id,
      bankSoalId: q.bankSoalId,
      nomorUrut: q.nomorUrut,
      pertanyaan: q.pertanyaan,
      bobotNilai: q.bobotNilai,
      gambarUrl: q.gambarUrl,
      options: (q.pilihanJawaban || []).map((opt: any) => ({
        id: opt.id,
        label: opt.label,
        text: opt.teks,
        isCorrect: opt.isKunci,
        imageUrl: opt.gambarUrl,
      })),
    }));

    res.json({ success: true, data: formatted });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addSoalController = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const bankSoalId = String(req.params.id);
    const { pertanyaan, bobotNilai, options, gambarUrl } = req.body;

    if (!pertanyaan || !Array.isArray(options) || options.length < 2) {
      res.status(400).json({
        success: false,
        message: "Pertanyaan dan minimal 2 opsi pilihan jawaban (A, B, ...) wajib diisi",
      });
      return;
    }

    const hasCorrect = options.some((opt) => opt.isCorrect === true);
    if (!hasCorrect) {
      res.status(400).json({
        success: false,
        message: "Wajib menandai salah satu opsi sebagai Kunci Jawaban Benar",
      });
      return;
    }

    const currentCount = await prisma.soal.count({
      where: { bankSoalId },
    });

    const createdSoal = await prisma.soal.create({
      data: {
        bankSoalId,
        nomorUrut: currentCount + 1,
        pertanyaan: String(pertanyaan),
        bobotNilai: Number(bobotNilai) || 2.5,
        gambarUrl: gambarUrl ? String(gambarUrl) : null,
        pilihanJawaban: {
          create: options.map((opt: any) => ({
            label: String(opt.label).toUpperCase(),
            teks: String(opt.text),
            isKunci: Boolean(opt.isCorrect),
            gambarUrl: opt.imageUrl ? String(opt.imageUrl) : null,
          })),
        },
      },
      include: {
        pilihanJawaban: {
          orderBy: { label: "asc" },
        },
      },
    });

    res.status(201).json({
      success: true,
      message: "Butir soal berhasil disimpan di database Neon PostgreSQL",
      data: createdSoal,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteSoalController = async (req: Request, res: Response) => {
  try {
    const soalId = String(req.params.soalId);
    await prisma.soal.delete({
      where: { id: soalId },
    });

    res.json({ success: true, message: "Butir soal berhasil dihapus dari database" });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateSoalController = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const soalId = String(req.params.soalId);
    const { pertanyaan, bobotNilai, options, gambarUrl } = req.body;

    if (!pertanyaan || !Array.isArray(options) || options.length < 2) {
      res.status(400).json({
        success: false,
        message: "Pertanyaan dan minimal 2 opsi pilihan jawaban (A, B, ...) wajib diisi",
      });
      return;
    }

    // 1. Update butir soal
    await prisma.soal.update({
      where: { id: soalId },
      data: {
        pertanyaan: String(pertanyaan),
        bobotNilai: Number(bobotNilai) || 2.5,
        gambarUrl: gambarUrl ? String(gambarUrl) : null,
      },
    });

    // 2. Hapus pilihan lama dan buat pilihan baru yang diperbarui
    await prisma.pilihanJawaban.deleteMany({
      where: { soalId },
    });

    await prisma.pilihanJawaban.createMany({
      data: options.map((opt: any) => ({
        soalId,
        label: String(opt.label).toUpperCase(),
        teks: String(opt.text),
        isKunci: Boolean(opt.isCorrect),
        gambarUrl: opt.imageUrl ? String(opt.imageUrl) : null,
      })),
    });

    res.json({
      success: true,
      message: "Butir soal berhasil diperbarui di database Neon PostgreSQL",
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const parseWordBankSoalController = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { fileBase64, rawText, defaultPoints } = req.body;
    const points = Number(defaultPoints) > 0 ? Number(defaultPoints) : 1;

    let extractedText = "";
    if (fileBase64 && typeof fileBase64 === "string") {
      extractedText = await extractTextFromDocxBase64(fileBase64);
    } else if (rawText && typeof rawText === "string") {
      extractedText = rawText;
    } else {
      res.status(400).json({
        success: false,
        message: "Upload file .docx atau tempel teks soal dari Word terlebih dahulu.",
      });
      return;
    }

    const parsed = parseWordQuestions(extractedText, points);
    if (parsed.questions.length === 0) {
      res.status(400).json({
        success: false,
        message:
          "Tidak ada butir soal pilihan ganda yang terdeteksi. Pastikan format nomor soal (1. ...) dan pilihan (A. ... B. ...) sesuai.",
        data: parsed,
      });
      return;
    }

    res.json({
      success: true,
      message: `Berhasil membaca ${parsed.questions.length} butir soal dari dokumen Word.`,
      data: parsed,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err?.message || "Gagal memproses file Word (.docx).",
    });
  }
};

export const importSoalBulkController = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const bankSoalId = String(req.params.id);
    const { questions, replaceExisting } = req.body;

    const bank = await prisma.bankSoal.findUnique({
      where: { id: bankSoalId },
    });
    if (!bank) {
      res.status(404).json({ success: false, message: "Paket Bank Soal tidak ditemukan." });
      return;
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      res.status(400).json({
        success: false,
        message: "Daftar soal yang akan diimport tidak boleh kosong.",
      });
      return;
    }

    const validItems = questions.filter(
      (q: any) =>
        (q.pertanyaan || q.text) &&
        Array.isArray(q.options) &&
        q.options.length >= 2
    );

    if (validItems.length === 0) {
      res.status(400).json({
        success: false,
        message: "Minimal harus ada 1 soal valid dengan pertanyaan dan 2+ pilihan jawaban.",
      });
      return;
    }

    if (Boolean(replaceExisting)) {
      await prisma.soal.deleteMany({
        where: { bankSoalId },
      });
    }

    const agg = await prisma.soal.aggregate({
      where: { bankSoalId },
      _max: { nomorUrut: true },
    });
    let nextNomor = (agg._max?.nomorUrut ?? 0) + 1;

    // Insert in chunks to stay safe under Neon serverless transaction limits
    const CHUNK_SIZE = 15;
    let importedCount = 0;

    for (let i = 0; i < validItems.length; i += CHUNK_SIZE) {
      const chunk = validItems.slice(i, i + CHUNK_SIZE);
      await prisma.$transaction(
        chunk.map((item: any) => {
          const nomorUrut = nextNomor++;
          const normalizedOptions = item.options.map((opt: any) => ({
            label: String(opt.label || "A").trim().toUpperCase(),
            teks: String(opt.text ?? opt.teks ?? "").trim(),
            isKunci: Boolean(opt.isCorrect ?? opt.isKunci),
            gambarUrl: opt.imageUrl ? String(opt.imageUrl) : null,
          }));

          // Guarantee at least one key if none was flagged
          if (!normalizedOptions.some((o: any) => o.isKunci) && normalizedOptions.length > 0) {
            normalizedOptions[0].isKunci = true;
          }

          return prisma.soal.create({
            data: {
              bankSoalId,
              nomorUrut,
              pertanyaan: String(item.pertanyaan ?? item.text).trim(),
              bobotNilai: Number(item.bobotNilai ?? item.points) || 1,
              gambarUrl: item.gambarUrl ? String(item.gambarUrl) : null,
              pilihanJawaban: {
                create: normalizedOptions,
              },
            },
          });
        })
      );
      importedCount += chunk.length;
    }

    res.status(201).json({
      success: true,
      message: `${importedCount} butir soal berhasil diimport ke paket "${bank.judul}"!`,
      data: { importedCount, bankSoalId },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err?.message || "Gagal mengimport soal ke database.",
    });
  }
};
