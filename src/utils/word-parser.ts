import mammoth from "mammoth";

export interface ParsedWordOption {
  label: string;
  text: string;
  isCorrect: boolean;
}

export interface ParsedWordQuestion {
  number: number;
  stimulus: string;
  questionText: string;
  fullText: string;
  options: ParsedWordOption[];
  correctLabel: string;
  points: number;
}

export interface WordParseResult {
  extractedText: string;
  questions: ParsedWordQuestion[];
  answerKeyCount: number;
  warnings: string[];
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)));
}

/**
 * Convert HTML from mammoth into normalized line-oriented plain text
 * preserving table rows with `|` separators so headers, stimulus boxes,
 * questions, options, and multi-column answer key tables stay structured.
 */
export function htmlToStructuredText(html: string): string {
  const withStructure = html
    // Inside table cells, keep single-paragraph cell values on the same row line
    .replace(/<\/(p|div|h[1-6])>\s*(?=<\/t[dh]>)/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|div|blockquote)>/gi, "\n")
    .replace(/<t[dh][^>]*>/gi, "")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return decodeHtmlEntities(withStructure)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .map((line) => line.replace(/\|\s*$/, "").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

export async function extractTextFromDocxBase64(fileBase64: string): Promise<string> {
  const cleanBase64 = fileBase64.includes(",")
    ? fileBase64.split(",").pop() || ""
    : fileBase64;
  const buffer = Buffer.from(cleanBase64, "base64");
  if (buffer.length === 0) {
    throw new Error("File Word (.docx) kosong atau tidak valid.");
  }
  const result = await mammoth.convertToHtml({ buffer });
  return htmlToStructuredText(result.value || "");
}

function isMetadataOrHeaderLine(line: string): boolean {
  const cleaned = line.replace(/^\|+|\|+$/g, "").trim();
  if (!cleaned) return true;
  if (/^[-=|_\s]+$/.test(cleaned)) return true;

  const ignorePatterns = [
    /^NASKAH SOAL/i,
    /^TAHUN PELAJARAN/i,
    /^SMK\s+/i,
    /^SMA\s+/i,
    /^SMP\s+/i,
    /^Elemen\s*:/i,
    /^Mata Pelajaran\s*:/i,
    /^Kelas\s*\/\s*Fase\s*:/i,
    /^Kurikulum\s*:/i,
    /^Waktu\s*:/i,
    /^Sifat Ujian\s*:/i,
    /^Bentuk Soal\s*:/i,
    /^PETUNJUK UMUM/i,
    /^BAGIAN\s+[IVXLC0-9]+/i,
    /^No\.\s*\|\s*Elemen/i,
  ];
  return ignorePatterns.some((rx) => rx.test(cleaned));
}

function parseAnswerKeyLines(lines: string[]): Record<number, string> {
  const keys: Record<number, string> = {};

  // First pass: check explicit line patterns (table rows with `|` or `1. A` / `1) A` / `1: A` / `1 A`)
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 1. Pipe-delimited or tab-delimited table row: e.g. "1 | Pancasila | A | 51 | UUD NRI Tahun 1945 | A"
    if (line.includes("|") || line.includes("\t")) {
      const cells = line
        .split(/\||\t/)
        .map((c) => c.trim())
        .filter(Boolean);

      for (let i = 0; i < cells.length; i++) {
        if (/^\d{1,4}$/.test(cells[i])) {
          const num = Number(cells[i]);
          for (let j = i + 1; j <= Math.min(i + 3, cells.length - 1); j++) {
            if (/^[A-Fa-f]$/.test(cells[j])) {
              keys[num] = cells[j].toUpperCase();
              i = j;
              break;
            }
          }
        }
      }
      continue;
    }

    // 2. Standard numbered answer pairs on one or multiple columns: "1. A", "1) A", "1: A", "1 - A"
    const pairRegex = /(?:^|\s)(\d{1,4})\s*[.):=-]\s*([A-Fa-f])(?=\s|$|,|;)/g;
    let match: RegExpExecArray | null;
    while ((match = pairRegex.exec(line)) !== null) {
      keys[Number(match[1])] = match[2].toUpperCase();
    }
  }

  // Fallback pass for copy-pasted Word tables where each cell becomes its own line:
  // "1" \n "Pancasila" \n "A" \n "51" \n "UUD NRI Tahun 1945" \n "A"
  if (Object.keys(keys).length === 0) {
    const cleanedTokens = lines
      .map((l) => l.replace(/^\|+|\|+$/g, "").trim())
      .filter(Boolean);
    for (let i = 0; i < cleanedTokens.length; i++) {
      if (/^\d{1,4}$/.test(cleanedTokens[i])) {
        const num = Number(cleanedTokens[i]);
        for (let j = i + 1; j <= Math.min(i + 3, cleanedTokens.length - 1); j++) {
          if (/^[A-Fa-f]$/.test(cleanedTokens[j])) {
            keys[num] = cleanedTokens[j].toUpperCase();
            i = j;
            break;
          }
          if (/^\d{1,4}$/.test(cleanedTokens[j])) break;
        }
      }
    }
  }

  return keys;
}

