import { prisma } from "../config/prisma";

export const TOKEN_ROTATION_MS = 10 * 60 * 1000; // 10 menit

/**
 * Menghasilkan kode token ujian acak yang mudah dibaca (contoh: CBT-4821)
 */
export function generateExamToken(prefix = "CBT"): string {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${num}`;
}

/**
 * Memastikan token ujian selalu diperbarui otomatis setiap 10 menit jika autoRotateToken aktif.
 */
export async function ensureFreshExamToken<
  T extends {
    id: string;
    token: string | null;
    tokenUpdatedAt: Date;
    autoRotateToken: boolean;
    status: string;
  }
>(exam: T): Promise<T & { tokenExpiresAt: string | null; tokenSecondsRemaining: number | null }> {
  const now = Date.now();
  const updatedAtMs = exam.tokenUpdatedAt ? new Date(exam.tokenUpdatedAt).getTime() : now;
  const elapsed = now - updatedAtMs;

  let currentToken = exam.token;
  let currentUpdatedAt = new Date(updatedAtMs);

  // Jika rotasi token otomatis dimatikan, token bersifat statis dan tidak memiliki hitung mundur kedaluwarsa
  if (!exam.autoRotateToken) {
    return {
      ...exam,
      token: currentToken,
      tokenUpdatedAt: currentUpdatedAt,
      tokenExpiresAt: null,
      tokenSecondsRemaining: null,
    };
  }

  if (
    exam.status === "AKTIF" &&
    exam.autoRotateToken &&
    (!currentToken || elapsed >= TOKEN_ROTATION_MS)
  ) {
    let nextToken = generateExamToken();
    while (nextToken === currentToken) {
      nextToken = generateExamToken();
    }
    const newUpdatedAt = new Date(now);
    await prisma.ujian.update({
      where: { id: exam.id },
      data: {
        token: nextToken,
        tokenUpdatedAt: newUpdatedAt,
      },
    });
    currentToken = nextToken;
    currentUpdatedAt = newUpdatedAt;
  }

  const expiresAtMs = currentUpdatedAt.getTime() + TOKEN_ROTATION_MS;
  const secondsRemaining = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));

  return {
    ...exam,
    token: currentToken,
    tokenUpdatedAt: currentUpdatedAt,
    tokenExpiresAt: new Date(expiresAtMs).toISOString(),
    tokenSecondsRemaining: secondsRemaining,
  };
}

/**
 * Menyinkronkan rotasi token 10 menit untuk seluruh ujian AKTIF
 */
export async function syncAllActiveExamTokens(): Promise<void> {
  const activeExams = await prisma.ujian.findMany({
    where: { status: "AKTIF", autoRotateToken: true },
    select: {
      id: true,
      token: true,
      tokenUpdatedAt: true,
      autoRotateToken: true,
      status: true,
    },
  });

  await Promise.all(activeExams.map((ex) => ensureFreshExamToken(ex)));
}
