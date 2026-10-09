const XLSX = require('xlsx');
const mammoth = require('mammoth');
const { v4: uuidv4 } = require('uuid');

/**
 * QuestionParser
 * Handles parsing questions from Excel (.xlsx, .xls, .csv) and Word (.docx).
 * Also generates downloadable template files.
 */
class QuestionParser {
  /**
   * Parse an Excel buffer into structured questions
   * @param {Buffer} buffer 
   * @returns {Array<Object>}
   */
  static parseExcel(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Read as array of rows
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (!rawData || rawData.length < 2) {
      throw new Error('File Excel kosong atau tidak memiliki baris data.');
    }

    // Identify header indices (row 0)
    const headerRow = rawData[0].map(h => String(h).trim().toLowerCase());
    
    // Helper to find column index with exact match preference
    const findCol = (exactKeywords, partialKeywords = []) => {
      // 1. Exact match
      let idx = headerRow.findIndex(h => exactKeywords.some(k => h === k));
      if (idx !== -1) return idx;
      // 2. Starts with keyword
      idx = headerRow.findIndex(h => exactKeywords.some(k => h.startsWith(k + ' ') || h.startsWith(k + '/') || h.startsWith(k + '(')));
      if (idx !== -1) return idx;
      // 3. Fallback partial for multi-character keywords (length > 2)
      return headerRow.findIndex(h => partialKeywords.some(k => k.length > 2 && h.includes(k)));
    };

    const typeIdx = findCol(['tipe soal', 'tipe', 'type', 'jenis']);
    // For question, ensure it doesn't match 'tipe soal'
    let questionIdx = headerRow.findIndex(h => (h === 'pertanyaan' || h === 'soal' || h === 'question') && !h.includes('tipe'));
    if (questionIdx === -1) {
      questionIdx = headerRow.findIndex(h => (h.includes('pertanyaan') || h.includes('soal')) && !h.includes('tipe'));
    }
    if (questionIdx === -1) {
      questionIdx = findCol(['text', 'question']);
    }

    const optAIdx = findCol(['pilihan a', 'opsi a', 'a'], ['pilihan a', 'opsi a', 'pasangan 1']);
    const optBIdx = findCol(['pilihan b', 'opsi b', 'b'], ['pilihan b', 'opsi b', 'pasangan 2']);
    const optCIdx = findCol(['pilihan c', 'opsi c', 'c'], ['pilihan c', 'opsi c', 'pasangan 3']);
    const optDIdx = findCol(['pilihan d', 'opsi d', 'd'], ['pilihan d', 'opsi d', 'pasangan 4']);
    const answerIdx = findCol(['kunci jawaban', 'kunci', 'jawaban benar', 'jawaban', 'correct']);
    const pointsIdx = findCol(['poin', 'nilai', 'skor', 'points', 'score']);

    if (questionIdx === -1) {
      throw new Error('Kolom "Pertanyaan" / "Soal" tidak ditemukan di baris pertama Excel.');
    }

    const questions = [];

    for (let r = 1; r < rawData.length; r++) {
      const row = rawData[r];
      if (!row || row.every(cell => String(cell).trim() === '')) {
        continue; // skip empty rows
      }

      const qText = String(row[questionIdx] || '').trim();
      if (!qText) continue;

      const rawType = typeIdx !== -1 ? String(row[typeIdx] || '').trim().toLowerCase() : '';
      const rawAns = answerIdx !== -1 ? String(row[answerIdx] || '').trim() : '';
      const rawPoints = pointsIdx !== -1 ? parseInt(row[pointsIdx], 10) : 100;
      const points = (!isNaN(rawPoints) && rawPoints > 0) ? rawPoints : 100;

      const optA = optAIdx !== -1 ? String(row[optAIdx] || '').trim() : '';
      const optB = optBIdx !== -1 ? String(row[optBIdx] || '').trim() : '';
      const optC = optCIdx !== -1 ? String(row[optCIdx] || '').trim() : '';
      const optD = optDIdx !== -1 ? String(row[optDIdx] || '').trim() : '';

      // Determine question type
      let type = 'multiple_choice'; // default
      if (rawType.includes('b') && (rawType.includes('s') || rawType.includes('benar') || rawType.includes('tf'))) {
        type = 'true_false';
      } else if (rawType.includes('isi') || rawType.includes('singkat') || rawType.includes('short')) {
        type = 'short_answer';
      } else if (rawType.includes('jodoh') || rawType.includes('match') || rawType.includes('pasang')) {
        type = 'matching';
      } else if (rawType.includes('pg') || rawType.includes('pilihan') || rawType.includes('mc')) {
        type = 'multiple_choice';
      } else {
        // Auto-detect if type not specified
        if (optA && optB) {
          type = 'multiple_choice';
        } else if (rawAns.toLowerCase() === 'benar' || rawAns.toLowerCase() === 'salah' || rawAns.toLowerCase() === 'true' || rawAns.toLowerCase() === 'false') {
          type = 'true_false';
        } else {
          type = 'short_answer';
        }
      }

      const qObj = {
        id: uuidv4(),
        question: qText,
        text: qText, // alias for frontend compatibility
        type: type,
        points: points
      };

      if (type === 'multiple_choice') {
        const options = [optA, optB, optC, optD].filter(o => o !== '');
        while (options.length < 4) {
          options.push(`Opsi ${options.length + 1}`);
        }
        qObj.options = options;

        // Resolve correct answer (could be 'A', 'B', 'C', 'D' or 0,1,2,3 or the text itself)
        let resolvedAns = optA; // fallback
        const ansUpper = rawAns.toUpperCase();
        if (ansUpper === 'A' || ansUpper === '0') {
          resolvedAns = optA;
          qObj.correctIndex = 0;
        } else if (ansUpper === 'B' || ansUpper === '1') {
          resolvedAns = optB;
          qObj.correctIndex = 1;
        } else if (ansUpper === 'C' || ansUpper === '2') {
          resolvedAns = optC;
          qObj.correctIndex = 2;
        } else if (ansUpper === 'D' || ansUpper === '3') {
          resolvedAns = optD;
          qObj.correctIndex = 3;
        } else {
          // Check if matches text
          const foundIdx = options.findIndex(o => o.toLowerCase() === rawAns.toLowerCase());
          if (foundIdx !== -1) {
            resolvedAns = options[foundIdx];
            qObj.correctIndex = foundIdx;
          } else {
            resolvedAns = rawAns || optA;
            qObj.correctIndex = 0;
          }
        }
        qObj.correctAnswer = resolvedAns;
      } else if (type === 'true_false') {
        const ansLower = rawAns.toLowerCase();
        const isTrue = ansLower === 'benar' || ansLower === 'true' || ansLower === 'b' || ansLower === '1';
        qObj.correctAnswer = isTrue;
        qObj.correct = isTrue; // alias
      } else if (type === 'short_answer') {
        qObj.correctAnswer = rawAns;
        qObj.correctText = rawAns; // alias
      } else if (type === 'matching') {
        // Options A-D can contain pairs "Kiri = Kanan" or "Kiri : Kanan"
        const pairs = [];
        const rawPairs = [optA, optB, optC, optD, rawAns].filter(p => p !== '');
        rawPairs.forEach(p => {
          const sep = p.includes('=') ? '=' : p.includes(':') ? ':' : p.includes('-') ? '-' : null;
          if (sep) {
            const parts = p.split(sep);
            const left = parts[0].trim();
            const right = parts.slice(1).join(sep).trim();
            if (left && right) pairs.push({ left, right });
          }
        });
        if (pairs.length < 2) {
          pairs.push({ left: 'Item 1', right: 'Pasangan 1' });
          pairs.push({ left: 'Item 2', right: 'Pasangan 2' });
        }
        qObj.matchingPairs = pairs;
        qObj.pairs = pairs; // alias
        qObj.lefts = pairs.map(p => p.left);
        qObj.rights = pairs.map(p => p.right);
      }

      questions.push(qObj);
    }

    if (questions.length === 0) {
      throw new Error('Tidak ada baris soal valid yang dapat diproses dari file Excel.');
    }

    return questions;
  }

