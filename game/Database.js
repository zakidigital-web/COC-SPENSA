const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Load environment variables if present
try {
  require('dotenv').config();
} catch (e) {}

// PBKDF2 Password Hashing & Verification
function hashPassword(pass, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  const derived = crypto.pbkdf2Sync(String(pass), salt, 10000, 32, 'sha256').toString('hex');
  return `${salt}$${derived}`;
}

function verifyPassword(pass, storedHash) {
  if (!storedHash) return false;
  if (!storedHash.includes('$')) {
    const legacy = crypto.createHash('sha256').update(String(pass)).digest('hex');
    return legacy === storedHash;
  }
  const [salt, hash] = storedHash.split('$');
  const derived = crypto.pbkdf2Sync(String(pass), salt, 10000, 32, 'sha256').toString('hex');
  return derived === hash;
}

// Check Turso Configuration
const isTurso = Boolean(process.env.TURSO_DATABASE_URL);
let tursoClient = null;

if (isTurso) {
  const { createClient } = require('@libsql/client');
  tursoClient = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
  });
  console.log('[DB] Connected to Turso Cloud SQLite:', process.env.TURSO_DATABASE_URL);
}

// Fallback JSON Store (if Turso is not configured)
const localFallbackFile = process.env.VERCEL
  ? path.join('/tmp', 'clash_store.json')
  : path.join(__dirname, '..', 'data', 'clash_store.json');

