const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Ensure data directory exists
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dataDir, 'clash.db');
const db = new Database(dbPath);

// Enable WAL mode for high concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL, -- 'admin', 'guru', 'siswa'
    name TEXT NOT NULL,
    extra TEXT, -- JSON string: { nip, subject, nis, class, ... }
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS game_sessions (
    id TEXT PRIMARY KEY,
    pin TEXT NOT NULL,
    guru_id INTEGER,
    guru_name TEXT,
    title TEXT,
    total_questions INTEGER DEFAULT 0,
    total_players INTEGER DEFAULT 0,
    results_json TEXT, -- Full podium, rankings, and titles JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (guru_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS student_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_session_id TEXT NOT NULL,
    student_id INTEGER,
    student_identifier TEXT, -- NIS or nickname
    student_name TEXT NOT NULL,
    score INTEGER DEFAULT 0,
    rank INTEGER DEFAULT 0,
    accuracy REAL DEFAULT 0,
    max_streak INTEGER DEFAULT 0,
    boxes_taken INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_session_id) REFERENCES game_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS question_banks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guru_id INTEGER,
    title TEXT NOT NULL,
    questions_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (guru_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Salted PBKDF2 hash helper with backwards compatibility
function hashPassword(pass, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  const derived = crypto.pbkdf2Sync(String(pass), salt, 10000, 32, 'sha256').toString('hex');
  return `${salt}$${derived}`;
}

function verifyPassword(pass, storedHash) {
  if (!storedHash) return false;
  // Fallback for legacy unsalted SHA-256 hashes
  if (!storedHash.includes('$')) {
    const legacy = crypto.createHash('sha256').update(String(pass)).digest('hex');
    return legacy === storedHash;
  }
  const [salt, hash] = storedHash.split('$');
  const derived = crypto.pbkdf2Sync(String(pass), salt, 10000, 32, 'sha256').toString('hex');
  return derived === hash;
}

// Seed default accounts if empty
const countStmt = db.prepare('SELECT COUNT(*) as count FROM users');
const userCount = countStmt.get().count;

if (userCount === 0) {
  const insertUser = db.prepare(`
    INSERT INTO users (username, password, role, name, extra)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Default Admin
  insertUser.run('admin', hashPassword('admin123'), 'admin', 'Administrator Utama', JSON.stringify({ roleDesc: 'Super Admin' }));

  // Default Guru
  insertUser.run('guru', hashPassword('guru123'), 'guru', 'Ibu Guru Sarah, S.Pd', JSON.stringify({ nip: '198501152010012001', subject: 'Ilmu Pengetahuan Alam' }));

  // Default Students
  insertUser.run('1001', hashPassword('123'), 'siswa', 'Ahmad Dani', JSON.stringify({ nis: '1001', class: '7-A' }));
  insertUser.run('1002', hashPassword('123'), 'siswa', 'Budi Santoso', JSON.stringify({ nis: '1002', class: '7-A' }));
  insertUser.run('1003', hashPassword('123'), 'siswa', 'Citra Lestari', JSON.stringify({ nis: '1003', class: '7-A' }));
  insertUser.run('1004', hashPassword('123'), 'siswa', 'Dewi Anggraini', JSON.stringify({ nis: '1004', class: '7-B' }));
  insertUser.run('1005', hashPassword('123'), 'siswa', 'Eko Prasetyo', JSON.stringify({ nis: '1005', class: '7-B' }));
  console.log('[DB] Database seeded with default Admin, Guru, and 5 Siswa.');
}

class AppDatabase {
  // Auth & User Management
  static authenticate(username, password) {
    const stmt = db.prepare('SELECT id, username, password, role, name, extra, created_at FROM users WHERE username = ?');
    const user = stmt.get(username);
    if (!user) return null;

    if (!verifyPassword(password, user.password)) {
      return null;
    }

    // Transparently upgrade legacy unsalted hash to salted PBKDF2
    if (!user.password.includes('$')) {
      const newHash = hashPassword(password);
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newHash, user.id);
    }

    delete user.password;
    if (user.extra) {
      try { user.extra = JSON.parse(user.extra); } catch (e) { user.extra = {}; }
    }
    return user;
  }

  static getUserById(id) {
    const stmt = db.prepare('SELECT id, username, role, name, extra, created_at FROM users WHERE id = ?');
    const user = stmt.get(id);
    if (user && user.extra) {
      try { user.extra = JSON.parse(user.extra); } catch (e) { user.extra = {}; }
    }
    return user;
  }

  static getUserByUsername(username) {
    const stmt = db.prepare('SELECT id, username, role, name, extra, created_at FROM users WHERE username = ?');
    const user = stmt.get(username);
    if (user && user.extra) {
      try { user.extra = JSON.parse(user.extra); } catch (e) { user.extra = {}; }
    }
    return user;
  }

  static listUsersByRole(role) {
    const stmt = db.prepare('SELECT id, username, role, name, extra, created_at FROM users WHERE role = ? ORDER BY id DESC');
    const rows = stmt.all(role);
    return rows.map(r => {
      try { r.extra = JSON.parse(r.extra); } catch (e) { r.extra = {}; }
      return r;
    });
  }

  static createUser({ username, password, role, name, extra = {} }) {
    const hashed = hashPassword(password || '123');
    const stmt = db.prepare(`
      INSERT INTO users (username, password, role, name, extra)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(username, hashed, role, name, JSON.stringify(extra));
    return this.getUserById(info.lastInsertRowid);
  }

  static updateUser(id, { name, password, extra }) {
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

    db.prepare(query).run(...params);
    return this.getUserById(id);
  }

  static deleteUser(id) {
    return db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  // Game Session & Student Records Persistence
  static saveGameSession({ id, pin, guruId, guruName, title, totalQuestions, totalPlayers, results }) {
    const stmt = db.prepare(`
      INSERT INTO game_sessions (id, pin, guru_id, guru_name, title, total_questions, total_players, results_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      pin,
      guruId || null,
      guruName || 'Guru Anonim',
      title || 'Kuis Clash of Champion',
      totalQuestions || 0,
      totalPlayers || 0,
      JSON.stringify(results || {})
    );

    // Save individual student records if results available
    if (results && results.fullRanking && Array.isArray(results.fullRanking)) {
      const recordStmt = db.prepare(`
        INSERT INTO student_records (
          game_session_id, student_id, student_identifier, student_name, 
          score, rank, accuracy, max_streak, boxes_taken
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMany = db.transaction((rankings) => {
        for (let i = 0; i < rankings.length; i++) {
          const p = rankings[i];
          recordStmt.run(
            id,
            p.studentId || null,
            p.studentIdentifier || p.nickname,
            p.nickname,
            p.score || 0,
            i + 1,
            p.accuracy || 0,
            p.maxStreak || 0,
            p.boxesTaken || 0
          );
        }
      });

      insertMany(results.fullRanking);
    }

    return id;
  }

  static listGameSessions(guruId = null) {
    let stmt;
    if (guruId) {
      stmt = db.prepare(`
        SELECT id, pin, guru_id, guru_name, title, total_questions, total_players, created_at 
        FROM game_sessions 
        WHERE guru_id = ? 
        ORDER BY created_at DESC
      `);
      return stmt.all(guruId);
    } else {
      stmt = db.prepare(`
        SELECT id, pin, guru_id, guru_name, title, total_questions, total_players, created_at 
        FROM game_sessions 
        ORDER BY created_at DESC
      `);
      return stmt.all();
    }
  }

  static getGameSessionById(id) {
    const sessionStmt = db.prepare('SELECT * FROM game_sessions WHERE id = ?');
    const session = sessionStmt.get(id);
    if (!session) return null;

    if (session.results_json) {
      try { session.results = JSON.parse(session.results_json); } catch (e) { session.results = {}; }
    }

    const recordsStmt = db.prepare('SELECT * FROM student_records WHERE game_session_id = ? ORDER BY rank ASC');
    session.studentRecords = recordsStmt.all(id);

    return session;
  }

  static getStudentRecordHistory(studentIdOrIdentifier) {
    const stmt = db.prepare(`
      SELECT sr.*, gs.title as game_title, gs.created_at as game_date, gs.guru_name
      FROM student_records sr
      JOIN game_sessions gs ON sr.game_session_id = gs.id
      WHERE sr.student_id = ? OR sr.student_identifier = ?
      ORDER BY sr.created_at DESC
    `);
    return stmt.all(studentIdOrIdentifier, String(studentIdOrIdentifier));
  }

  // Question Banks
  static saveQuestionBank(guruId, title, questions) {
    const stmt = db.prepare(`
      INSERT INTO question_banks (guru_id, title, questions_json)
      VALUES (?, ?, ?)
    `);
    const info = stmt.run(guruId, title, JSON.stringify(questions));
    return info.lastInsertRowid;
  }

  static listQuestionBanks(guruId = null) {
    let stmt, rows;
    if (guruId !== null && guruId !== undefined && guruId !== '') {
      stmt = db.prepare(`
        SELECT qb.id, qb.guru_id, qb.title, qb.created_at, length(qb.questions_json) as size,
               u.name as creator_name, u.username as creator_username, u.role as creator_role, u.extra as creator_extra
        FROM question_banks qb
        LEFT JOIN users u ON qb.guru_id = u.id
        WHERE qb.guru_id = ?
        ORDER BY qb.created_at DESC
      `);
      rows = stmt.all(Number(guruId));
    } else {
      stmt = db.prepare(`
        SELECT qb.id, qb.guru_id, qb.title, qb.created_at, length(qb.questions_json) as size,
               u.name as creator_name, u.username as creator_username, u.role as creator_role, u.extra as creator_extra
        FROM question_banks qb
        LEFT JOIN users u ON qb.guru_id = u.id
        ORDER BY qb.created_at DESC
      `);
      rows = stmt.all();
    }

    return rows.map(r => {
      let questionCount = 0;
      try {
        const raw = db.prepare('SELECT questions_json FROM question_banks WHERE id = ?').get(r.id);
        if (raw && raw.questions_json) {
          const parsed = JSON.parse(raw.questions_json);
          questionCount = Array.isArray(parsed) ? parsed.length : 0;
        }
      } catch (e) {}

      let extraObj = {};
      if (r.creator_extra) {
        try { extraObj = JSON.parse(r.creator_extra); } catch (e) {}
      }

      return {
        ...r,
        questionCount,
        creator_extra: extraObj
      };
    });
  }

  static getQuestionBank(id, guruId = null) {
    let stmt, row;
    if (guruId !== null && guruId !== undefined && guruId !== '') {
      stmt = db.prepare(`
        SELECT qb.*, u.name as creator_name, u.username as creator_username, u.role as creator_role, u.extra as creator_extra
        FROM question_banks qb
        LEFT JOIN users u ON qb.guru_id = u.id
        WHERE qb.id = ? AND qb.guru_id = ?
      `);
      row = stmt.get(Number(id), Number(guruId));
    } else {
      stmt = db.prepare(`
        SELECT qb.*, u.name as creator_name, u.username as creator_username, u.role as creator_role, u.extra as creator_extra
        FROM question_banks qb
        LEFT JOIN users u ON qb.guru_id = u.id
        WHERE qb.id = ?
      `);
      row = stmt.get(Number(id));
    }
    if (row) {
      if (row.questions_json) {
        try { row.questions = JSON.parse(row.questions_json); } catch (e) { row.questions = []; }
      }
      if (row.creator_extra) {
        try { row.creator_extra = JSON.parse(row.creator_extra); } catch (e) { row.creator_extra = {}; }
      }
    }
    return row;
  }

  static deleteQuestionBank(id, guruId = null) {
    let stmt;
    if (guruId !== null && guruId !== undefined && guruId !== '') {
      stmt = db.prepare('DELETE FROM question_banks WHERE id = ? AND guru_id = ?');
      return stmt.run(Number(id), Number(guruId)).changes > 0;
    } else {
      stmt = db.prepare('DELETE FROM question_banks WHERE id = ?');
      return stmt.run(Number(id)).changes > 0;
    }
  }

  static close() {
    try {
      db.close();
    } catch (e) {}
  }
}

module.exports = AppDatabase;