export function parseWordQuestions(rawText: string, defaultPoints = 1): WordParseResult {
  const normalizedLines = rawText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim());

  // Locate answer key section if present
  let answerKeyStartIdx = normalizedLines.length;
  for (let i = 0; i < normalizedLines.length; i++) {
    if (
      /KUNCI JAWABAN/i.test(normalizedLines[i]) ||
      /^No\.\s*\|\s*Elemen\s*\|\s*Kunci/i.test(normalizedLines[i])
    ) {
      answerKeyStartIdx = i;
      break;
    }
  }

  const questionLines = normalizedLines.slice(0, answerKeyStartIdx);
  const answerKeyLines = normalizedLines.slice(answerKeyStartIdx);
  const answerKeys = parseAnswerKeyLines(answerKeyLines);

  interface DraftQuestion {
    number: number;
    stimulus: string;
    questionText: string;
    options: { label: string; text: string }[];
  }

  const drafts: DraftQuestion[] = [];
  const stimulusRanges: { start: number; end: number; text: string }[] = [];

  let currentDraft: DraftQuestion | null = null;
  let activeStimulus: { start: number; end: number; lines: string[] } | null = null;

  const flushStimulus = () => {
    if (!activeStimulus) return;
    const text = activeStimulus.lines.join("\n").trim();
    if (text) {
      stimulusRanges.push({
        start: activeStimulus.start,
        end: activeStimulus.end,
        text,
      });
    }
    activeStimulus = null;
  };

  for (const rawLine of questionLines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Detect start of Stimulus / Wacana block: e.g. "STIMULUS BACAAN (SOAL 1 - 5)"
    const stimMatch = line.match(
      /STIMULUS\s+BACAAN\s*\(\s*SOAL\s*(\d+)\s*[-–]\s*(\d+)\s*\)(.*)/i
    );
    if (stimMatch) {
      flushStimulus();
      const start = Number(stimMatch[1]);
      const end = Number(stimMatch[2]);
      const remainder = stimMatch[3].replace(/^\|+|\|+$/g, "").trim();
      activeStimulus = {
        start,
        end,
        lines: remainder ? [remainder] : [],
      };
      continue;
    }

    // Check numbered question: e.g. "1. [Judul] Pertanyaan..." or "1) Pertanyaan..."
    const qMatch = line.match(/^(\d{1,4})[.)]\s+(.+)$/);
    if (qMatch) {
      const qNum = Number(qMatch[1]);
      const qBody = qMatch[2].trim();

      // Skip petunjuk umum lines like "1. Bacalah wacana/stimulus..." before BAGIAN / Soal 1
      if (
        /^Bacalah wacana|^Soal mengusung|^Pilihlah satu jawaban|^Jawablah seluruh/i.test(
          qBody
        )
      ) {
        continue;
      }

      flushStimulus();
      currentDraft = {
        number: qNum,
        stimulus: "",
        questionText: qBody,
        options: [],
      };
      drafts.push(currentDraft);
      continue;
    }

    // If we are inside an active stimulus block, accumulate stimulus lines
    if (activeStimulus) {
      const cleanedStim = line.replace(/^\|+|\|+$/g, "").trim();
      if (cleanedStim && !isMetadataOrHeaderLine(cleanedStim)) {
        activeStimulus.lines.push(cleanedStim);
      }
      continue;
    }

    if (isMetadataOrHeaderLine(line)) {
      continue;
    }

    // Check option line: e.g. "A. Teks pilihan..." or "B) Teks..."
    const optMatch = line.match(/^([A-Fa-f])[.)]\s+(.+)$/);
    if (optMatch && currentDraft) {
      currentDraft.options.push({
        label: optMatch[1].toUpperCase(),
        text: optMatch[2].trim(),
      });
      continue;
    }

    // Check inline answer hint if someone puts "Kunci: A" inside question body
    const inlineKeyMatch = line.match(/^(?:Kunci|Jawaban)\s*[:=]\s*([A-Fa-f])\b/i);
    if (inlineKeyMatch && currentDraft) {
      answerKeys[currentDraft.number] = inlineKeyMatch[1].toUpperCase();
      continue;
    }

    // Continuation line for either last option or current question text
    if (currentDraft) {
      if (currentDraft.options.length > 0) {
        const lastOpt = currentDraft.options[currentDraft.options.length - 1];
        lastOpt.text = `${lastOpt.text} ${line}`.trim();
      } else {
        currentDraft.questionText = `${currentDraft.questionText} ${line}`.trim();
      }
    }
  }

  flushStimulus();

  const warnings: string[] = [];
  const questions: ParsedWordQuestion[] = drafts
    .filter((d) => d.options.length >= 2)
    .map((d) => {
      const matchedStimulus = stimulusRanges.find(
        (s) => d.number >= s.start && d.number <= s.end
      );
      const stimulusText = matchedStimulus ? matchedStimulus.text : "";
      const fullText = stimulusText
        ? `${stimulusText}\n\n${d.questionText}`
        : d.questionText;

      const detectedKey = answerKeys[d.number];
      const hasMatchingOption =
        detectedKey && d.options.some((o) => o.label === detectedKey);
      const correctLabel = hasMatchingOption ? detectedKey : d.options[0].label;

      if (!hasMatchingOption) {
        warnings.push(
          `Soal #${d.number}: kunci jawaban tidak ditemukan, sementara diset ke "${correctLabel}".`
        );
      }

      return {
        number: d.number,
        stimulus: stimulusText,
        questionText: d.questionText,
        fullText,
        options: d.options.map((o) => ({
          label: o.label,
          text: o.text,
          isCorrect: o.label === correctLabel,
        })),
        correctLabel,
        points: defaultPoints,
      };
    });

  const skippedCount = drafts.length - questions.length;
  if (skippedCount > 0) {
    warnings.unshift(
      `${skippedCount} blok nomor soal dilewati karena memiliki kurang dari 2 pilihan jawaban.`
    );
  }

  return {
    extractedText: rawText,
    questions,
    answerKeyCount: Object.keys(answerKeys).length,
    warnings,
  };
}
