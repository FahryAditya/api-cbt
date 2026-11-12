import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { signToken } from "../utils/jwt";
import { hashPassword, verifyPassword } from "../utils/password";
import { prisma } from "../config/prisma";
import { syncAllActiveExamTokens } from "../utils/token";

function parseTingkatFromKelas(kelasStr: string): number {
  const upper = kelasStr.toUpperCase();
  if (upper.includes("XII") || upper.includes("12")) return 12;
  if (upper.includes("XI") || upper.includes("11")) return 11;
  if (upper.includes("X") || upper.includes("10")) return 10;
  return 12;
}

function normalizeSpaces(value: string): string {
  return value
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const studentEnterController = async (req: Request, res: Response): Promise<void> => {
  try {
    const { nama, kelas, jurusan, tokenUjian } = req.body;

    if (!nama || !kelas || !jurusan || !tokenUjian) {
      res.status(400).json({
        success: false,
        message: "Nama Lengkap, Kelas, Jurusan, dan Token Ujian wajib diisi.",
      });
      return;
    }

    const normalizedNama = normalizeSpaces(String(nama));
    const trimmedKelas = normalizeSpaces(String(kelas));
    const trimmedJurusan = normalizeSpaces(String(jurusan));
    const normalizedToken = normalizeSpaces(String(tokenUjian)).toUpperCase();

    if (normalizedNama.length < 2) {
      res.status(400).json({
        success: false,
        message: "Nama lengkap minimal 2 karakter.",
      });
      return;
    }

    // Sinkronkan rotasi token 10 menit sebelum validasi
    await syncAllActiveExamTokens();

    // 1. Cari ujian aktif dengan token yang cocok
    const activeExam = await prisma.ujian.findFirst({
      where: {
        token: normalizedToken,
        status: "AKTIF",
      },
    });

    if (!activeExam) {
      res.status(401).json({
        success: false,
        message: "Token ujian tidak valid atau sudah kedaluwarsa (token berubah otomatis setiap 10 menit). Minta token terbaru dari pengawas.",
      });
      return;
    }

    // 2. Cocokkan Kelas + Jurusan secara berurutan (prioritaskan gabungan Kelas + Jurusan terlebih dahulu)
    const combinedKelas = trimmedKelas.toUpperCase().includes(trimmedJurusan.toUpperCase())
      ? trimmedKelas
      : `${trimmedKelas} ${trimmedJurusan}`;

    const kelasCandidates = Array.from(new Set([combinedKelas, trimmedKelas]));

    let kelasRecord = null;
    for (const candidate of kelasCandidates) {
      kelasRecord = await prisma.kelas.findFirst({
        where: { nama: { equals: candidate, mode: "insensitive" } },
      });
      if (kelasRecord) break;
    }

    if (!kelasRecord) {
      res.status(401).json({
        success: false,
        message: `Kelas "${combinedKelas}" belum terdaftar di database. Pastikan Kelas & Jurusan sesuai data sekolah atau hubungi admin.`,
      });
      return;
    }

    // 3. Wajib cocok 100% SAMA PERSIS (exact case-sensitive) dengan nama siswa di kelas tersebut
    let exactStudent = await prisma.user.findFirst({
      where: {
        role: "SISWA",
        nama: { equals: normalizedNama },
        siswaProfile: { kelasId: kelasRecord.id },
      },
      include: {
        siswaProfile: { include: { kelas: true } },
      },
    });

    if (exactStudent && normalizeSpaces(exactStudent.nama) !== normalizedNama) {
      exactStudent = null;
    }

    // Fallback aman jika record lama di DB memiliki spasi berlebih / non-breaking space (\u00A0)
    if (!exactStudent) {
      const studentsInClass = await prisma.user.findMany({
        where: {
          role: "SISWA",
          siswaProfile: { kelasId: kelasRecord.id },
        },
        include: {
          siswaProfile: { include: { kelas: true } },
        },
      });

      exactStudent =
        studentsInClass.find((u) => normalizeSpaces(u.nama) === normalizedNama) || null;

      if (!exactStudent) {
        const sameClassCaseDiff = studentsInClass.find(
          (u) => normalizeSpaces(u.nama).toLowerCase() === normalizedNama.toLowerCase()
        );

        if (sameClassCaseDiff) {
          res.status(401).json({
            success: false,
            message:
              "Penulisan Nama Lengkap belum sama persis huruf besar/kecilnya dengan data sekolah (contoh: huruf kapital awal kata).",
          });
          return;
        }

        const otherClassExact = await prisma.user.findFirst({
          where: {
            role: "SISWA",
            nama: { equals: normalizedNama },
          },
          select: { id: true },
        });

        if (otherClassExact) {
          res.status(401).json({
            success: false,
            message:
              "Nama Lengkap terdaftar di kelas lain, tetapi Kelas/Jurusan tidak sesuai dengan data di database.",
          });
          return;
        }

        const otherClassCaseDiff = await prisma.user.findFirst({
          where: {
            role: "SISWA",
            nama: { equals: normalizedNama, mode: "insensitive" },
          },
          select: { id: true },
        });

        res.status(401).json({
          success: false,
          message: otherClassCaseDiff
            ? "Nama Lengkap belum sama persis (huruf besar/kecil) dan Kelas/Jurusan berbeda dari data di database."
            : `Nama Lengkap tidak terdaftar di kelas "${kelasRecord.nama}". Pastikan nama & kelas sesuai data dari admin/guru.`,
        });
        return;
      }
    }

    if (!exactStudent.isActive) {
      res.status(403).json({
        success: false,
        message: "Akun siswa ini dinonaktifkan. Hubungi admin atau pengawas ujian.",
      });
      return;
    }

    const studentUser = exactStudent;

    // Pastikan kelas terdaftar ikut terhubung ke ujian aktif agar muncul di Live Proctoring
    await prisma.ujianKelas.upsert({
      where: {
        ujianId_kelasId: {
          ujianId: activeExam.id,
          kelasId: kelasRecord.id,
        },
      },
      update: {},
      create: {
        ujianId: activeExam.id,
        kelasId: kelasRecord.id,
      },
    });

    // Buat/pastikan SesiUjian sudah tercatat segera setelah token tervalidasi
    await prisma.sesiUjian.upsert({
      where: {
        ujianId_siswaId: {
          ujianId: activeExam.id,
          siswaId: studentUser.id,
        },
      },
      update: {},
      create: {
        ujianId: activeExam.id,
        siswaId: studentUser.id,
        status: "BELUM_MULAI",
        sisaWaktuDetik: activeExam.durasiMenit * 60,
      },
    });

    const jwtToken = signToken({
      userId: studentUser.id,
      username: studentUser.username,
      nama: studentUser.nama,
      role: "SISWA",
      kelasId: kelasRecord.id,
    });

    res.json({
      success: true,
      message: "Token terverifikasi! Selamat mengerjakan ujian.",
      data: {
        token: jwtToken,
        ujianId: activeExam.id,
        user: {
          id: studentUser.id,
          username: studentUser.username,
          nama: studentUser.nama,
          role: studentUser.role,
          kelas: kelasRecord.nama,
          jurusan: kelasRecord.jurusan || trimmedJurusan,
          siswaProfile: {
            nisn: studentUser.siswaProfile?.nisn || "-",
            kelas: {
              nama: kelasRecord.nama,
              jurusan: kelasRecord.jurusan || trimmedJurusan,
            },
          },
        },
      },
    });
  } catch (err: any) {
    console.error("Student Enter Error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Terjadi kesalahan internal server",
    });
  }
};

