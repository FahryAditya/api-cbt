import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { signToken } from "../utils/jwt";
import { verifyPassword } from "../utils/password";
import { prisma } from "../config/prisma";

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
          { username: trimmedUsername },
          { email: trimmedUsername },
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
