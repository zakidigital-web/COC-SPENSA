const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Determine writable directory for Vercel Serverless (/tmp)
const dataDir = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data'));
if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (e) {}
}

const storeFile = path.join(dataDir, 'clash_store.json');

// Salted PBKDF2 hash helper
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

// In-Memory Store with /tmp file persistence
let store = {
  users: [],
  game_sessions: [],
  student_records: [],
  question_banks: [],
  nextUserId: 1,
  nextRecordId: 1,
  nextBankId: 1
};

function loadStore() {
  try {
    if (fs.existsSync(storeFile)) {
      const raw = fs.readFileSync(storeFile, 'utf8');
      const data = JSON.parse(raw);
      store = { ...store, ...data };
      return;
    }
  } catch (e) {}
  seedDefaults();
  saveStore();
}

function saveStore() {
  try {
    fs.writeFileSync(storeFile, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {}
}

function seedDefaults() {
  if (store.users.length === 0) {
    store.users = [
      {
        id: 1,
        username: 'admin',
        password: hashPassword('admin123'),
        role: 'admin',
        name: 'Administrator Utama',
        extra: { roleDesc: 'Super Admin' },
        created_at: new Date().toISOString()
      },
      {
        id: 2,
        username: 'guru',
        password: hashPassword('guru123'),
        role: 'guru',
        name: 'Ibu Guru Sarah, S.Pd',
        extra: { nip: '198501152010012001', subject: 'Ilmu Pengetahuan Alam' },
        created_at: new Date().toISOString()
      },
      {
        id: 3,
        username: '1001',
        password: hashPassword('123'),
        role: 'siswa',
        name: 'Ahmad Dani',
        extra: { nis: '1001', class: '7-A' },
        created_at: new Date().toISOString()
      },
      {
        id: 4,
        username: '1002',
        password: hashPassword('123'),
        role: 'siswa',
        name: 'Budi Santoso',
        extra: { nis: '1002', class: '7-A' },
        created_at: new Date().toISOString()
      },
      {
        id: 5,
        username: '1003',
        password: hashPassword('123'),
        role: 'siswa',
        name: 'Citra Lestari',
        extra: { nis: '1003', class: '7-A' },
        created_at: new Date().toISOString()
      },
      {
        id: 6,
        username: '1004',
        password: hashPassword('123'),
        role: 'siswa',
        name: 'Dewi Anggraini',
        extra: { nis: '1004', class: '7-B' },
        created_at: new Date().toISOString()
      },
      {
        id: 7,
        username: '1005',
        password: hashPassword('123'),
        role: 'siswa',
        name: 'Eko Prasetyo',
        extra: { nis: '1005', class: '7-B' },
        created_at: new Date().toISOString()
      }
    ];
    store.nextUserId = 8;
  }
}

// Initial load
loadStore();

class AppDatabase {
  static authenticate(username, password) {
    loadStore();
    const user = store.users.find(u => u.username === username);
    if (!user) return null;

    if (!verifyPassword(password, user.password)) {
      return null;
    }

    // Transparently upgrade legacy unsalted hash to salted PBKDF2
    if (!user.password.includes('$')) {
      user.password = hashPassword(password);
      saveStore();
    }

    const safeUser = { ...user };
    delete safeUser.password;
    return safeUser;
  }

  static getUserById(id) {
    loadStore();
    const user = store.users.find(u => u.id === Number(id));
    if (!user) return null;
    const safeUser = { ...user };
    delete safeUser.password;
    return safeUser;
  }

  static getUserByUsername(username) {
    loadStore();
    const user = store.users.find(u => u.username === username);
    if (!user) return null;
    const safeUser = { ...user };
    delete safeUser.password;
    return safeUser;
  }

  static listUsersByRole(role) {
    loadStore();
    return store.users
      .filter(u => u.role === role)
      .map(u => {
        const copy = { ...u };
        delete copy.password;
        return copy;
      })
      .reverse();
  }

  static createUser({ username, password, role, name, extra = {} }) {
    loadStore();
    const existing = store.users.find(u => u.username === username);
    if (existing) {
      throw new Error(`Username ${username} sudah digunakan`);
    }

    const newUser = {
      id: store.nextUserId++,
      username,
      password: hashPassword(password || '123'),
      role,
      name,
      extra,
      created_at: new Date().toISOString()
    };

    store.users.push(newUser);
    saveStore();

    const safeUser = { ...newUser };
    delete safeUser.password;
    return safeUser;
  }

  static updateUser(id, { name, password, extra }) {
    loadStore();
    const user = store.users.find(u => u.id === Number(id));
    if (!user) return null;

    if (name !== undefined) user.name = name;
    if (password) user.password = hashPassword(password);
    if (extra !== undefined) user.extra = extra;

    saveStore();

    const safeUser = { ...user };
    delete safeUser.password;
    return safeUser;
  }

  static deleteUser(id) {
    loadStore();
    const idx = store.users.findIndex(u => u.id === Number(id));
    if (idx !== -1) {
      store.users.splice(idx, 1);
      saveStore();
      return true;
    }
    return false;
  }

  // Game Session & Student Records Persistence
  static saveGameSession({ id, pin, guruId, guruName, title, totalQuestions, totalPlayers, results }) {
    loadStore();
    const session = {
      id,
      pin,
      guru_id: guruId || null,
      guru_name: guruName || 'Guru Anonim',
      title: title || 'Kuis Clash of Champion',
      total_questions: totalQuestions || 0,
      total_players: totalPlayers || 0,
      results_json: JSON.stringify(results || {}),
      created_at: new Date().toISOString()
    };

    store.game_sessions.push(session);

    if (results && results.fullRanking && Array.isArray(results.fullRanking)) {
      for (let i = 0; i < results.fullRanking.length; i++) {
        const p = results.fullRanking[i];
        store.student_records.push({
          id: store.nextRecordId++,
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
      }
    }

    saveStore();
    return id;
  }

  static listGameSessions(guruId = null) {
    loadStore();
    let list = store.game_sessions;
    if (guruId) {
      list = list.filter(s => s.guru_id === Number(guruId));
    }
    return [...list].reverse().map(s => ({
      id: s.id,
      pin: s.pin,
      guru_id: s.guru_id,
      guru_name: s.guru_name,
      title: s.title,
      total_questions: s.total_questions,
      total_players: s.total_players,
      created_at: s.created_at
    }));
  }

  static getGameSessionById(id) {
    loadStore();
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

  static getStudentRecordHistory(studentIdOrIdentifier) {
    loadStore();
    const sId = Number(studentIdOrIdentifier);
    const sStr = String(studentIdOrIdentifier);

    const records = store.student_records.filter(r => r.student_id === sId || r.student_identifier === sStr);
    return records.map(r => {
      const session = store.game_sessions.find(s => s.id === r.game_session_id) || {};
      return {
        ...r,
        game_title: session.title || 'Kuis',
        game_date: session.created_at || r.created_at,
        guru_name: session.guru_name || '-'
      };
    }).reverse();
  }

  // Question Banks
  static saveQuestionBank(guruId, title, questions) {
    loadStore();
    const newBank = {
      id: store.nextBankId++,
      guru_id: Number(guruId),
      title,
      questions_json: JSON.stringify(questions),
      created_at: new Date().toISOString()
    };

    store.question_banks.push(newBank);
    saveStore();
    return newBank.id;
  }

  static listQuestionBanks(guruId = null) {
    loadStore();
    let list = store.question_banks;
    if (guruId !== null && guruId !== undefined && guruId !== '') {
      list = list.filter(b => b.guru_id === Number(guruId));
    }

    return [...list].reverse().map(b => {
      const creator = store.users.find(u => u.id === b.guru_id) || {};
      let questionCount = 0;
      try {
        const qArr = JSON.parse(b.questions_json);
        questionCount = Array.isArray(qArr) ? qArr.length : 0;
      } catch (e) {}

      return {
        id: b.id,
        guru_id: b.guru_id,
        title: b.title,
        created_at: b.created_at,
        size: b.questions_json.length,
        creator_name: creator.name || 'Guru',
        creator_username: creator.username || '',
        creator_role: creator.role || 'guru',
        creator_extra: creator.extra || {},
        questionCount
      };
    });
  }

  static getQuestionBank(id, guruId = null) {
    loadStore();
    const bank = store.question_banks.find(b => {
      if (guruId !== null && guruId !== undefined && guruId !== '') {
        return b.id === Number(id) && b.guru_id === Number(guruId);
      }
      return b.id === Number(id);
    });

    if (!bank) return null;
    const creator = store.users.find(u => u.id === bank.guru_id) || {};

    let questions = [];
    try {
      questions = JSON.parse(bank.questions_json);
    } catch (e) {}

    return {
      ...bank,
      creator_name: creator.name || 'Guru',
      creator_username: creator.username || '',
      creator_role: creator.role || 'guru',
      creator_extra: creator.extra || {},
      questions
    };
  }

  static deleteQuestionBank(id, guruId = null) {
    loadStore();
    const idx = store.question_banks.findIndex(b => {
      if (guruId !== null && guruId !== undefined && guruId !== '') {
        return b.id === Number(id) && b.guru_id === Number(guruId);
      }
      return b.id === Number(id);
    });

    if (idx !== -1) {
      store.question_banks.splice(idx, 1);
      saveStore();
      return true;
    }
    return false;
  }

  static close() {
    saveStore();
  }
}

module.exports = AppDatabase;
