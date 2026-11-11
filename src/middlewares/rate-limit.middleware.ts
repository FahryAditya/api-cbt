import rateLimit from "express-rate-limit";
import { Request } from "express";
import { verifyToken } from "../utils/jwt";

/**
 * Gunakan userId dari JWT Bearer token jika tersedia agar siswa di 1 Wi-Fi sekolah
 * memiliki kuota rate-limit terpisah per akun, fallback ke IP jika belum login.
 */
function userOrIpKeyGenerator(req: Request): string {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      if (token) {
        const decoded = verifyToken(token);
        if (decoded?.userId) {
          return `user:${decoded.userId}`;
        }
      }
    }
  } catch {
    // Abaikan token tidak valid/expired dan fallback ke IP
  }
  return `ip:${req.ip || "unknown"}`;
}

// Rate limiter umum untuk seluruh endpoint API
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 1200, // Longgar per user/key (tidak saling memblokir 1 Wi-Fi sekolah)
  keyGenerator: userOrIpKeyGenerator,
  skip: (req) => req.method === "OPTIONS",
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
  message: {
    success: false,
    message: "Terlalu banyak permintaan. Silakan tunggu beberapa saat lagi.",
  },
});

// Rate limiter khusus proteksi login (mencegah brute-force password admin/guru)
export const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 menit
  max: 30, // Maksimal 30 percobaan login per 5 menit per IP
  skip: (req) => req.method === "OPTIONS",
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: {
    success: false,
    message: "Terlalu banyak percobaan login gagal. Demi keamanan, coba lagi beberapa menit lagi.",
  },
});

// Rate limiter khusus endpoint autosave jawaban siswa (per userId)
export const examAnswerLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 menit
  max: 60, // Maksimal 60 batch request autosave per menit per siswa
  keyGenerator: userOrIpKeyGenerator,
  skip: (req) => req.method === "OPTIONS",
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
  message: {
    success: false,
    message: "Frekuensi pengiriman jawaban terlalu cepat, penyimpanan dijadwalkan ulang.",
  },
});
