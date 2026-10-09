const http = require('http');

const BASE_URL = 'http://localhost:3000';

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {}
    };

    if (token) {
      options.headers['Authorization'] = 'Bearer ' + token;
    }

    let postData = null;
    if (body) {
      postData = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(buffer.toString()) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: buffer.toString() });
          }
        } else {
          resolve({ status: res.statusCode, raw: buffer.toString() });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function testAdminQuestionBanks() {
  console.log('\n🧪 ========================================================');
  console.log('🧪 PENGUJIAN: MANAJEMEN BANK SOAL ADMIN & GURU');
  console.log('========================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(desc, condition) {
    if (condition) {
      console.log(`  ✅ ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ GAGAL: ${desc}`);
      failed++;
    }
  }

  try {
    // 1. Login Admin & Guru
    console.log('1. Autentikasi Admin dan Guru...');
    const adminLogin = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
    assert('Admin berhasil login', adminLogin.status === 200 && adminLogin.data.token);
    const adminToken = adminLogin.data.token;
    const adminId = adminLogin.data.user.id;

    const guruLogin = await request('POST', '/api/auth/login', { username: 'guru', password: 'guru123' });
    assert('Guru berhasil login', guruLogin.status === 200 && guruLogin.data.token);
    const guruToken = guruLogin.data.token;
    const guruId = guruLogin.data.user.id;

    // 2. Guru saves a Question Bank
    console.log('\n2. Guru Menyimpan Paket Bank Soal...');
    const sampleGuruQuestions = [
      {
        type: 'multiple_choice',
        text: 'Berapakah 15 x 6?',
        options: ['70', '80', '90', '100'],
        correctAnswer: '90',
        points: 100
      },
      {
        type: 'true_false',
        text: 'Bumi adalah planet ketiga dari matahari.',
        correct: true,
        points: 80
      }
    ];

    const guruBankRes = await request('POST', '/api/guru/question-banks', {
      guruId: guruId,
      title: 'Bank Soal Guru Matematika Dasar',
      questions: sampleGuruQuestions
    }, guruToken);

    assert('Guru berhasil membuat bank soal', guruBankRes.status === 200 && guruBankRes.data.id > 0);
    const guruBankId = guruBankRes.data.id;

    // 3. Admin Lists All Question Banks (and can see Guru's name & role)
    console.log('\n3. Admin Melihat Seluruh Bank Soal Sekolah (/api/admin/question-banks)...');
    const adminListRes = await request('GET', '/api/admin/question-banks', null, adminToken);
    assert('Admin berhasil mengambil seluruh daftar bank soal', adminListRes.status === 200 && Array.isArray(adminListRes.data.banks));

    const foundGuruBank = adminListRes.data.banks.find(b => b.id === guruBankId);
    assert('Bank soal buatan guru muncul di daftar admin', Boolean(foundGuruBank));
    assert('Admin dapat mengetahui nama pembuat soal (Guru)', foundGuruBank && Boolean(foundGuruBank.creator_name || foundGuruBank.creator_username));
    assert('Admin dapat mengetahui jumlah soal dalam bank', foundGuruBank && foundGuruBank.questionCount === 2);

    // 4. Admin Creates Their Own Question Bank
    console.log('\n4. Admin Membuat Bank Soal Sendiri (/api/admin/question-banks)...');
    const sampleAdminQuestions = [
      {
        type: 'multiple_choice',
        text: 'Siapakah presiden pertama Indonesia?',
        options: ['Ir. Soekarno', 'Moh. Hatta', 'Soeharto', 'B.J. Habibie'],
        correctAnswer: 'Ir. Soekarno',
        points: 150
      },
      {
        type: 'short_answer',
        text: 'Lambang negara Indonesia adalah...',
        correctText: 'Garuda Pancasila',
        points: 120
      },
      {
        type: 'true_false',
        text: 'Monas berada di kota Bandung.',
        correct: false,
        points: 100
      }
    ];

    const adminCreateRes = await request('POST', '/api/admin/question-banks', {
      title: 'Paket Ujian Sekolah - Sejarah Nasional (Oleh Admin)',
      questions: sampleAdminQuestions
    }, adminToken);

    assert('Admin berhasil membuat bank soal baru', adminCreateRes.status === 200 && adminCreateRes.data.id > 0);
    const adminBankId = adminCreateRes.data.id;

    // 5. Admin Inspects Question Bank Detail
    console.log('\n5. Admin Memeriksa Detail Soal di Bank Soal...');
    const bankDetailRes = await request('GET', `/api/admin/question-banks/${adminBankId}`, null, adminToken);
    assert('Admin berhasil melihat detail bank soal', bankDetailRes.status === 200 && bankDetailRes.data.bank);
    assert('Detail memuat seluruh 3 soal lengkap', bankDetailRes.data.bank && bankDetailRes.data.bank.questions.length === 3);
    assert('Role pembuat tercatat sebagai admin', bankDetailRes.data.bank.creator_role === 'admin');

    // 6. Admin Deletes Question Bank
    console.log('\n6. Admin Menghapus Bank Soal...');
    const deleteRes = await request('DELETE', `/api/admin/question-banks/${adminBankId}`, null, adminToken);
    assert('Admin berhasil menghapus bank soal', deleteRes.status === 200 && deleteRes.data.success === true);

    const checkDeleted = await request('GET', `/api/admin/question-banks/${adminBankId}`, null, adminToken);
    assert('Bank soal yang dihapus tidak lagi ditemukan (404)', checkDeleted.status === 404);

    // Clean up guru bank
    await request('DELETE', `/api/admin/question-banks/${guruBankId}`, null, adminToken);

  } catch (err) {
    console.error('Critical test error:', err);
    failed++;
  }

  console.log('\n========================================================');
  console.log(`🏁 HASIL PENGUJIAN BANK SOAL ADMIN: ${passed} LULUS, ${failed} GAGAL`);
  console.log('========================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

testAdminQuestionBanks();
