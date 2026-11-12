export interface ExamScoreResult {
  score: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  totalQuestions: number;
  isPassed: boolean;
}

/**
 * Hitung nilai pilihan ganda siswa secara deterministik dari kunci jawaban bank soal.
 */
export function calculateExamScore(
  allQuestions: { id: string; pilihanJawaban: { id: string; isKunci: boolean }[] }[],
  jawabanList: { soalId: string; pilihanId: string | null }[],
  kkm = 75
): ExamScoreResult {
  const totalQuestions = allQuestions.length || 1;
  let correctCount = 0;
  let wrongCount = 0;

  for (const soal of allQuestions) {
    const kunciJawaban = soal.pilihanJawaban.find((p) => p.isKunci);
    const jawabanSiswa = jawabanList.find((j) => j.soalId === soal.id);

    if (jawabanSiswa && jawabanSiswa.pilihanId) {
      if (kunciJawaban && jawabanSiswa.pilihanId === kunciJawaban.id) {
        correctCount += 1;
      } else {
        wrongCount += 1;
      }
    }
  }

  const score = Number(((correctCount / totalQuestions) * 100).toFixed(1));
  return {
    score,
    correctCount,
    wrongCount,
    unansweredCount: Math.max(0, totalQuestions - (correctCount + wrongCount)),
    totalQuestions,
    isPassed: score >= kkm,
  };
}