export const loginController = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password, tokenUjian } = req.body;

    if (!username || !password) {
      res.status(400).json({
        success: false,
        message: "Username/NISN dan password wajib diisi",
      });
      return;
    }

    const trimmedUsername = String(username).trim();

    // Query user riil dari Neon PostgreSQL
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: trimmedUsername, mode: "insensitive" } },
          { email: { equals: trimmedUsername, mode: "insensitive" } },
          { siswaProfile: { nisn: trimmedUsername } },
        ],
      },
      include: {
        siswaProfile: {
          include: { kelas: true },
        },
        guruProfile: true,
      },
    });

    if (!user) {
      res.status(401).json({
        success: false,
        message: "Pengguna dengan Username/NISN tersebut tidak ditemukan.",
      });
      return;
    }

    // Verifikasi password dengan Argon2
    const isPasswordValid = await verifyPassword(user.password, password);
    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        message: "Password yang Anda masukkan salah.",
      });
      return;
    }

    // Jika siswa menyertakan token ujian di awal, cek validitas token
    if (user.role === "SISWA" && tokenUjian) {
      const activeExam = await prisma.ujian.findFirst({
        where: {
          token: String(tokenUjian).toUpperCase().trim(),
          status: "AKTIF",
        },
      });

      if (!activeExam) {
        res.status(400).json({
          success: false,
          message: "Token ujian tidak valid atau ujian belum aktif.",
        });
        return;
      }
    }

    const kelasId = user.siswaProfile?.kelasId || undefined;

    const token = signToken({
      userId: user.id,
      username: user.username,
      nama: user.nama,
      role: user.role,
      kelasId,
    });

    res.json({
      success: true,
      message: "Login berhasil",
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          nama: user.nama,
          role: user.role,
          kelas: user.siswaProfile?.kelas?.nama || undefined,
        },
      },
    });
  } catch (err: any) {
    console.error("Login Error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Terjadi kesalahan internal server",
    });
  }
};

export const meController = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Belum terautentikasi" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        username: true,
        nama: true,
        email: true,
        role: true,
        siswaProfile: {
          include: { kelas: true },
        },
        guruProfile: true,
      },
    });

    res.json({
      success: true,
      data: { user },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};