function getFallbackStore() {
  try {
    if (fs.existsSync(localFallbackFile)) {
      return JSON.parse(fs.readFileSync(localFallbackFile, 'utf8'));
    }
  } catch (e) {}
  const store = {
    users: [
      { id: 1, username: 'admin', password: hashPassword('admin123'), role: 'admin', name: 'Administrator Utama', extra: { roleDesc: 'Super Admin' }, created_at: new Date().toISOString() },
      { id: 2, username: 'guru', password: hashPassword('guru123'), role: 'guru', name: 'Ibu Guru Sarah, S.Pd', extra: { nip: '198501152010012001', subject: 'Ilmu Pengetahuan Alam' }, created_at: new Date().toISOString() },
      { id: 3, username: '1001', password: hashPassword('123'), role: 'siswa', name: 'Ahmad Dani', extra: { nis: '1001', class: '7-A' }, created_at: new Date().toISOString() },
      { id: 4, username: '1002', password: hashPassword('123'), role: 'siswa', name: 'Budi Santoso', extra: { nis: '1002', class: '7-A' }, created_at: new Date().toISOString() },
      { id: 5, username: '1003', password: hashPassword('123'), role: 'siswa', name: 'Citra Lestari', extra: { nis: '1003', class: '7-A' }, created_at: new Date().toISOString() },
      { id: 6, username: '1004', password: hashPassword('123'), role: 'siswa', name: 'Dewi Anggraini', extra: { nis: '1004', class: '7-B' }, created_at: new Date().toISOString() },
      { id: 7, username: '1005', password: hashPassword('123'), role: 'siswa', name: 'Eko Prasetyo', extra: { nis: '1005', class: '7-B' }, created_at: new Date().toISOString() }
    ],
    game_sessions: [],
    student_records: [],
    question_banks: []
  };
  try {
    const dir = path.dirname(localFallbackFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(localFallbackFile, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {}
  return store;
}

function saveFallbackStore(store) {
  try {
    const dir = path.dirname(localFallbackFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(localFallbackFile, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {}
}

class AppDatabase {
  // Ensure tables and seed data exist
  static async init() {
    if (!isTurso || !tursoClient) return;

    try {
      await tursoClient.batch([
        `CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          role TEXT NOT NULL,
          name TEXT NOT NULL,
          extra TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS game_sessions (
          id TEXT PRIMARY KEY,
          pin TEXT NOT NULL,
          guru_id INTEGER,
          guru_name TEXT,
          title TEXT,
          total_questions INTEGER DEFAULT 0,
          total_players INTEGER DEFAULT 0,
          results_json TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (guru_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
        `CREATE TABLE IF NOT EXISTS student_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          game_session_id TEXT NOT NULL,
          student_id INTEGER,
          student_identifier TEXT,
          student_name TEXT NOT NULL,
          score INTEGER DEFAULT 0,
          rank INTEGER DEFAULT 0,
          accuracy REAL DEFAULT 0,
          max_streak INTEGER DEFAULT 0,
          boxes_taken INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (game_session_id) REFERENCES game_sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
        `CREATE TABLE IF NOT EXISTS question_banks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guru_id INTEGER,
          title TEXT NOT NULL,
          questions_json TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (guru_id) REFERENCES users(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS active_rooms (
          pin TEXT PRIMARY KEY,
          admin_token TEXT NOT NULL,
          status TEXT DEFAULT 'waiting',
          room_data TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`
      ]);

      const countRes = await tursoClient.execute('SELECT COUNT(*) as count FROM users');
      const count = Number(countRes.rows[0].count);
      if (count === 0) {
        await tursoClient.batch([
          {
            sql: 'INSERT INTO users (username, password, role, name, extra) VALUES (?, ?, ?, ?, ?)',
            args: ['admin', hashPassword('admin123'), 'admin', 'Administrator Utama', JSON.stringify({ roleDesc: 'Super Admin' })]
          },
          {
            sql: 'INSERT INTO users (username, password, role, name, extra) VALUES (?, ?, ?, ?, ?)',
            args: ['guru', hashPassword('guru123'), 'guru', 'Ibu Guru Sarah, S.Pd', JSON.stringify({ nip: '198501152010012001', subject: 'Ilmu Pengetahuan Alam' })]
          },
          {
            sql: 'INSERT INTO users (username, password, role, name, extra) VALUES (?, ?, ?, ?, ?)',
            args: ['1001', hashPassword('123'), 'siswa', 'Ahmad Dani', JSON.stringify({ nis: '1001', class: '7-A' })]
          },
          {
            sql: 'INSERT INTO users (username, password, role, name, extra) VALUES (?, ?, ?, ?, ?)',
            args: ['1002', hashPassword('123'), 'siswa', 'Budi Santoso', JSON.stringify({ nis: '1002', class: '7-A' })]
          },
          {
            sql: 'INSERT INTO users (username, password, role, name, extra) VALUES (?, ?, ?, ?, ?)',
            args: ['1003', hashPassword('123'), 'siswa', 'Citra Lestari', JSON.stringify({ nis: '1003', class: '7-A' })]
          },
          {
            sql: 'INSERT INTO users (username, password, role, name, extra) VALUES (?, ?, ?, ?, ?)',
            args: ['1004', hashPassword('123'), 'siswa', 'Dewi Anggraini', JSON.stringify({ nis: '1004', class: '7-B' })]
          },
          {
            sql: 'INSERT INTO users (username, password, role, name, extra) VALUES (?, ?, ?, ?, ?)',
            args: ['1005', hashPassword('123'), 'siswa', 'Eko Prasetyo', JSON.stringify({ nis: '1005', class: '7-B' })]
          }
        ]);
        console.log('[DB] Turso database seeded with default users.');
      }
    } catch (err) {
      console.error('[DB] Turso init error:', err.message);
    }
  }

  // --- Auth & User Management ---
  static async authenticate(username, password) {
    if (isTurso && tursoClient) {
      const res = await tursoClient.execute({
        sql: 'SELECT id, username, password, role, name, extra, created_at FROM users WHERE username = ?',
        args: [username]
      });
      const user = res.rows[0];
      if (!user) return null;

      if (!verifyPassword(password, user.password)) {
        return null;
      }

      // Upgrade legacy unsalted hash if encountered
      if (!user.password.includes('$')) {
        const newHash = hashPassword(password);
        tursoClient.execute({
          sql: 'UPDATE users SET password = ? WHERE id = ?',
          args: [newHash, user.id]
        }).catch(() => {});
      }

      delete user.password;
      if (user.extra) {
        try { user.extra = JSON.parse(user.extra); } catch (e) { user.extra = {}; }
      }
      return user;
    }

    // Fallback store
    const store = getFallbackStore();
    const user = store.users.find(u => u.username === username);
    if (!user) return null;
    if (!verifyPassword(password, user.password)) return null;

    const copy = { ...user };
    delete copy.password;
    return copy;
  }

  static async getUserById(id) {
    if (isTurso && tursoClient) {
      const res = await tursoClient.execute({
        sql: 'SELECT id, username, role, name, extra, created_at FROM users WHERE id = ?',
        args: [id]
      });
      const user = res.rows[0];
      if (user && user.extra) {
        try { user.extra = JSON.parse(user.extra); } catch (e) { user.extra = {}; }
      }
      return user || null;
    }

    const store = getFallbackStore();
    const user = store.users.find(u => u.id === Number(id));
    if (!user) return null;
    const copy = { ...user };
    delete copy.password;
    return copy;
  }

  static async getUserByUsername(username) {
    if (isTurso && tursoClient) {
      const res = await tursoClient.execute({
        sql: 'SELECT id, username, role, name, extra, created_at FROM users WHERE username = ?',
        args: [username]
      });
      const user = res.rows[0];
      if (user && user.extra) {
        try { user.extra = JSON.parse(user.extra); } catch (e) { user.extra = {}; }
      }
      return user || null;
    }

    const store = getFallbackStore();
    const user = store.users.find(u => u.username === username);
    if (!user) return null;
    const copy = { ...user };
    delete copy.password;
    return copy;
  }

  static async listUsersByRole(role) {
    if (isTurso && tursoClient) {
      const res = await tursoClient.execute({
        sql: 'SELECT id, username, role, name, extra, created_at FROM users WHERE role = ? ORDER BY id DESC',
        args: [role]
      });
      return res.rows.map(r => {
        const item = { ...r };
        delete item.password;
        if (item.extra) {
          try { item.extra = JSON.parse(item.extra); } catch (e) { item.extra = {}; }
        }
        return item;
      });
    }

    const store = getFallbackStore();
    return store.users
      .filter(u => u.role === role)
      .sort((a, b) => b.id - a.id)
      .map(u => {
        const copy = { ...u };
        delete copy.password;
        return copy;
      });
  }

  static async createUser({ username, password, role, name, extra = {} }) {
    const hashed = hashPassword(password || '123');
    if (isTurso && tursoClient) {
      const res = await tursoClient.execute({
        sql: 'INSERT INTO users (username, password, role, name, extra) VALUES (?, ?, ?, ?, ?)',
        args: [username, hashed, role, name, JSON.stringify(extra)]
      });
      const newId = Number(res.lastInsertRowid);
      return this.getUserById(newId);
    }

    const store = getFallbackStore();
    const nextId = (store.users.reduce((max, u) => Math.max(max, u.id), 0) || 0) + 1;
    const newUser = {
      id: nextId,
      username,
      password: hashed,
      role,
      name,
      extra,
      created_at: new Date().toISOString()
    };
    store.users.push(newUser);
    saveFallbackStore(store);
    const copy = { ...newUser };
    delete copy.password;
    return copy;
  }

  static async updateUser(id, { name, password, extra }) {
    if (isTurso && tursoClient) {
      let query = 'UPDATE users SET name = ?';
      const params = [name];
      if (password) {
        query += ', password = ?';
        params.push(hashPassword(password));
      }
      if (extra !== undefined) {
        query += ', extra = ?';
        params.push(JSON.stringify(extra));
      }
      query += ' WHERE id = ?';
      params.push(id);

      await tursoClient.execute({ sql: query, args: params });
      return this.getUserById(id);
    }

    const store = getFallbackStore();
    const idx = store.users.findIndex(u => u.id === Number(id));
    if (idx !== -1) {
      if (name) store.users[idx].name = name;
      if (password) store.users[idx].password = hashPassword(password);
      if (extra !== undefined) store.users[idx].extra = extra;
      saveFallbackStore(store);
      return this.getUserById(id);
    }
    return null;
  }

  static async deleteUser(id) {
    if (isTurso && tursoClient) {
      const res = await tursoClient.execute({
        sql: 'DELETE FROM users WHERE id = ?',
        args: [id]
      });
      return res.rowsAffected > 0;
    }

    const store = getFallbackStore();
    const initLen = store.users.length;
    store.users = store.users.filter(u => u.id !== Number(id));
    saveFallbackStore(store);
    return store.users.length < initLen;
  }

  // --- Game Session & Student Records Persistence ---
  static async saveGameSession({ id, pin, guruId, guruName, title, totalQuestions, totalPlayers, results }) {
    if (isTurso && tursoClient) {
      const statements = [
        {
          sql: `INSERT INTO game_sessions (id, pin, guru_id, guru_name, title, total_questions, total_players, results_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            id,
            pin,
            guruId || null,
            guruName || 'Guru Anonim',
            title || 'Kuis Clash of Champion',
            totalQuestions || 0,
            totalPlayers || 0,
            JSON.stringify(results || {})
          ]
        }
      ];

      if (results && results.fullRanking && Array.isArray(results.fullRanking)) {
        for (let i = 0; i < results.fullRanking.length; i++) {
          const p = results.fullRanking[i];
          statements.push({
            sql: `INSERT INTO student_records (
                    game_session_id, student_id, student_identifier, student_name, 
                    score, rank, accuracy, max_streak, boxes_taken
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              id,
              p.studentId || null,
              p.studentIdentifier || p.nickname,
              p.nickname,
              p.score || 0,
              i + 1,
              p.accuracy || 0,
              p.maxStreak || 0,
              p.boxesTaken || 0
            ]
          });
        }
      }

      await tursoClient.batch(statements);
      return id;
    }

    const store = getFallbackStore();
    store.game_sessions.unshift({
      id,
      pin,
      guru_id: guruId || null,
      guru_name: guruName || 'Guru Anonim',
      title: title || 'Kuis Clash of Champion',
      total_questions: totalQuestions || 0,
      total_players: totalPlayers || 0,
      results_json: JSON.stringify(results || {}),
      created_at: new Date().toISOString()
    });

    if (results && results.fullRanking && Array.isArray(results.fullRanking)) {
      results.fullRanking.forEach((p, i) => {
        store.student_records.push({
          id: store.student_records.length + 1,
          game_session_id: id,
          student_id: p.studentId || null,
          student_identifier: p.studentIdentifier || p.nickname,
          student_name: p.nickname,
          score: p.score || 0,
          rank: i + 1,
          accuracy: p.accuracy || 0,
          max_streak: p.maxStreak || 0,
          boxes_taken: p.boxesTaken || 0,
          created_at: new Date().toISOString()
        });
      });
    }

    saveFallbackStore(store);
    return id;
  }

  static async listGameSessions(guruId = null) {
    if (isTurso && tursoClient) {
      let res;
      if (guruId) {
        res = await tursoClient.execute({
          sql: `SELECT id, pin, guru_id, guru_name, title, total_questions, total_players, created_at 
                FROM game_sessions 
                WHERE guru_id = ? 
                ORDER BY created_at DESC`,
          args: [guruId]
        });
      } else {
        res = await tursoClient.execute(`SELECT id, pin, guru_id, guru_name, title, total_questions, total_players, created_at 
                FROM game_sessions 
                ORDER BY created_at DESC`);
      }
      return res.rows;
    }

    const store = getFallbackStore();
    return store.game_sessions
      .filter(s => guruId ? s.guru_id === Number(guruId) : true)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  static async getGameSessionById(id) {
    if (isTurso && tursoClient) {
      const sessionRes = await tursoClient.execute({
        sql: 'SELECT * FROM game_sessions WHERE id = ?',
        args: [id]
      });
      const session = sessionRes.rows[0];
      if (!session) return null;

      if (session.results_json) {
        try { session.results = JSON.parse(session.results_json); } catch (e) { session.results = {}; }
      }

      const recordsRes = await tursoClient.execute({
        sql: 'SELECT * FROM student_records WHERE game_session_id = ? ORDER BY rank ASC',
        args: [id]
      });
      session.studentRecords = recordsRes.rows;
      return session;
    }

    const store = getFallbackStore();
    const session = store.game_sessions.find(s => s.id === id);
    if (!session) return null;

    const copy = { ...session };
    if (copy.results_json) {
      try { copy.results = JSON.parse(copy.results_json); } catch (e) { copy.results = {}; }
    }
    copy.studentRecords = store.student_records
      .filter(r => r.game_session_id === id)
      .sort((a, b) => a.rank - b.rank);
    return copy;
  }

  static async getStudentRecordHistory(studentIdOrIdentifier) {
    if (isTurso && tursoClient) {
      const res = await tursoClient.execute({
        sql: `SELECT sr.*, gs.title as game_title, gs.created_at as game_date, gs.guru_name
              FROM student_records sr
              JOIN game_sessions gs ON sr.game_session_id = gs.id
              WHERE sr.student_id = ? OR sr.student_identifier = ?
              ORDER BY sr.created_at DESC`,
        args: [studentIdOrIdentifier, String(studentIdOrIdentifier)]
      });
      return res.rows;
    }

    const store = getFallbackStore();
    const idStr = String(studentIdOrIdentifier);
    return store.student_records
      .filter(sr => sr.student_id === Number(studentIdOrIdentifier) || sr.student_identifier === idStr)
      .map(sr => {
        const gs = store.game_sessions.find(g => g.id === sr.game_session_id) || {};
        return {
          ...sr,
          game_title: gs.title || 'Kuis',
          game_date: gs.created_at || sr.created_at,
          guru_name: gs.guru_name || 'Guru'
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  // --- Question Banks ---
  static async saveQuestionBank(guruId, title, questions) {
    if (isTurso && tursoClient) {
      const res = await tursoClient.execute({
        sql: 'INSERT INTO question_banks (guru_id, title, questions_json) VALUES (?, ?, ?)',
        args: [guruId, title, JSON.stringify(questions)]
      });
      return Number(res.lastInsertRowid);
    }

    const store = getFallbackStore();
    const nextId = (store.question_banks.reduce((max, b) => Math.max(max, b.id), 0) || 0) + 1;
    const newBank = {
      id: nextId,
      guru_id: Number(guruId),
      title,
      questions_json: JSON.stringify(questions),
      created_at: new Date().toISOString()
    };
    store.question_banks.unshift(newBank);
    saveFallbackStore(store);
    return nextId;
  }

  static async listQuestionBanks(guruId = null) {
    if (isTurso && tursoClient) {
      let res;
      if (guruId !== null && guruId !== undefined && guruId !== '') {
        res = await tursoClient.execute({
          sql: `SELECT qb.id, qb.guru_id, qb.title, qb.created_at, qb.questions_json,
                       u.name as creator_name, u.username as creator_username, u.role as creator_role, u.extra as creator_extra
                FROM question_banks qb
                LEFT JOIN users u ON qb.guru_id = u.id
                WHERE qb.guru_id = ?
                ORDER BY qb.created_at DESC`,
          args: [Number(guruId)]
        });
      } else {
        res = await tursoClient.execute(`SELECT qb.id, qb.guru_id, qb.title, qb.created_at, qb.questions_json,
                       u.name as creator_name, u.username as creator_username, u.role as creator_role, u.extra as creator_extra
                FROM question_banks qb
                LEFT JOIN users u ON qb.guru_id = u.id
                ORDER BY qb.created_at DESC`);
      }

      return res.rows.map(r => {
        let questionCount = 0;
        if (r.questions_json) {
          try {
            const parsed = JSON.parse(r.questions_json);
            questionCount = Array.isArray(parsed) ? parsed.length : 0;
          } catch (e) {}
        }

        let extraObj = {};
        if (r.creator_extra) {
          try { extraObj = JSON.parse(r.creator_extra); } catch (e) {}
        }

        const copy = { ...r };
        delete copy.questions_json;
        return {
          ...copy,
          size: r.questions_json ? r.questions_json.length : 0,
          questionCount,
          creator_extra: extraObj
        };
      });
    }

    const store = getFallbackStore();
    return store.question_banks
      .filter(qb => (guruId !== null && guruId !== undefined && guruId !== '') ? qb.guru_id === Number(guruId) : true)
      .map(qb => {
        const creator = store.users.find(u => u.id === qb.guru_id) || {};
        let questionCount = 0;
        try {
          const parsed = JSON.parse(qb.questions_json);
          questionCount = Array.isArray(parsed) ? parsed.length : 0;
        } catch (e) {}
        return {
          id: qb.id,
          guru_id: qb.guru_id,
          title: qb.title,
          created_at: qb.created_at,
          size: qb.questions_json ? qb.questions_json.length : 0,
          questionCount,
          creator_name: creator.name || 'Guru',
          creator_username: creator.username || '',
          creator_role: creator.role || 'guru',
          creator_extra: creator.extra || {}
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  static async getQuestionBank(id, guruId = null) {
    if (isTurso && tursoClient) {
      let res;
      if (guruId !== null && guruId !== undefined && guruId !== '') {
        res = await tursoClient.execute({
          sql: `SELECT qb.*, u.name as creator_name, u.username as creator_username, u.role as creator_role, u.extra as creator_extra
                FROM question_banks qb
                LEFT JOIN users u ON qb.guru_id = u.id
                WHERE qb.id = ? AND qb.guru_id = ?`,
          args: [Number(id), Number(guruId)]
        });
      } else {
        res = await tursoClient.execute({
          sql: `SELECT qb.*, u.name as creator_name, u.username as creator_username, u.role as creator_role, u.extra as creator_extra
                FROM question_banks qb
                LEFT JOIN users u ON qb.guru_id = u.id
                WHERE qb.id = ?`,
          args: [Number(id)]
        });
      }

      const row = res.rows[0];
      if (row) {
        if (row.questions_json) {
          try { row.questions = JSON.parse(row.questions_json); } catch (e) { row.questions = []; }
        }
        if (row.creator_extra) {
          try { row.creator_extra = JSON.parse(row.creator_extra); } catch (e) { row.creator_extra = {}; }
        }
      }
      return row || null;
    }

    const store = getFallbackStore();
    const bank = store.question_banks.find(b => {
      if (b.id !== Number(id)) return false;
      if (guruId !== null && guruId !== undefined && guruId !== '') {
        return b.guru_id === Number(guruId);
      }
      return true;
    });
    if (!bank) return null;

    const creator = store.users.find(u => u.id === bank.guru_id) || {};
    let questions = [];
    try { questions = JSON.parse(bank.questions_json); } catch (e) {}

    return {
      ...bank,
      questions,
      creator_name: creator.name || 'Guru',
      creator_username: creator.username || '',
      creator_role: creator.role || 'guru',
      creator_extra: creator.extra || {}
    };
  }

  static async deleteQuestionBank(id, guruId = null) {
    if (isTurso && tursoClient) {
      let res;
      if (guruId !== null && guruId !== undefined && guruId !== '') {
        res = await tursoClient.execute({
          sql: 'DELETE FROM question_banks WHERE id = ? AND guru_id = ?',
          args: [Number(id), Number(guruId)]
        });
      } else {
        res = await tursoClient.execute({
          sql: 'DELETE FROM question_banks WHERE id = ?',
          args: [Number(id)]
        });
      }
      return res.rowsAffected > 0;
    }

    const store = getFallbackStore();
    const initLen = store.question_banks.length;
    store.question_banks = store.question_banks.filter(b => {
      if (b.id !== Number(id)) return true;
      if (guruId !== null && guruId !== undefined && guruId !== '') {
        return b.guru_id !== Number(guruId);
      }
      return false;
    });
    saveFallbackStore(store);
    return store.question_banks.length < initLen;
  }

  // --- Active Rooms (Serverless Realtime State in Turso) ---
  static async saveActiveRoom(pin, adminToken, status, roomData) {
    const now = Date.now();
    const dataStr = typeof roomData === 'string' ? roomData : JSON.stringify(roomData);
    if (isTurso && tursoClient) {
      await tursoClient.execute({
        sql: `INSERT INTO active_rooms (pin, admin_token, status, room_data, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(pin) DO UPDATE SET
                admin_token = excluded.admin_token,
                status = excluded.status,
                room_data = excluded.room_data,
                updated_at = excluded.updated_at`,
        args: [String(pin), String(adminToken), String(status), dataStr, now]
      });
      return true;
    }

    const store = getFallbackStore();
    if (!store.active_rooms) store.active_rooms = {};
    store.active_rooms[String(pin)] = {
      pin: String(pin),
      adminToken: String(adminToken),
      status: String(status),
      roomData: typeof roomData === 'object' ? roomData : JSON.parse(dataStr),
      updatedAt: now
    };
    saveFallbackStore(store);
    return true;
  }

  static async getActiveRoom(pin) {
    if (isTurso && tursoClient) {
      const res = await tursoClient.execute({
        sql: 'SELECT * FROM active_rooms WHERE pin = ?',
        args: [String(pin)]
      });
      const row = res.rows[0];
      if (!row) return null;
      let roomData = {};
      try {
        roomData = JSON.parse(row.room_data);
      } catch (e) {}
      return {
        pin: row.pin,
        adminToken: row.admin_token,
        status: row.status,
        roomData,
        updatedAt: row.updated_at
      };
    }

    const store = getFallbackStore();
    if (!store.active_rooms) return null;
    return store.active_rooms[String(pin)] || null;
  }

  static async deleteActiveRoom(pin) {
    if (isTurso && tursoClient) {
      const res = await tursoClient.execute({
        sql: 'DELETE FROM active_rooms WHERE pin = ?',
        args: [String(pin)]
      });
      return res.rowsAffected > 0;
    }

    const store = getFallbackStore();
    if (store.active_rooms && store.active_rooms[String(pin)]) {
      delete store.active_rooms[String(pin)];
      saveFallbackStore(store);
      return true;
    }
    return false;
  }

  static async listActiveRooms() {
    if (isTurso && tursoClient) {
      const res = await tursoClient.execute('SELECT pin, admin_token, status, updated_at FROM active_rooms ORDER BY updated_at DESC');
      return res.rows;
    }

    const store = getFallbackStore();
    if (!store.active_rooms) return [];
    return Object.values(store.active_rooms).map(r => ({
      pin: r.pin,
      admin_token: r.adminToken,
      status: r.status,
      updated_at: r.updatedAt
    }));
  }

  static async close() {
    try {
      if (tursoClient) {
        tursoClient.close();
      }
    } catch (e) {}
  }
}

// Auto initialize schema & seeds on load
AppDatabase.init().catch(err => {
  console.warn('[DB] Background init notice:', err.message);
});

module.exports = AppDatabase;
