const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const RoomManager = require('../game/RoomManager');
const GameEngine = require('../game/GameEngine');
const QuestionParser = require('../game/QuestionParser');
const AppDatabase = require('../game/Database');
const xlsx = require('xlsx');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

const app = express();
const server = http.createServer(app);

// Setup Socket.io with optimizations
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 10000,
  pingTimeout: 5000,
  maxHttpBufferSize: 1e6, // 1MB max payload
  perMessageDeflate: { threshold: 1024 }, // compress messages > 1KB
  connectTimeout: 10000
});

// Production optimizations for reverse proxy / cloud hosting
app.set('trust proxy', 1);

// Health check endpoint for cloud platforms (Railway, Render, Fly.io, Kubernetes)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: Date.now(),
    activeRooms: roomManager.rooms.size
  });
});

// Disable caching for JS/HTML files to prevent stale client code
app.use((req, res, next) => {
  if (req.url.endsWith('.js') || req.url.endsWith('.html') || req.url.endsWith('.css')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

const roomManager = new RoomManager();
const gameEngine = new GameEngine(io, roomManager);

// Structured logging
function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`, Object.keys(data).length ? data : '');
}

// Throttled Leaderboard Broadcast logic
const leaderboardTimers = new Map();

function scheduleLeaderboardBroadcast(pin) {
  if (leaderboardTimers.has(pin)) return;

  const timer = setTimeout(() => {
    leaderboardTimers.delete(pin);
    const leaderboard = gameEngine.getLeaderboard(pin);
    io.to(pin).emit('leaderboard-update', {
      timestamp: Date.now(),
      leaderboard
    });
  }, 300);
  leaderboardTimers.set(pin, timer);
}

// Admin reconnect logic
const adminDisconnects = new Map(); // pin -> { timeoutId, adminSocketId }
const emoteRateLimits = new Map(); // socket.id -> timestamp
const claimBoxLimits = new Map(); // socket.id -> timestamp

app.get('/api/room/:pin/status', (req, res) => {
  const room = roomManager.getRoom(req.params.pin);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json({
    pin: room.pin,
    status: room.status,
    playerCount: room.players.size
  });
});

app.get('/api/room/:pin/players', (req, res) => {
  const players = roomManager.getPlayerList(req.params.pin);
  res.json(players);
});

/**
 * GET /api/active-rooms
 * Returns all active rooms currently in lobby or playing state for registered students
 */
app.get('/api/active-rooms', (req, res) => {
  const activeRooms = [];
  for (const [pin, room] of roomManager.rooms.entries()) {
    if (room.status === 'lobby' || room.status === 'playing') {
      activeRooms.push({
        pin: room.pin,
        title: room.title || 'Kuis Clash of Champion',
        guruName: room.guruName || 'Guru',
        guruId: room.guruId,
        status: room.status,
        playerCount: room.players.size,
        maxPlayers: room.maxPlayers,
        createdAt: room.createdAt
      });
    }
  }
  activeRooms.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, rooms: activeRooms });
});

/**
 * GET /api/template/excel
 * Download the official Excel question template (.xlsx)
 */
app.get('/api/template/excel', (req, res) => {
  try {
    const buffer = QuestionParser.generateExcelTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="template_soal_clash_of_champion.xlsx"');
    res.send(buffer);
  } catch (err) {
    log('error', 'Gagal generate Excel template', { error: err.message });
    res.status(500).json({ error: 'Gagal membuat template Excel: ' + err.message });
  }
});

/**
 * GET /api/template/word
 * Download the official Word question template (.docx)
 */
app.get('/api/template/word', async (req, res) => {
  try {
    const buffer = await QuestionParser.generateWordDocxBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="template_soal_clash_of_champion.docx"');
    res.send(buffer);
  } catch (err) {
    log('error', 'Gagal generate Word template', { error: err.message });
    res.status(500).json({ error: 'Gagal membuat template Word: ' + err.message });
  }
});

/**
 * POST /api/upload-questions
 * Upload Excel (.xlsx, .xls, .csv) or Word (.docx) file and parse into questions
 */
app.post('/api/upload-questions', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Tidak ada file yang diunggah.' });
    }

    const filename = req.file.originalname.toLowerCase();
    let questions = [];

    if (filename.endsWith('.xlsx') || filename.endsWith('.xls') || filename.endsWith('.csv')) {
      questions = QuestionParser.parseExcel(req.file.buffer);
    } else if (filename.endsWith('.docx')) {
      questions = await QuestionParser.parseWord(req.file.buffer);
    } else {
      return res.status(400).json({ 
        success: false, 
        message: 'Format file tidak didukung. Harap unggah file Excel (.xlsx, .xls, .csv) atau Word (.docx).' 
      });
    }

    res.json({
      success: true,
      message: `Berhasil memuat ${questions.length} soal dari file!`,
      count: questions.length,
      questions
    });
  } catch (err) {
    log('error', 'Upload questions error', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/parse-word-text
 * Parse raw question text copied directly from Word/Notepad
 */
app.post('/api/parse-word-text', (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.trim() === '') {
      return res.status(400).json({ success: false, message: 'Teks soal tidak boleh kosong.' });
    }
    const questions = QuestionParser.parseWordText(text);
    res.json({
      success: true,
      message: `Berhasil memuat ${questions.length} soal dari teks!`,
      count: questions.length,
      questions
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ==========================================
// REST API: AUTHENTICATION & ROLE MANAGEMENT
// ==========================================

// In-memory Session store for RBAC token authentication
const sessionStore = new Map(); // token -> { id, username, role, name, expiresAt }

function createSessionToken(user) {
  const token = uuidv4();
  sessionStore.set(token, {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
  });
  return token;
}

function requireAuth(allowedRoles = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || req.headers['x-auth-token'];
    let token = null;

    if (authHeader && typeof authHeader === 'string') {
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
      } else {
        token = authHeader.trim();
      }
    } else if (req.query && req.query.token) {
      token = String(req.query.token).trim();
    }

    if (!token || !sessionStore.has(token)) {
      return res.status(401).json({ success: false, message: 'Autentikasi diperlukan. Silakan sertakan token otorisasi yang valid.' });
    }

    const session = sessionStore.get(token);
    if (Date.now() > session.expiresAt) {
      sessionStore.delete(token);
      return res.status(401).json({ success: false, message: 'Sesi Anda telah kedaluwarsa. Silakan login kembali.' });
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(session.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak: Wewenang tidak mencukupi untuk tindakan ini.' });
    }

    req.user = session;
    next();
  };
}

/**
 * POST /api/auth/login
 * Unified login endpoint for Admin, Guru, and Siswa
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
    }
    const user = await AppDatabase.authenticate(username, password);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Username atau password salah!' });
    }
    const token = createSessionToken(user);
    res.json({ success: true, user, token });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/teachers - List all teachers
 */
app.get('/api/admin/teachers', requireAuth(['admin']), async (req, res) => {
  try {
    const teachers = await AppDatabase.listUsersByRole('guru');
    res.json({ success: true, teachers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/admin/teachers - Create teacher account
 */
app.post('/api/admin/teachers', requireAuth(['admin']), async (req, res) => {
  try {
    const { username, password, name, nip, subject } = req.body;
    if (!username || !name) {
      return res.status(400).json({ success: false, message: 'Username dan Nama Guru wajib diisi.' });
    }
    const existing = await AppDatabase.getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Username guru sudah digunakan.' });
    }
    const teacher = await AppDatabase.createUser({
      username: username.trim(),
      password: password || 'guru123',
      role: 'guru',
      name: name.trim(),
      extra: { nip: nip || '', subject: subject || 'Umum' }
    });
    res.json({ success: true, teacher });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/admin/teachers/:id - Remove teacher account
 */
app.delete('/api/admin/teachers/:id', requireAuth(['admin']), async (req, res) => {
  try {
    await AppDatabase.deleteUser(req.params.id);
    res.json({ success: true, message: 'Akun guru berhasil dihapus.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/students - List all registered students
 */
app.get('/api/admin/students', requireAuth(['admin']), async (req, res) => {
  try {
    const students = await AppDatabase.listUsersByRole('siswa');
    res.json({ success: true, students });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/admin/students - Create single student
 */
app.post('/api/admin/students', requireAuth(['admin']), async (req, res) => {
  try {
    const { username, password, name, className } = req.body;
    if (!username || !name) {
      return res.status(400).json({ success: false, message: 'NIS (Username) dan Nama Siswa wajib diisi.' });
    }
    const existing = await AppDatabase.getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ success: false, message: 'NIS/Username siswa sudah terdaftar.' });
    }
    const student = await AppDatabase.createUser({
      username: username.trim(),
      password: password || '123',
      role: 'siswa',
      name: name.trim(),
      extra: { nis: username.trim(), class: className || 'Umum' }
    });
    res.json({ success: true, student });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/admin/students/bulk - Bulk create students from JSON list
 */
app.post('/api/admin/students/bulk', requireAuth(['admin']), async (req, res) => {
  try {
    const { students } = req.body;
    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ success: false, message: 'Data siswa bulk tidak valid atau kosong.' });
    }

    let createdCount = 0;
    const errors = [];

    for (const s of students) {
      const nis = String(s.nis || s.username || '').trim();
      const name = String(s.name || s.nama || '').trim();
      const pass = String(s.password || '123');
      const cls = String(s.class || s.kelas || 'Umum');

      if (!nis || !name) continue;

      const existing = await AppDatabase.getUserByUsername(nis);
      if (existing) {
        errors.push(`NIS ${nis} sudah terdaftar, dilewati.`);
        continue;
      }

      await AppDatabase.createUser({
        username: nis,
        password: pass,
        role: 'siswa',
        name: name,
        extra: { nis, class: cls }
      });
      createdCount++;
    }

    res.json({
      success: true,
      message: `Berhasil menambahkan ${createdCount} siswa!`,
      createdCount,
      errors
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/admin/students/:id - Delete a student
 */
app.delete('/api/admin/students/:id', requireAuth(['admin']), async (req, res) => {
  try {
    await AppDatabase.deleteUser(req.params.id);
    res.json({ success: true, message: 'Akun siswa berhasil dihapus.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/reports - View all quiz sessions (Admin)
 */
app.get('/api/admin/reports', requireAuth(['admin']), async (req, res) => {
  try {
    const sessions = await AppDatabase.listGameSessions();
    res.json({ success: true, sessions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/guru/reports - View quiz sessions for specific guru
 */
app.get('/api/guru/reports', requireAuth(['guru', 'admin']), async (req, res) => {
  try {
    const guruId = req.query.guruId ? parseInt(req.query.guruId) : null;
    const sessions = await AppDatabase.listGameSessions(guruId);
    res.json({ success: true, sessions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/guru/reports/:id - View detail of a single quiz session
 */
app.get('/api/guru/reports/:id', requireAuth(['guru', 'admin']), async (req, res) => {
  try {
    const session = await AppDatabase.getGameSessionById(req.params.id);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Sesi kuis tidak ditemukan.' });
    }
    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/guru/reports/:id/export-excel - Download Excel report of quiz session
 */
app.get('/api/guru/reports/:id/export-excel', requireAuth(['guru', 'admin']), async (req, res) => {
  try {
    const session = await AppDatabase.getGameSessionById(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Sesi kuis tidak ditemukan.' });
    }

    const records = session.studentRecords || [];
    const rows = records.map((r, i) => ({
      'Peringkat': r.rank || (i + 1),
      'NIS / Identitas': r.student_identifier || '-',
      'Nama Siswa': r.student_name,
      'Skor Akhir': r.score,
      'Akurasi (%)': `${r.accuracy}%`,
      'Streak Maksimal': r.max_streak,
      'Kotak Diambil': r.boxes_taken,
      'Tanggal': new Date(r.created_at).toLocaleDateString('id-ID')
    }));

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(rows);

    // Set column widths for readability
    ws['!cols'] = [
      { wch: 10 },
      { wch: 18 },
      { wch: 25 },
      { wch: 12 },
      { wch: 14 },
      { wch: 16 },
      { wch: 14 },
      { wch: 15 }
    ];

    xlsx.utils.book_append_sheet(wb, ws, 'Hasil Kuis');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const safeTitle = (session.title || 'Laporan_Kuis').replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}_PIN_${session.pin}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    log('error', 'Gagal export Excel rapor kuis', { error: err.message });
    res.status(500).json({ error: 'Gagal membuat file Excel: ' + err.message });
  }
});

/**
 * GET /api/admin/question-banks - List all question banks across all teachers and admins
 */
app.get('/api/admin/question-banks', requireAuth(['admin']), async (req, res) => {
  try {
    const banks = await AppDatabase.listQuestionBanks(null);
    res.json({ success: true, banks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/admin/question-banks - Admin creates a new question bank
 */
app.post('/api/admin/question-banks', requireAuth(['admin']), async (req, res) => {
  try {
    const { title, questions, guruId } = req.body;
    if (!title || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ success: false, message: 'Judul dan daftar soal minimal 1 soal wajib diisi.' });
    }
    const creatorId = guruId ? parseInt(guruId) : req.user.id;
    const id = await AppDatabase.saveQuestionBank(creatorId, title, questions);
    res.json({ success: true, id, message: 'Bank soal berhasil disimpan oleh Admin!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/question-banks/:id - Admin inspects specific question bank details
 */
app.get('/api/admin/question-banks/:id', requireAuth(['admin']), async (req, res) => {
  try {
    const bank = await AppDatabase.getQuestionBank(req.params.id, null);
    if (!bank) {
      return res.status(404).json({ success: false, message: 'Bank soal tidak ditemukan.' });
    }
    res.json({ success: true, bank });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/admin/question-banks/:id - Admin deletes any question bank
 */
app.delete('/api/admin/question-banks/:id', requireAuth(['admin']), async (req, res) => {
  try {
    const deleted = await AppDatabase.deleteQuestionBank(req.params.id, null);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Bank soal tidak ditemukan.' });
    }
    res.json({ success: true, message: 'Bank soal berhasil dihapus!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/guru/question-banks - List question banks saved by guru
 */
app.get('/api/guru/question-banks', requireAuth(['guru', 'admin']), async (req, res) => {
  try {
    const guruId = req.query.guruId ? parseInt(req.query.guruId) : (req.user.role === 'admin' ? null : req.user.id);
    const banks = await AppDatabase.listQuestionBanks(guruId);
    res.json({ success: true, banks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/guru/question-banks - Save question bank for guru
 */
app.post('/api/guru/question-banks', requireAuth(['guru', 'admin']), async (req, res) => {
  try {
    const { guruId, title, questions } = req.body;
    const targetGuruId = guruId || req.user.id;
    if (!targetGuruId || !title || !Array.isArray(questions)) {
      return res.status(400).json({ success: false, message: 'Data bank soal tidak lengkap.' });
    }
    const id = await AppDatabase.saveQuestionBank(targetGuruId, title, questions);
    res.json({ success: true, id, message: 'Bank soal berhasil disimpan!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/guru/question-banks/:id - Load specific question bank
 */
app.get('/api/guru/question-banks/:id', requireAuth(['guru', 'admin']), async (req, res) => {
  try {
    const guruId = req.user.role === 'admin' ? null : (req.query.guruId ? parseInt(req.query.guruId) : req.user.id);
    const bank = await AppDatabase.getQuestionBank(req.params.id, guruId);
    if (!bank) {
      return res.status(404).json({ success: false, message: 'Bank soal tidak ditemukan.' });
    }
    res.json({ success: true, bank });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/guru/question-banks/:id - Delete question bank by owner or admin
 */
app.delete('/api/guru/question-banks/:id', requireAuth(['guru', 'admin']), async (req, res) => {
  try {
    const guruId = req.user.role === 'admin' ? null : req.user.id;
    const deleted = await AppDatabase.deleteQuestionBank(req.params.id, guruId);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Bank soal tidak ditemukan atau Anda tidak berwenang.' });
    }
    res.json({ success: true, message: 'Bank soal berhasil dihapus!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/guru/claim-session
 * Retroactively links and saves an anonymous game session to a teacher's account.
 */
app.post('/api/guru/claim-session', async (req, res) => {
  try {
    const { pin, username, password } = req.body;
    if (!pin || !username || !password) {
      return res.status(400).json({ success: false, message: 'PIN, username, dan password wajib diisi.' });
    }

    const user = await AppDatabase.authenticate(username, password);
    if (!user || (user.role !== 'guru' && user.role !== 'admin')) {
      return res.status(401).json({ success: false, message: 'Username atau password guru salah.' });
    }

    const room = roomManager.getRoom(pin);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room tidak ditemukan.' });
    }

    room.guruId = user.id;
    room.guruName = user.name;
    room.isAnonymous = false;

    const results = gameEngine.getGameResults(pin);
    const sessionId = uuidv4();
    await AppDatabase.saveGameSession({
      id: sessionId,
      pin: pin,
      guruId: user.id,
      guruName: user.name,
      title: room.title || 'Kuis Clash of Champion',
      totalQuestions: room.questions ? room.questions.length : (room.boxes ? room.boxes.length : 0),
      totalPlayers: room.players.size,
      results
    });

    log('info', 'Anonymous session retroactively claimed by teacher', { pin, guruId: user.id, guruName: user.name, sessionId });
    res.json({
      success: true,
      sessionId,
      message: `Berhasil menautkan dan menyimpan sesi kuis ke akun ${user.name}!`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/student/verify - Verify student NIS and password
 */
app.post('/api/student/verify', async (req, res) => {
  try {
    const { nis, password } = req.body;
    if (!nis || !password) {
      return res.status(400).json({ success: false, message: 'NIS dan Password wajib diisi.' });
    }
    const user = await AppDatabase.authenticate(nis, password);
    if (!user || user.role !== 'siswa') {
      return res.status(401).json({ success: false, message: 'NIS atau password salah!' });
    }
    res.json({
      success: true,
      student: {
        id: user.id,
        nis: user.username,
        name: user.name,
        class: user.extra?.class || 'Umum'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/student/history/:identifier - View past game history for student
 */
app.get('/api/student/history/:identifier', async (req, res) => {
  try {
    const records = await AppDatabase.getStudentRecordHistory(req.params.identifier);
    res.json({ success: true, records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========================================================
// SERVERLESS REST POLLING LAYER (OPTION 3 FOR VERCEL)
// ========================================================

async function ensureRoomLoaded(pin) {
  if (!pin) return null;
  const cleanPin = String(pin).trim();
  let room = roomManager.getRoom(cleanPin);
  if (room) return room;

  // Restore from Turso Cloud SQLite
  const dbRecord = await AppDatabase.getActiveRoom(cleanPin);
  if (!dbRecord || !dbRecord.roomData) return null;
  const d = dbRecord.roomData;

  room = {
    pin: cleanPin,
    adminToken: d.adminToken || dbRecord.adminToken,
    adminSocketId: d.adminSocketId || 'rest_admin',
    status: d.status || dbRecord.status || 'lobby',
    players: new Map(Object.entries(d.players || {})),
    questions: d.questions || [],
    boxes: d.boxes || [],
    maxPlayers: d.maxPlayers || 50,
    guruId: d.guruId || null,
    guruName: d.guruName || 'Guru Anonim',
    isAnonymous: d.isAnonymous !== undefined ? d.isAnonymous : true,
    title: d.title || 'Kuis Clash of Champion',
    config: d.config || { timePerQuestion: 30, globalTimeLimit: 0 },
    soloScore: d.soloScore || 0,
    globalEndTime: d.globalEndTime || null,
    recentEvents: d.recentEvents || []
  };

  if (room.questions && room.questions.length > 0) {
    room.questionMap = new Map();
    for (const q of room.questions) {
      if (q && q.id) room.questionMap.set(q.id, q);
    }
  }

  roomManager.rooms.set(cleanPin, room);
  return room;
}

async function syncRoomToDB(room, event = null) {
  if (!room) return;
  if (!room.recentEvents) room.recentEvents = [];
  if (event) {
    room.recentEvents.push({
      id: uuidv4(),
      type: event.type,
      data: event.data,
      timestamp: Date.now()
    });
    if (room.recentEvents.length > 60) {
      room.recentEvents = room.recentEvents.slice(-60);
    }
  }

  const serialized = {
    pin: room.pin,
    adminToken: room.adminToken,
    adminSocketId: room.adminSocketId,
    status: room.status,
    players: Object.fromEntries(room.players),
    questions: room.questions,
    boxes: room.boxes,
    maxPlayers: room.maxPlayers,
    guruId: room.guruId,
    guruName: room.guruName,
    isAnonymous: room.isAnonymous,
    title: room.title,
    config: room.config,
    soloScore: room.soloScore,
    globalEndTime: room.globalEndTime,
    recentEvents: room.recentEvents
  };

  try {
    await AppDatabase.saveActiveRoom(room.pin, room.adminToken, room.status, serialized);
  } catch (err) {
    console.error('[REST Sync Error]:', err.message);
  }
}

function sanitizeRoomForClient(room, playerId = null) {
  if (!room) return null;
  const players = Array.from(room.players.values()).map(p => ({
    id: p.id,
    nickname: p.nickname,
    avatar: p.avatar,
    studentIdentifier: p.studentIdentifier,
    score: p.score || 0,
    streak: p.streak || 0,
    accuracy: p.accuracy || 0,
    boxesTaken: p.boxesTaken || 0,
    connected: true
  }));

  const sanitizedBoxes = (room.boxes || []).map(b => ({
    index: b.index,
    points: b.points,
    isMystery: b.isMystery,
    status: b.status,
    lockedBy: b.lockedBy,
    lockedByName: b.lockedByName,
    answeredCorrectly: b.answeredCorrectly
  }));

  const leaderboard = gameEngine.getLeaderboard(room.pin);

  let activeQuestion = null;
  if (playerId && room.status === 'playing') {
    const lockedBox = (room.boxes || []).find(b => b.status === 'locked' && b.lockedBy === playerId);
    if (lockedBox) {
      const q = (room.questions || []).find(x => x.id === lockedBox.questionId);
      if (q) {
        activeQuestion = {
          boxIndex: lockedBox.index,
          points: lockedBox.points,
          timeLimit: room.config.timePerQuestion || 30,
          question: {
            text: q.text || q.question,
            type: q.type || 'mc',
            options: q.options || [],
            pairs: q.pairs || [],
            leftItems: q.leftItems || [],
            rightItems: q.rightItems || []
          }
        };
      }
    }
  }

  return {
    status: room.status,
    config: room.config,
    boxes: sanitizedBoxes,
    leaderboard,
    players,
    playerCount: players.length,
    globalEndTime: room.globalEndTime,
    soloScore: room.soloScore || 0,
    activeQuestion
  };
}

/**
 * POST /api/live/create-room - Serverless Room Creation
 */
app.post('/api/live/create-room', async (req, res) => {
  try {
    const meta = req.body || {};
    const { pin, room, adminToken } = roomManager.createRoom('rest_admin', meta.maxPlayers || 50, meta);
    await syncRoomToDB(room, {
      type: 'room-created',
      data: {
        pin,
        adminToken,
        isAnonymous: room.isAnonymous,
        guruName: room.guruName,
        guruId: room.guruId
      }
    });
    res.json({
      success: true,
      pin,
      adminToken,
      isAnonymous: room.isAnonymous,
      guruName: room.guruName,
      roomState: sanitizeRoomForClient(room)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/live/join-room - Serverless Player Join
 */
app.post('/api/live/join-room', async (req, res) => {
  try {
    const { pin, nickname, avatar, studentId, studentIdentifier, isAnonymous } = req.body;
    const room = await ensureRoomLoaded(pin);
    if (!room) return res.status(404).json({ success: false, message: 'Room tidak ditemukan' });
    if (room.status !== 'lobby') return res.status(400).json({ success: false, message: 'Game sudah dimulai atau selesai' });

    const playerId = uuidv4();
    const player = {
      id: playerId,
      nickname: (nickname || 'Pemain').trim().substring(0, 25),
      avatar: avatar || '🦁',
      studentId: studentId || null,
      studentIdentifier: studentIdentifier || nickname,
      isAnonymous: Boolean(isAnonymous),
      score: 0,
      streak: 0,
      maxStreak: 0,
      answers: [],
      boxesTaken: 0,
      connected: true,
      joinedAt: Date.now()
    };
    room.players.set(playerId, player);
    await syncRoomToDB(room, {
      type: 'player-joined',
      data: {
        player,
        playerCount: room.players.size,
        players: Array.from(room.players.values())
      }
    });
    res.json({ success: true, playerId, pin, player });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/live/action - Serverless Game Action Dispatcher
 */
app.post('/api/live/action', async (req, res) => {
  try {
    const { action, pin, ...payload } = req.body;
    const room = await ensureRoomLoaded(pin);
    if (!room) return res.status(404).json({ success: false, message: 'Room tidak ditemukan' });

    let actionResult = { success: true };

    switch (action) {
      case 'update-config': {
        if (payload.config) room.config = { ...room.config, ...payload.config };
        await syncRoomToDB(room, { type: 'config-updated', data: { config: room.config } });
        break;
      }
      case 'update-questions': {
        if (Array.isArray(payload.questions)) {
          room.questions = payload.questions;
          room.questionMap = new Map();
          for (const q of room.questions) {
            if (q) {
              if (!q.id) q.id = uuidv4();
              room.questionMap.set(q.id, q);
            }
          }
        }
        await syncRoomToDB(room, { type: 'questions-updated', data: { count: room.questions.length } });
        break;
      }
      case 'start-game': {
        if (payload.config) room.config = { ...room.config, ...payload.config };
        if (Array.isArray(payload.questions) && payload.questions.length > 0) {
          room.questions = payload.questions;
        }
        const sanitizedBoxes = gameEngine.startGame(room.pin, room.adminSocketId, payload.config);
        await syncRoomToDB(room, {
          type: 'game-started',
          data: {
            boxes: sanitizedBoxes,
            globalEndTime: room.globalEndTime,
            globalTimeLimit: room.config.globalTimeLimit
          }
        });
        actionResult.boxes = sanitizedBoxes;
        break;
      }
      case 'pause-game': {
        gameEngine.pauseGame(room.pin);
        await syncRoomToDB(room, { type: 'game-paused', data: {} });
        break;
      }
      case 'resume-game': {
        gameEngine.resumeGame(room.pin);
        await syncRoomToDB(room, { type: 'game-resumed', data: {} });
        break;
      }
      case 'end-game': {
        const results = gameEngine.endGame(room.pin);
        await syncRoomToDB(room, { type: 'game-ended', data: results });
        actionResult.results = results;
        break;
      }
      case 'claim-box': {
        const claimResult = gameEngine.claimBox(room.pin, payload.playerId, payload.boxIndex);
        if (claimResult.success) {
          const player = room.players.get(payload.playerId);
          const box = (room.boxes || [])[payload.boxIndex];
          const question = (room.questionMap && box) ? room.questionMap.get(box.questionId) : (room.questions || [])[payload.boxIndex];
          const safeQuestion = question ? gameEngine.getQuestionForPlayer(question) : null;

          await syncRoomToDB(room, {
            type: 'box-claimed',
            data: {
              boxIndex: payload.boxIndex,
              playerId: payload.playerId,
              playerName: player ? player.nickname : 'Pemain'
            }
          });

          actionResult = {
            success: true,
            boxIndex: payload.boxIndex,
            question: safeQuestion,
            points: (claimResult.originalPoints !== undefined) ? claimResult.originalPoints : (box ? box.points : 100),
            isMystery: box ? Boolean(box.isMystery) : false,
            timeLimit: room.config.timePerQuestion || 30
          };
        } else {
          actionResult = claimResult;
        }
        break;
      }
      case 'submit-answer': {
        const ansResult = gameEngine.submitAnswer(room.pin, payload.playerId, payload.boxIndex, payload.answer, payload.timeRemaining);
        await syncRoomToDB(room, {
          type: 'box-unlocked',
          data: {
            boxIndex: payload.boxIndex,
            answeredCorrectly: ansResult.correct,
            points: ansResult.pointsAwarded || 0,
            status: ansResult.correct ? 'completed' : 'available'
          }
        });
        await syncRoomToDB(room, {
          type: 'leaderboard-updated',
          data: { leaderboard: gameEngine.getLeaderboard(room.pin) }
        });
        actionResult = ansResult;
        break;
      }
      case 'send-emote': {
        const p = room.players.get(payload.playerId);
        await syncRoomToDB(room, {
          type: 'emote-received',
          data: {
            playerId: payload.playerId,
            nickname: p ? p.nickname : 'Pemain',
            avatar: p ? p.avatar : '🦁',
            emote: payload.emote
          }
        });
        break;
      }
      case 'admin-claim-box': {
        let adminClaim = gameEngine.adminClaimBox(room.pin, payload.boxIndex);
        if (!adminClaim || !adminClaim.success) {
          // Fallback if room not in 'playing' yet or box index direct preview
          const box = (room.boxes || [])[payload.boxIndex];
          const question = (room.questionMap && box)
            ? room.questionMap.get(box.questionId)
            : (room.questions || [])[payload.boxIndex];
          if (question) {
            adminClaim = {
              success: true,
              alreadyCompleted: false,
              box: box ? gameEngine._sanitizeBoxForClient(box) : { index: payload.boxIndex, points: question.points || 100 },
              question: { ...question }
            };
          }
        }

        if (adminClaim && adminClaim.success) {
          await syncRoomToDB(room, {
            type: 'box-claimed',
            data: {
              boxIndex: payload.boxIndex,
              playerId: 'admin',
              playerName: 'Guru (Layar Utama)'
            }
          });

          actionResult = {
            success: true,
            boxIndex: payload.boxIndex,
            box: adminClaim.box,
            points: (adminClaim.box && adminClaim.box.points) ? adminClaim.box.points : 100,
            question: adminClaim.question,
            alreadyCompleted: Boolean(adminClaim.alreadyCompleted),
            timeLimit: room.config.timePerQuestion || 30
          };
        } else {
          actionResult = adminClaim || { success: false, reason: 'Soal tidak ditemukan' };
        }
        break;
      }
      case 'admin-complete-box': {
        const completeResult = gameEngine.adminCompleteBox(room.pin, payload.boxIndex, payload.isCorrect, payload.customPoints);
        await syncRoomToDB(room, {
          type: 'box-unlocked',
          data: {
            boxIndex: payload.boxIndex,
            answeredCorrectly: payload.isCorrect,
            status: 'completed'
          }
        });
        actionResult = completeResult;
        break;
      }
      case 'admin-release-box': {
        gameEngine.adminReleaseBox(room.pin, payload.boxIndex);
        await syncRoomToDB(room, {
          type: 'box-unlocked',
          data: {
            boxIndex: payload.boxIndex,
            status: 'available'
          }
        });
        break;
      }
      case 'kick-player': {
        room.players.delete(payload.playerId);
        await syncRoomToDB(room, {
          type: 'player-left',
          data: {
            playerId: payload.playerId,
            playerCount: room.players.size,
            players: Array.from(room.players.values())
          }
        });
        break;
      }
      case 'reconnect-attempt': {
        actionResult = {
          success: true,
          pin: room.pin,
          adminToken: room.adminToken,
          roomState: sanitizeRoomForClient(room, payload.playerId)
        };
        break;
      }
      default: {
        return res.status(400).json({ success: false, message: `Unknown action: ${action}` });
      }
    }

    res.json(actionResult);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/live/poll - Realtime State Polling for Clients
 */
app.get('/api/live/poll', async (req, res) => {
  try {
    const pin = String(req.query.pin || '').trim();
    const since = parseInt(req.query.since) || 0;
    const playerId = req.query.playerId || null;
    const room = await ensureRoomLoaded(pin);
    if (!room) return res.status(404).json({ success: false, message: 'Room tidak ditemukan' });

    const events = (room.recentEvents || []).filter(e => e.timestamp > since);
    res.json({
      success: true,
      pin: room.pin,
      status: room.status,
      roomState: sanitizeRoomForClient(room, playerId),
      events,
      timestamp: Date.now()
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

io.on('connection', (socket) => {
  log('info', 'Socket connected', { socketId: socket.id });

  socket.on('create-room', (meta = {}) => {
    try {
      const { pin, room, adminToken } = roomManager.createRoom(socket.id, 50, meta);
      socket.join(pin);
      socket.emit('room-created', { 
        timestamp: Date.now(), 
        pin, 
        adminToken: room.adminToken,
        isAnonymous: room.isAnonymous,
        guruName: room.guruName,
        guruId: room.guruId
      });
      log('info', 'Room created', { pin, adminSocketId: socket.id, adminToken: room.adminToken, guruName: room.guruName, isAnonymous: room.isAnonymous });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('update-config', ({ pin, config }) => {
    try {
      const cleanPin = (pin || '').toString().trim();
      const room = roomManager.getRoom(cleanPin);
      if (!room) throw new Error('Room not found');
      if (room.adminSocketId !== socket.id) throw new Error('Unauthorized');
      
      room.config = { ...room.config, ...config };
      io.to(cleanPin).emit('config-updated', { timestamp: Date.now(), config: room.config });
      socket.emit('config-updated', { timestamp: Date.now(), config: room.config });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('add-question', ({ pin, question }) => {
    try {
      const room = roomManager.getRoom(pin);
      if (!room) throw new Error('Room not found');
      if (room.adminSocketId !== socket.id) throw new Error('Unauthorized: Admin only');
      
      if (!question.id) question.id = uuidv4();
      room.questions.push(question);
      socket.emit('questions-updated', { timestamp: Date.now(), count: room.questions.length });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('update-questions', ({ pin, questions }) => {
    try {
      const cleanPin = (pin || '').toString().trim();
      const room = roomManager.getRoom(cleanPin);
      if (!room) throw new Error('Room not found');
      if (room.adminSocketId !== socket.id) throw new Error('Unauthorized: Admin only');
      
      room.questions = questions;
      socket.emit('questions-updated', { timestamp: Date.now(), count: room.questions.length });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('start-game', ({ pin, config, questions }) => {
    try {
      const cleanPin = (pin || '').toString().trim();
      const room = roomManager.getRoom(cleanPin);
      if (!room) throw new Error('Room not found');
      if (room.adminSocketId !== socket.id) throw new Error('Unauthorized');
      if (questions && Array.isArray(questions) && questions.length > 0) {
        room.questions = questions;
      }
      if (config && typeof config === 'object') {
        room.config = { ...room.config, ...config };
      }
      const boxes = gameEngine.startGame(cleanPin, socket.id, config);
      io.to(cleanPin).emit('game-started', { 
        timestamp: Date.now(), 
        boxes,
        config: room.config,
        globalTimeLimit: room.config.globalTimeLimit || 0,
        globalEndTime: room.globalEndTime || null
      });

      // Send detailed inspection data directly to admin/teacher socket
      socket.emit('admin-inspection-data', {
        timestamp: Date.now(),
        boxes: gameEngine.getAdminBoxesInspection(cleanPin)
      });

      log('info', 'Game started', { pin: cleanPin, config: room.config });
    } catch (error) {
      log('error', 'Error starting game', { error: error.message });
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('admin-get-inspection', ({ pin }) => {
    try {
      const cleanPin = (pin || '').toString().trim();
      const room = roomManager.getRoom(cleanPin);
      if (!room || room.adminSocketId !== socket.id) return;
      socket.emit('admin-inspection-data', {
        timestamp: Date.now(),
        boxes: gameEngine.getAdminBoxesInspection(cleanPin)
      });
    } catch (e) {
      log('error', 'Error in admin-get-inspection', { error: e.message });
    }
  });

  socket.on('pause-game', ({ pin }) => {
    try {
      const cleanPin = (pin || '').toString().trim();
      const room = roomManager.getRoom(cleanPin);
      if (!room || room.adminSocketId !== socket.id) throw new Error('Unauthorized');
      
      gameEngine.pauseGame(cleanPin);
      io.to(cleanPin).emit('game-paused', { timestamp: Date.now() });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('resume-game', ({ pin }) => {
    try {
      const cleanPin = (pin || '').toString().trim();
      const room = roomManager.getRoom(cleanPin);
      if (!room || room.adminSocketId !== socket.id) throw new Error('Unauthorized');
      
      gameEngine.resumeGame(cleanPin);
      io.to(cleanPin).emit('game-resumed', { 
        timestamp: Date.now(),
        globalEndTime: room.globalEndTime || null
      });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('extend-time', ({ pin, extraSeconds = 30 }) => {
    try {
      const cleanPin = (pin || '').toString().trim();
      const room = roomManager.getRoom(cleanPin);
      if (!room || room.adminSocketId !== socket.id) throw new Error('Unauthorized');
      
      gameEngine.extendTime(cleanPin, extraSeconds);
      log('info', 'Game time extended by teacher', { pin: cleanPin, extraSeconds });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('void-box', ({ pin, boxIndex }) => {
    try {
      const cleanPin = (pin || '').toString().trim();
      const room = roomManager.getRoom(cleanPin);
      if (!room || room.adminSocketId !== socket.id) throw new Error('Unauthorized');
      
      gameEngine.voidBox(cleanPin, boxIndex);
      log('info', 'Box voided by teacher emergency control', { pin: cleanPin, boxIndex });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Teacher/Admin direct box operation (Solo mode or live presentation)
  socket.on('admin-claim-box', ({ pin, boxIndex }) => {
    try {
      const cleanPin = (pin || '').toString().trim();
      const room = roomManager.getRoom(cleanPin);
      if (!room || room.adminSocketId !== socket.id) throw new Error('Unauthorized: Hanya guru/admin');
      
      const result = gameEngine.adminClaimBox(cleanPin, boxIndex);
      if (result.success) {
        if (!result.alreadyCompleted) {
          io.to(cleanPin).emit('box-claimed', {
            timestamp: Date.now(),
            boxIndex,
            playerId: 'admin',
            playerName: 'Guru (Layar Utama)',
            box: result.box
          });
        }
        socket.emit('admin-box-opened', {
          timestamp: Date.now(),
          boxIndex,
          box: result.box,
          points: (result.box && result.box.points) ? result.box.points : 100,
          question: result.question,
          alreadyCompleted: result.alreadyCompleted || false,
          timeLimit: room.config.timePerQuestion || 30
        });
        log('info', 'Box claimed and opened by teacher', { pin: cleanPin, boxIndex });
      } else {
        socket.emit('error', { message: result.reason || 'Gagal membuka kotak' });
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('admin-complete-box', ({ pin, boxIndex, correct, points }) => {
    try {
      const cleanPin = (pin || '').toString().trim();
      const room = roomManager.getRoom(cleanPin);
      if (!room || room.adminSocketId !== socket.id) throw new Error('Unauthorized: Hanya guru/admin');

      const result = gameEngine.adminCompleteBox(cleanPin, boxIndex, correct, points);
      if (result.success) {
        io.to(cleanPin).emit('box-completed', {
          timestamp: Date.now(),
          boxIndex,
          correct: result.correct,
          points: result.points,
          soloScore: result.soloScore
        });
        socket.emit('admin-box-completed', {
          timestamp: Date.now(),
          boxIndex,
          correct: result.correct,
          points: result.points,
          soloScore: result.soloScore,
          isGameOver: result.isGameOver
        });
        socket.emit('admin-inspection-data', {
          timestamp: Date.now(),
          boxes: gameEngine.getAdminBoxesInspection(cleanPin)
        });
        log('info', 'Box completed by teacher operation', { pin: cleanPin, boxIndex, correct: result.correct, points: result.points });
      } else {
        socket.emit('error', { message: result.reason || 'Gagal menyelesaikan kotak' });
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('admin-release-box', ({ pin, boxIndex }) => {
    try {
      const cleanPin = (pin || '').toString().trim();
      const room = roomManager.getRoom(cleanPin);
      if (!room || room.adminSocketId !== socket.id) throw new Error('Unauthorized: Hanya guru/admin');

      const result = gameEngine.adminReleaseBox(cleanPin, boxIndex);
      if (result.success) {
        io.to(cleanPin).emit('box-released', {
          timestamp: Date.now(),
          boxIndex,
          reason: 'Dibatalkan oleh Guru'
        });
        socket.emit('admin-inspection-data', {
          timestamp: Date.now(),
          boxes: gameEngine.getAdminBoxesInspection(cleanPin)
        });
        log('info', 'Box released by teacher', { pin: cleanPin, boxIndex });
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('end-game', ({ pin }) => {
    try {
      const cleanPin = (pin || '').toString().trim();
      const room = roomManager.getRoom(cleanPin);
      if (!room || room.adminSocketId !== socket.id) throw new Error('Unauthorized');
      
      gameEngine.endGame(cleanPin);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('join-room', ({ pin, nickname, avatar, studentId, studentIdentifier, isAnonymous }) => {
    try {
      let targetPin = pin;
      if (!targetPin) {
        // Auto-detect active room for registered students
        for (const [rPin, rObj] of roomManager.rooms.entries()) {
          if (rObj.status === 'lobby' || rObj.status === 'playing') {
            targetPin = rPin;
            break;
          }
        }
      }
      if (!targetPin) {
        throw new Error('Belum ada kuis yang sedang aktif saat ini. Tunggu guru membuka room.');
      }
      const extra = { studentId, studentIdentifier, isAnonymous };
      const { player, room } = roomManager.joinRoom(targetPin, socket.id, nickname, avatar, extra);
      socket.join(targetPin);
      
      const playerList = roomManager.getPlayerList(targetPin);
      const mappedPlayers = playerList.map(p => ({
        id: p.id,
        nickname: p.nickname,
        avatar: p.avatar,
        studentIdentifier: p.studentIdentifier
      }));

      socket.emit('join-success', { 
        timestamp: Date.now(), 
        playerId: player.id,
        pin: targetPin,
        roomState: {
          config: room.config,
          playerCount: room.players.size,
          status: room.status,
          players: mappedPlayers,
          globalTimeLimit: room.config.globalTimeLimit || 0,
          globalEndTime: room.globalEndTime || null,
          boxes: room.status === 'playing' ? gameEngine._sanitizeBoxesForClient(room.boxes) : []
        }
      });
      
      io.to(targetPin).emit('player-joined', { 
        timestamp: Date.now(), 
        playerCount: room.players.size,
        players: mappedPlayers,
        player: {
          id: player.id,
          nickname: player.nickname,
          avatar: player.avatar,
          studentIdentifier: player.studentIdentifier
        }
      });
      log('info', 'Player joined', { nickname, pin: targetPin, studentId: player.studentId });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('kick-player', ({ pin, playerId }) => {
    try {
      const room = roomManager.getRoom(pin);
      if (!room || room.adminSocketId !== socket.id) {
        throw new Error('Unauthorized: Hanya guru/admin yang dapat mengeluarkan pemain');
      }

      const kickInfo = roomManager.kickPlayer(pin, playerId);
      if (kickInfo) {
        const { player, socketId } = kickInfo;
        const targetSocket = io.sockets.sockets.get(socketId);
        if (targetSocket) {
          targetSocket.emit('kicked', { message: 'Anda telah dikeluarkan dari kuis oleh Guru.' });
          targetSocket.leave(pin);
        }

        io.to(pin).emit('player-kicked', {
          timestamp: Date.now(),
          playerId,
          nickname: player.nickname,
          playerCount: room.players.size
        });

        io.to(pin).emit('player-left', {
          timestamp: Date.now(),
          playerId,
          nickname: player.nickname
        });

        log('info', 'Player kicked by admin', { pin, playerId, nickname: player.nickname });
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('claim-box', ({ pin, boxIndex }) => {
    try {
      const cleanPin = (pin || '').toString().trim();
      const playerInfo = roomManager.getPlayerBySocket(socket.id);
      if (!playerInfo || (playerInfo.pin || '').toString().trim() !== cleanPin) throw new Error('Player not found in this room');
      
      const { playerId } = playerInfo;
      const room = roomManager.getRoom(cleanPin);
      if (!room) throw new Error('Room not found');
      
      const now = Date.now();
      const lastClaim = claimBoxLimits.get(socket.id);
      if (lastClaim && now - lastClaim < 500) {
        socket.emit('box-already-taken', {
          timestamp: Date.now(),
          boxIndex,
          reason: 'Tunggu sebentar sebelum memilih soal lagi'
        });
        return;
      }
      claimBoxLimits.set(socket.id, now);

      const result = gameEngine.claimBox(cleanPin, playerId, boxIndex);
      
      if (result.success) {
        io.to(cleanPin).emit('box-claimed', {
          timestamp: Date.now(),
          boxIndex: boxIndex,
          playerId: playerId,
          playerName: result.box.lockedByName,
          playerAvatar: playerInfo.player.avatar
        });

        const question = room.questionMap.get(result.box.questionId);
        const safeQuestion = gameEngine.getQuestionForPlayer(question);
        
        socket.emit('question-data', {
          timestamp: Date.now(),
          boxIndex: boxIndex,
          question: safeQuestion,
          timeLimit: room.config.timePerQuestion,
          points: (result.originalPoints !== undefined) ? result.originalPoints : result.box.points,
          isMystery: Boolean(result.isMystery || result.box.isMystery)
        });

        if (room.adminSocketId) {
          io.to(room.adminSocketId).emit('admin-inspection-data', {
            timestamp: Date.now(),
            boxes: gameEngine.getAdminBoxesInspection(cleanPin)
          });
        }
      } else {
        socket.emit('box-already-taken', {
          timestamp: Date.now(),
          boxIndex: boxIndex,
          reason: result.reason
        });
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('submit-answer', ({ pin, boxIndex, answer }) => {
    try {
      const cleanPin = (pin || '').toString().trim();
      const playerInfo = roomManager.getPlayerBySocket(socket.id);
      if (!playerInfo || (playerInfo.pin || '').toString().trim() !== cleanPin) throw new Error('Player not found');
      
      const { playerId } = playerInfo;
      const room = roomManager.getRoom(cleanPin);
      const result = gameEngine.submitAnswer(cleanPin, playerId, boxIndex, answer);
      
      socket.emit('answer-result', {
        timestamp: Date.now(),
        boxIndex,
        ...result
      });

      const currentBox = room && room.boxes ? room.boxes[boxIndex] : null;
      io.to(cleanPin).emit('box-completed', {
        timestamp: Date.now(),
        boxIndex,
        completedBy: playerId,
        correct: result.correct,
        points: currentBox ? currentBox.points : result.points,
        box: currentBox ? gameEngine._sanitizeBoxForClient(currentBox) : null
      });

      if (room && room.adminSocketId) {
        io.to(room.adminSocketId).emit('admin-inspection-data', {
          timestamp: Date.now(),
          boxes: gameEngine.getAdminBoxesInspection(cleanPin)
        });
      }

      scheduleLeaderboardBroadcast(cleanPin);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('send-emote', ({ pin, emote }) => {
    try {
      const cleanPin = (pin || '').toString().trim();
      const now = Date.now();
      const lastEmote = emoteRateLimits.get(socket.id);
      if (lastEmote && now - lastEmote < 2000) return;
      emoteRateLimits.set(socket.id, now);

      const playerInfo = roomManager.getPlayerBySocket(socket.id);
      if (!playerInfo || (playerInfo.pin || '').toString().trim() !== cleanPin) return;

      const { playerId, player } = playerInfo;

      io.to(cleanPin).emit('emote-received', {
        timestamp: Date.now(),
        playerId,
        nickname: player.nickname,
        avatar: player.avatar,
        emote
      });
    } catch (error) {
      // Ignore emote errors silently
    }
  });

  socket.on('get-game-state', ({ pin }) => {
    try {
      const room = roomManager.getRoom(pin);
      if (!room) throw new Error('Room not found');

      let isPlayer = false;
      let playerState = null;
      const playerInfo = roomManager.getPlayerBySocket(socket.id);
      if (playerInfo && playerInfo.pin === pin) {
        isPlayer = true;
        playerState = {
          score: playerInfo.player.score,
          streak: playerInfo.player.streak
        };
      } else if (room.adminSocketId !== socket.id) {
        throw new Error('Unauthorized');
      }

      const playerList = roomManager.getPlayerList(pin);
      socket.emit('game-state', {
        timestamp: Date.now(),
        roomState: {
          status: room.status,
          config: room.config,
          boxes: gameEngine._sanitizeBoxesForClient(room.boxes),
          leaderboard: gameEngine.getLeaderboard(pin),
          playerStats: playerState,
          playerCount: room.players.size,
          players: playerList.map(p => ({
            id: p.id,
            nickname: p.nickname,
            avatar: p.avatar,
            studentIdentifier: p.studentIdentifier
          })),
          globalTimeLimit: room.config.globalTimeLimit || 0,
          globalEndTime: room.globalEndTime || null
        }
      });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('disconnect', () => {
    log('info', 'Socket disconnected', { socketId: socket.id });
    
    emoteRateLimits.delete(socket.id);
    claimBoxLimits.delete(socket.id);

    const removalInfo = roomManager.removePlayer(socket.id);
    
    if (removalInfo) {
      const { pin, player, isAdmin } = removalInfo;
      
      if (isAdmin) {
        log('info', 'Admin disconnected', { pin });
        const timeoutId = setTimeout(() => {
          adminDisconnects.delete(pin);
        }, 120000);
        adminDisconnects.set(pin, { timeoutId, adminSocketId: socket.id });
      } else if (player) {
        gameEngine.handlePlayerDisconnect(pin, player.id);
        io.to(pin).emit('player-disconnected', {
          timestamp: Date.now(),
          playerId: player.id,
          nickname: player.nickname
        });
      }
    }
  });

  socket.on('reconnect-attempt', ({ pin, playerId, adminToken }) => {
    try {
      const cleanPin = (pin || '').toString().trim();
      if (playerId === 'admin') {
        const room = roomManager.getRoom(cleanPin);
        if (room) {
          if (!adminToken || !room.adminToken || adminToken !== room.adminToken) {
            throw new Error('Token otorisasi admin tidak valid atau tidak disertakan');
          }
          // Clear disconnect timeout if reconnect occurs within grace period
          if (adminDisconnects.has(cleanPin)) {
            clearTimeout(adminDisconnects.get(cleanPin).timeoutId);
            adminDisconnects.delete(cleanPin);
          }
          roomManager.reconnectAdmin(cleanPin, adminToken, socket.id);
          socket.join(cleanPin);
          const playerList = roomManager.getPlayerList(cleanPin);
          socket.emit('reconnect-success', {
            timestamp: Date.now(),
            pin: cleanPin,
            adminToken: room.adminToken,
            roomState: {
              status: room.status,
              config: room.config,
              boxes: gameEngine._sanitizeBoxesForClient(room.boxes),
              leaderboard: gameEngine.getLeaderboard(pin),
              playerCount: room.players.size,
              players: playerList.map(p => ({
                id: p.id,
                nickname: p.nickname,
                avatar: p.avatar,
                studentIdentifier: p.studentIdentifier
              })),
              globalTimeLimit: room.config.globalTimeLimit || 0,
              globalEndTime: room.globalEndTime || null
            }
          });
          log('info', 'Admin reconnected via secure lease token', { pin });
          return;
        }
        throw new Error('Room tidak ditemukan atau telah berakhir');
      }

      // Player reconnect
      const { player, room } = roomManager.reconnectPlayer(cleanPin, playerId, socket.id);
      socket.join(cleanPin);

      const playerList = roomManager.getPlayerList(cleanPin);
      socket.emit('reconnect-success', {
        timestamp: Date.now(),
        roomState: {
          status: room.status,
          config: room.config,
          boxes: gameEngine._sanitizeBoxesForClient(room.boxes),
          leaderboard: gameEngine.getLeaderboard(cleanPin),
          playerCount: room.players.size,
          players: playerList.map(p => ({
            id: p.id,
            nickname: p.nickname,
            avatar: p.avatar,
            studentIdentifier: p.studentIdentifier
          })),
          globalTimeLimit: room.config.globalTimeLimit || 0,
          globalEndTime: room.globalEndTime || null,
          playerStats: {
            score: player.score,
            streak: player.streak
          }
        }
      });
      
      const mappedPlayers = playerList.map(p => ({
        id: p.id,
        nickname: p.nickname,
        avatar: p.avatar,
        studentIdentifier: p.studentIdentifier
      }));

      io.to(cleanPin).emit('player-reconnected', {
        timestamp: Date.now(),
        playerId: player.id,
        nickname: player.nickname,
        avatar: player.avatar,
        player: {
          id: player.id,
          nickname: player.nickname,
          avatar: player.avatar,
          studentIdentifier: player.studentIdentifier
        },
        playerCount: room.players.size,
        players: mappedPlayers
      });
      log('info', 'Player reconnected', { nickname: player.nickname, pin: cleanPin });
    } catch (error) {
      log('error', 'Reconnect failed', { error: error.message });
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('check-room-status', ({ pin, playerId }) => {
    try {
      const cleanPin = (pin || '').toString().trim();
      const room = roomManager.getRoom(cleanPin);
      if (!room) {
        socket.emit('room-status-response', { exists: false });
        return;
      }

      // Re-affirm socket room membership
      socket.join(cleanPin);

      socket.emit('room-status-response', {
        exists: true,
        status: room.status,
        boxes: room.status === 'playing' ? gameEngine._sanitizeBoxesForClient(room.boxes) : [],
        globalEndTime: room.globalEndTime || null,
        globalTimeLimit: room.config?.globalTimeLimit || 0
      });
    } catch (e) {
      // ignore
    }
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

if (!process.env.VERCEL) {
  server.listen(PORT, HOST, () => {
    log('info', `Clash of Champion server running on http://${HOST}:${PORT}`);
  });

  // Graceful shutdown handling for non-serverless environments
  function handleGracefulShutdown(signal) {
    log('info', `Received ${signal}, closing server gracefully...`);
    server.close(() => {
      log('info', 'HTTP & WebSocket server closed.');
      try {
        AppDatabase.close();
        log('info', 'Database connection closed.');
      } catch (e) {}
      process.exit(0);
    });
    
    setTimeout(() => {
      log('error', 'Force shutdown after timeout');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
}

module.exports = (req, res) => {
  server.emit('request', req, res);
};
