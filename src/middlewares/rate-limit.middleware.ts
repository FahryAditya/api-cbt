import rateLimit from "express-rate-limit";

// Rate limiter umum untuk seluruh endpoint API
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 300, // Maksimal 300 request per window
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: {
    success: false,
    message: "Terlalu banyak permintaan dari IP ini. Silakan coba beberapa saat lagi.",
  },
});

// Rate limiter khusus proteksi login (mencegah brute-force password)
export const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 menit
  max: 15, // Maksimal 15 percobaan login per 5 menit
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: {
    success: false,
    message: "Terlalu banyak percobaan login gagal. Demi keamanan, akun dibatasi selama 5 menit.",
  },
});

// Rate limiter khusus endpoint autosave jawaban siswa (mencegah spam/DDoS saat ujian)
export const examAnswerLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 menit
  max: 60, // Maksimal 60 request autosave per menit per koneksi (1 detik/request max)
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: {
    success: false,
    message: "Frekuensi pengiriman jawaban terlalu cepat, penyimpanan dijadwalkan ulang.",
  },
});

