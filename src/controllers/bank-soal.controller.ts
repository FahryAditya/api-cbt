import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { prisma } from "../config/prisma";

export const getBankSoalController = async (_req: Request, res: Response) => {
  try {
    const bankSoalList = await (prisma.bankSoal.findMany as any)({
      include: {
        mapel: true,
        pembuat: { select: { nama: true } },
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

    if (!judul) {
      res.status(400).json({ success: false, message: "Judul bank soal wajib diisi" });
      return;
    }

    if (!pembuatId) {
      res.status(401).json({ success: false, message: "User pembuat tidak teridentifikasi" });
      return;
    }

    let resolvedMapelId = mapelId;
    if (!resolvedMapelId && mapelNama) {
      let mapel = await prisma.mataPelajaran.findFirst({
        where: { nama: String(mapelNama).trim() },
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
      const defaultMapel = await prisma.mataPelajaran.findFirst();
      resolvedMapelId = defaultMapel?.id;
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
      message: "Bank soal berhasil disimpan di database Neon PostgreSQL",
      data: newBankSoal,
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