  /**
   * Parse a Word (.docx) buffer into structured questions
   * @param {Buffer} buffer 
   * @returns {Promise<Array<Object>>}
   */
  static async parseWord(buffer) {
    const rawResult = await mammoth.extractRawText({ buffer });
    const text = rawResult.value;
    if (!text || text.trim() === '') {
      throw new Error('Dokumen Word kosong atau tidak dapat diekstrak teksnya.');
    }

    return QuestionParser.parseWordText(text);
  }

  /**
   * Parse text extracted from Word or pasted by teacher
   * @param {string} text 
   * @returns {Array<Object>}
   */
  static parseWordText(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const questions = [];
    let currentBlock = [];

    // Group lines into question blocks based on numbered prefixes like "1.", "1)", "Soal 1:"
    const isQuestionStart = (line) => {
      return /^(?:\d+[\.\)]|soal\s*\d+[\.\:\-]|\[\d+\])\s+/i.test(line);
    };

    let foundFirstQuestion = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isQuestionStart(line)) {
        foundFirstQuestion = true;
        if (currentBlock.length > 0) {
          const q = QuestionParser._parseSingleWordBlock(currentBlock);
          if (q) questions.push(q);
          currentBlock = [];
        }
      }
      if (foundFirstQuestion) {
        // Ignore separator lines like "----", "===="
        if (!/^[=\-_*]{3,}$/.test(line)) {
          currentBlock.push(line);
        }
      }
    }

    if (currentBlock.length > 0) {
      const q = QuestionParser._parseSingleWordBlock(currentBlock);
      if (q) questions.push(q);
    }

    if (questions.length === 0) {
      throw new Error('Format Word tidak dikenali. Pastikan setiap soal diawali penomoran seperti "1.", "2.", dsb.');
    }

    return questions;
  }

  /**
   * Helper to parse a single question block of lines
   */
  static _parseSingleWordBlock(lines) {
    if (!lines || lines.length === 0) return null;

    let firstLine = lines[0].replace(/^(?:\d+[\.\)]|soal\s*\d+[\.\:\-]|\[\d+\])\s*/i, '').trim();
    
    // Check type tag in first line, e.g. [PG], [BS], [Isian], [Jodohkan]
    let type = 'multiple_choice';
    const tagMatch = firstLine.match(/^\[(PG|MC|BS|TF|ISIAN|SHORT|JODOHKAN|MATCH)\]\s*/i);
    if (tagMatch) {
      const tag = tagMatch[1].toUpperCase();
      if (tag === 'PG' || tag === 'MC') type = 'multiple_choice';
      else if (tag === 'BS' || tag === 'TF') type = 'true_false';
      else if (tag === 'ISIAN' || tag === 'SHORT') type = 'short_answer';
      else if (tag === 'JODOHKAN' || tag === 'MATCH') type = 'matching';
      firstLine = firstLine.replace(tagMatch[0], '').trim();
    }

    let questionText = firstLine;
    let options = [];
    let keyAnswer = '';
    let points = 100;
    const matchingPairs = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      // Ignore guide/tip lines at the end of file
      if (line.includes('💡') || /^(?:tips|catatan|petunjuk|aturan|panduan|===)/i.test(line)) {
        break;
      }

      // Points: "Poin: 150" or "Nilai: 100"
      if (/^(?:poin|point|nilai|skor)\s*[:=]\s*(\d+)/i.test(line)) {
        const m = line.match(/^(?:poin|point|nilai|skor)\s*[:=]\s*(\d+)/i);
        points = parseInt(m[1], 10) || 100;
        continue;
      }

      // Key Answer: "Kunci: B" or "Jawaban: Jakarta"
      if (/^(?:kunci|jawaban|kunci jawaban|correct|ans)\s*[:=]\s*(.+)/i.test(line)) {
        const m = line.match(/^(?:kunci|jawaban|kunci jawaban|correct|ans)\s*[:=]\s*(.+)/i);
        keyAnswer = m[1].trim();
        continue;
      }

      // Multiple choice option: "A. Opsi", "A) Opsi", "- A. Opsi"
      const optMatch = line.match(/^[-\s]*([A-D])[\.\)]\s*(.+)/i);
      if (optMatch) {
        type = 'multiple_choice';
        options.push({ label: optMatch[1].toUpperCase(), text: optMatch[2].trim() });
        continue;
      }

      // Matching pair item: "- Kiri = Kanan" or "Kiri : Kanan"
      // Only match if line starts with bullet or if type is matching
      if ((type === 'matching' || /^[-\*•]\s+/.test(line)) && (line.includes('=') || line.includes(':'))) {
        const sep = line.includes('=') ? '=' : ':';
        const cleanLine = line.replace(/^[-\*•\d\.\)]\s*/, '');
        const parts = cleanLine.split(sep);
        if (parts.length >= 2) {
          const left = parts[0].trim();
          const right = parts.slice(1).join(sep).trim();
          if (left && right && !/^(?:kunci|jawaban|poin|nilai)/i.test(left)) {
            matchingPairs.push({ left, right });
            type = 'matching';
            continue;
          }
        }
      }

      // Append multiline question text if we haven't hit options or key yet
      if (options.length === 0 && !keyAnswer && matchingPairs.length === 0) {
        questionText += ' ' + line;
      }
    }

    if (!questionText) return null;

    const qObj = {
      id: uuidv4(),
      question: questionText,
      text: questionText,
      type: type,
      points: points
    };

    if (type === 'multiple_choice') {
      const optTexts = options.map(o => o.text);
      while (optTexts.length < 4) {
        optTexts.push(`Pilihan ${optTexts.length + 1}`);
      }
      qObj.options = optTexts;

      const upperKey = keyAnswer.toUpperCase();
      let resolvedAns = optTexts[0];
      if (upperKey === 'A') { resolvedAns = optTexts[0]; qObj.correctIndex = 0; }
      else if (upperKey === 'B') { resolvedAns = optTexts[1]; qObj.correctIndex = 1; }
      else if (upperKey === 'C') { resolvedAns = optTexts[2]; qObj.correctIndex = 2; }
      else if (upperKey === 'D') { resolvedAns = optTexts[3]; qObj.correctIndex = 3; }
      else {
        const found = optTexts.findIndex(o => o.toLowerCase() === keyAnswer.toLowerCase());
        if (found !== -1) {
          resolvedAns = optTexts[found];
          qObj.correctIndex = found;
        } else {
          resolvedAns = keyAnswer || optTexts[0];
          qObj.correctIndex = 0;
        }
      }
      qObj.correctAnswer = resolvedAns;
    } else if (type === 'true_false') {
      const k = keyAnswer.toLowerCase();
      const isTrue = k.includes('b') || k.includes('true') || k === '1';
      qObj.correctAnswer = isTrue;
      qObj.correct = isTrue;
    } else if (type === 'short_answer') {
      qObj.correctAnswer = keyAnswer;
      qObj.correctText = keyAnswer;
    } else if (type === 'matching') {
      if (matchingPairs.length < 2) {
        matchingPairs.push({ left: 'Item A', right: 'Target A' });
        matchingPairs.push({ left: 'Item B', right: 'Target B' });
      }
      qObj.matchingPairs = matchingPairs;
      qObj.pairs = matchingPairs;
      qObj.lefts = matchingPairs.map(p => p.left);
      qObj.rights = matchingPairs.map(p => p.right);
    }

    return qObj;
  }

  /**
   * Generates a fully formatted Excel template workbook as a Buffer
   * @returns {Buffer}
   */
  static generateExcelTemplate() {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Template Soal
    const headers = [
      'No',
      'Tipe Soal (PG / Benar Salah / Isian / Menjodohkan)',
      'Pertanyaan',
      'Pilihan A / Pasangan 1',
      'Pilihan B / Pasangan 2',
      'Pilihan C / Pasangan 3',
      'Pilihan D / Pasangan 4',
      'Kunci Jawaban',
      'Poin (Default 100)'
    ];

    const sampleRows = [
      [
        1,
        'PG',
        'Apa ibukota negara Indonesia saat ini?',
        'Bandung',
        'Jakarta',
        'Surabaya',
        'Medan',
        'B',
        100
      ],
      [
        2,
        'Benar Salah',
        'Matahari terbit dari sebelah barat.',
        '',
        '',
        '',
        '',
        'Salah',
        150
      ],
      [
        3,
        'Isian',
        'Siapakah nama presiden pertama Republik Indonesia?',
        '',
        '',
        '',
        '',
        'Soekarno',
        200
      ],
      [
        4,
        'PG',
        'Berapakah hasil dari 25 x 4?',
        '50',
        '75',
        '100',
        '125',
        'C',
        100
      ],
      [
        5,
        'Menjodohkan',
        'Pasangkan negara dengan ibukotanya masing-masing:',
        'Indonesia = Jakarta',
        'Jepang = Tokyo',
        'Inggris = London',
        'Prancis = Paris',
        'Semua Pasangan',
        250
      ]
    ];

    const wsData = [headers, ...sampleRows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    ws['!cols'] = [
      { wch: 5 },  // No
      { wch: 25 }, // Tipe
      { wch: 45 }, // Pertanyaan
      { wch: 25 }, // Opt A
      { wch: 25 }, // Opt B
      { wch: 25 }, // Opt C
      { wch: 25 }, // Opt D
      { wch: 18 }, // Kunci
      { wch: 12 }  // Poin
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Soal Kuis');

    // Sheet 2: Petunjuk Pengisian
    const guideHeaders = ['Kolom', 'Penjelasan & Contoh'];
    const guideRows = [
      ['Tipe Soal', 'Isi dengan "PG" (Pilihan Ganda), "Benar Salah", "Isian", atau "Menjodohkan".'],
      ['Pertanyaan', 'Teks pertanyaan atau instruksi soal.'],
      ['Pilihan A - D', 'Untuk PG: Isi pilihan A, B, C, D. Untuk Menjodohkan: Tulis format "Kiri = Kanan" di setiap kolom.'],
      ['Kunci Jawaban', 'Untuk PG: Isi huruf A, B, C, atau D. Untuk Benar Salah: Isi "Benar" atau "Salah". Untuk Isian: Tulis jawaban tepatnya.'],
      ['Poin', 'Nilai poin jika siswa benar (bebas diatur, contoh 100, 200, dsb. Jika kosong otomatis 100).'],
      ['Tips Guru', 'Anda bisa langsung copy-paste baris soal sebanyak yang diinginkan. Tidak ada batasan jumlah soal!']
    ];
    const wsGuide = XLSX.utils.aoa_to_sheet([guideHeaders, ...guideRows]);
    wsGuide['!cols'] = [{ wch: 18 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(wb, wsGuide, 'Petunjuk Guru');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Generates a sample Word (.docx) document as a Buffer using docx library
   * @returns {Promise<Buffer>}
   */
  static async generateWordDocxBuffer() {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } = require('docx');

    const borderStyle = {
      top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
    };

    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            text: "⚔️ CLASH OF CHAMPION — TEMPLATE SOAL GURU",
            heading: HeadingLevel.TITLE,
            spacing: { after: 200 }
          }),
          new Paragraph({
            children: [
              new TextRun({ 
                text: "Petunjuk: Anda dapat mengedit soal-soal di bawah ini, atau menambahkan soal baru mengikuti format penomoran yang sama. Setelah selesai, simpan file ini dan unggah langsung di panel Admin!", 
                italics: true,
                color: "555555"
              })
            ],
            spacing: { after: 300 }
          }),

          // Section 1: Pilihan Ganda
          new Paragraph({
            text: "1. [PG] Apa ibukota negara Indonesia saat ini?",
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 }
          }),
          new Paragraph({ text: "A. Bandung" }),
          new Paragraph({ text: "B. Jakarta" }),
          new Paragraph({ text: "C. Surabaya" }),
          new Paragraph({ text: "D. Medan" }),
          new Paragraph({ children: [new TextRun({ text: "Kunci: B", bold: true, color: "008000" })] }),
          new Paragraph({ text: "Poin: 100", spacing: { after: 300 } }),

          new Paragraph({
            text: "2. [PG] Berapakah hasil dari perhitungan 25 x 4?",
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 }
          }),
          new Paragraph({ text: "A. 50" }),
          new Paragraph({ text: "B. 75" }),
          new Paragraph({ text: "C. 100" }),
          new Paragraph({ text: "D. 125" }),
          new Paragraph({ children: [new TextRun({ text: "Kunci: C", bold: true, color: "008000" })] }),
          new Paragraph({ text: "Poin: 100", spacing: { after: 300 } }),

          // Section 2: Benar / Salah
          new Paragraph({
            text: "3. [BS] Matahari terbit dari sebelah barat.",
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 }
          }),
          new Paragraph({ children: [new TextRun({ text: "Kunci: Salah", bold: true, color: "C00000" })] }),
          new Paragraph({ text: "Poin: 150", spacing: { after: 300 } }),

          new Paragraph({
            text: "4. [BS] Lagu kebangsaan Republik Indonesia adalah Indonesia Raya.",
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 }
          }),
          new Paragraph({ children: [new TextRun({ text: "Kunci: Benar", bold: true, color: "008000" })] }),
          new Paragraph({ text: "Poin: 100", spacing: { after: 300 } }),

          // Section 3: Isian Singkat
          new Paragraph({
            text: "5. [Isian] Siapakah nama presiden pertama Republik Indonesia?",
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 }
          }),
          new Paragraph({ children: [new TextRun({ text: "Kunci: Soekarno", bold: true, color: "008000" })] }),
          new Paragraph({ text: "Poin: 200", spacing: { after: 300 } }),

          new Paragraph({
            text: "6. [Isian] Planet terdekat dengan matahari adalah planet?",
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 }
          }),
          new Paragraph({ children: [new TextRun({ text: "Kunci: Merkurius", bold: true, color: "008000" })] }),
          new Paragraph({ text: "Poin: 150", spacing: { after: 300 } }),

          // Section 4: Menjodohkan
          new Paragraph({
            text: "7. [Jodohkan] Pasangkan negara berikut dengan ibukotanya masing-masing:",
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 }
          }),
          new Paragraph({ text: "- Indonesia = Jakarta" }),
          new Paragraph({ text: "- Jepang = Tokyo" }),
          new Paragraph({ text: "- Inggris = London" }),
          new Paragraph({ text: "- Prancis = Paris" }),
          new Paragraph({ text: "Poin: 250", spacing: { after: 400 } }),

          // Guide Note
          new Paragraph({
            children: [
              new TextRun({ text: "💡 Aturan Penulisan:", bold: true }),
            ],
            spacing: { before: 200, after: 100 }
          }),
          new Paragraph({ text: "• Setiap soal wajib diawali nomor urut seperti '1.', '2.', '3.'" }),
          new Paragraph({ text: "• Tag tipe soal opsional: [PG], [BS], [Isian], atau [Jodohkan]" }),
          new Paragraph({ text: "• Tulis 'Kunci: [Jawaban]' di bawah pertanyaan/opsi" }),
          new Paragraph({ text: "• Tulis 'Poin: [Nilai]' jika ingin poin kustom (default 100)" })
        ]
      }]
    });

    return await Packer.toBuffer(doc);
  }

  /**
   * Generates a sample Word (.docx / plain text guide) format content
   * @returns {string}
   */
  static generateWordSampleText() {
    return `=== PANDUAN & CONTOH FORMAT SOAL WORD CLASH OF CHAMPION ===

Guru dapat menulis soal di Microsoft Word dengan format bernomor seperti di bawah ini.
Simpan file sebagai .docx lalu upload langsung di aplikasi!

-------------------------------------------------------------
CONTOH 1: PILIHAN GANDA (Gunakan tag [PG] atau langsung opsi A-D)
-------------------------------------------------------------
1. [PG] Apa ibukota negara Indonesia?
A. Bandung
B. Jakarta
C. Surabaya
D. Medan
Kunci: B
Poin: 100

2. Berapakah hasil dari perhitungan 15 + 25?
A. 30
B. 35
C. 40
D. 45
Kunci: C
Poin: 100

-------------------------------------------------------------
CONTOH 2: BENAR / SALAH (Gunakan tag [BS])
-------------------------------------------------------------
3. [BS] Matahari terbit dari sebelah barat.
Kunci: Salah
Poin: 150

4. [BS] Lagu kebangsaan Indonesia adalah Indonesia Raya.
Kunci: Benar
Poin: 100

-------------------------------------------------------------
CONTOH 3: ISIAN SINGKAT (Gunakan tag [Isian])
-------------------------------------------------------------
5. [Isian] Siapakah bapak proklamator dan presiden pertama Indonesia?
Kunci: Soekarno
Poin: 200

6. [Isian] Planet terdekat dengan matahari adalah planet?
Kunci: Merkurius
Poin: 150

-------------------------------------------------------------
CONTOH 4: MENJODOHKAN (Gunakan tag [Jodohkan])
-------------------------------------------------------------
7. [Jodohkan] Pasangkan negara dengan ibukotanya:
- Indonesia = Jakarta
- Jepang = Tokyo
- Prancis = Paris
- Inggris = London
Poin: 250

-------------------------------------------------------------
TIPS UNTUK GURU:
- Setiap soal wajib diawali nomor seperti "1.", "2.", atau "1)", "2)".
- Tuliskan "Kunci: [Jawaban]" di bawah soal/opsi.
- Poin bersifat opsional, jika tidak dituliskan otomatis bernilai 100.
=============================================================`;
  }
}

module.exports = QuestionParser;
