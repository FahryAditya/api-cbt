import { Request, Response } from "express";
import ExcelJS from "exceljs";
import { prisma } from "../config/prisma";
import { hashPassword } from "../utils/password";

function parseTingkat(kelasStr: string): number {
  const upper = kelasStr.toUpperCase();
  if (upper.includes("XII") || upper.includes("12")) return 12;
  if (upper.includes("XI") || upper.includes("11")) return 11;
  if (upper.includes("X") || upper.includes("10")) return 10;
  return 12;
}

async function upsertStudentRow(
  namaRaw: string,
  kelasRaw: string,
  ujianId?: string
): Promise<{ status: "created" | "skipped"; id: string }> {
  const nama = namaRaw.trim();
  const kelasNama = kelasRaw.trim();

  // Cari atau buat Kelas
  let kelasRecord = await prisma.kelas.findFirst({
    where: { nama: { equals: kelasNama, mode: "insensitive" } },
  });

  if (!kelasRecord) {
    kelasRecord = await prisma.kelas.create({
      data: {
        nama: kelasNama,
        tingkat: parseTingkat(kelasNama),
      },
    });
  }

  // Hubungkan kelas dengan ujian aktif jika ada
  let targetUjianId = ujianId;
  if (!targetUjianId) {
    const activeExam = await prisma.ujian.findFirst({
      where: { status: "AKTIF" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    targetUjianId = activeExam?.id;
  }

  if (targetUjianId) {
    await prisma.ujianKelas.upsert({
      where: {
        ujianId_kelasId: {
          ujianId: targetUjianId,
          kelasId: kelasRecord.id,
        },
      },
      update: {},
      create: {
        ujianId: targetUjianId,
        kelasId: kelasRecord.id,
      },
    });
  }

  // Cek apakah siswa dengan nama dan kelas sama sudah ada
  const existing = await prisma.user.findFirst({
    where: {
      role: "SISWA",
      nama: { equals: nama, mode: "insensitive" },
      siswaProfile: { kelasId: kelasRecord.id },
    },
    select: { id: true },
  });

  if (existing) {
    return { status: "skipped", id: existing.id };
  }

  const slug =
    nama
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 12) || "siswa";
  const rand = Math.random().toString(36).slice(2, 7);
  const username = `${slug}_${rand}`;
  const defaultPassword = await hashPassword(`cbt_${rand}_${Date.now()}`);

  const created = await prisma.user.create({
    data: {
      username,
      nama,
      password: defaultPassword,
      role: "SISWA",
      siswaProfile: {
        create: {
          kelasId: kelasRecord.id,
        },
      },
    },
    select: { id: true },
  });

  return { status: "created", id: created.id };
}

export const getStudentsController = async (_req: Request, res: Response) => {
  try {
    const students = await prisma.user.findMany({
      where: { role: "SISWA" },
      include: {
        siswaProfile: {
          include: { kelas: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const formatted = students.map((s: any) => ({
      id: s.id,
      nama: s.nama,
      username: s.username,
      kelas: s.siswaProfile?.kelas?.nama || "-",
      createdAt: s.createdAt.toISOString(),
    }));

    res.json({ success: true, data: formatted });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const importStudentsController = async (req: Request, res: Response) => {
  try {
    const { students, ujianId } = req.body;

    if (!Array.isArray(students) || students.length === 0) {
      res.status(400).json({
        success: false,
        message: "Daftar data siswa tidak boleh kosong.",
      });
      return;
    }

    let importedCount = 0;
    let skippedCount = 0;

    for (const item of students) {
      const nama = String(item?.nama || "").trim();
      const kelas = String(item?.kelas || "").trim();
      if (!nama || !kelas) {
        skippedCount += 1;
        continue;
      }

      const result = await upsertStudentRow(nama, kelas, ujianId);
      if (result.status === "created") importedCount += 1;
      else skippedCount += 1;
    }

    res.status(201).json({
      success: true,
      message: `Import selesai: ${importedCount} siswa ditambahkan, ${skippedCount} dilewati (duplikat/kosong).`,
      data: {
        importedCount,
        skippedCount,
        totalProcessed: students.length,
      },
    });
  } catch (err: any) {
    console.error("Import Students Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const parseExcelStudentsController = async (req: Request, res: Response) => {
  try {
    const { fileBase64 } = req.body;
    if (!fileBase64 || typeof fileBase64 !== "string") {
      res.status(400).json({ success: false, message: "File Excel tidak valid." });
      return;
    }

    const base64Content = fileBase64.includes(",")
      ? fileBase64.split(",")[1]
      : fileBase64;
    const buffer = Buffer.from(base64Content, "base64");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      res.status(400).json({ success: false, message: "Worksheet Excel kosong." });
      return;
    }

    const parsed: { nama: string; kelas: string }[] = [];
    let namaColIdx = 1;
    let kelasColIdx = 2;

    worksheet.eachRow((row, rowNumber) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cells[colNumber] = String(cell.text || cell.value || "").trim();
      });

      if (rowNumber === 1) {
        // Deteksi header otomatis jika baris 1 berisi "Nama" / "Kelas"
        const lowerCells = cells.map((c) => (c || "").toLowerCase());
        const foundNama = lowerCells.findIndex((c) => c.includes("nama"));
        const foundKelas = lowerCells.findIndex((c) => c.includes("kelas"));
        if (foundNama !== -1) namaColIdx = foundNama;
        if (foundKelas !== -1) kelasColIdx = foundKelas;
        if (foundNama !== -1 || foundKelas !== -1) {
          return; // skip header row
        }
      }

      const nama = (cells[namaColIdx] || "").trim();
      const kelas = (cells[kelasColIdx] || "").trim();
      if (nama && kelas) {
        parsed.push({ nama, kelas });
      }
    });

    res.json({
      success: true,
      data: parsed,
    });
  } catch (err: any) {
    console.error("Parse Excel Error:", err);
    res.status(500).json({
      success: false,
      message: "Gagal membaca file Excel. Pastikan format .xlsx valid dengan kolom Nama dan Kelas.",
    });
  }
};

export const deleteStudentController = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    await prisma.user.delete({
      where: { id },
    });
    res.json({
      success: true,
      message: "Data siswa berhasil dihapus dari database.",
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};
