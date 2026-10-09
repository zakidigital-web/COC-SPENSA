const fs = require('fs');
const path = require('path');

async function testUploadFeatures() {
  console.log('\n🧪 Testing Excel and Word Upload & Template Features...\n');
  let passed = 0, failed = 0;

  function assert(condition, desc) {
    if (condition) {
      console.log(`  ✅ ${desc}`);
      passed++;
    } else {
      console.log(`  ❌ ${desc}`);
      failed++;
    }
  }

  // 1. Download Excel template
  console.log('1. Testing Excel template download...');
  const excelRes = await fetch('http://localhost:3000/api/template/excel');
  assert(excelRes.status === 200, 'Excel template endpoint returned 200 OK');
  const excelBuf = await excelRes.arrayBuffer();
  assert(excelBuf.byteLength > 5000, `Excel template size is valid (${excelBuf.byteLength} bytes)`);

  // 2. Download Word template
  console.log('\n2. Testing Word template download...');
  const wordRes = await fetch('http://localhost:3000/api/template/word');
  assert(wordRes.status === 200, 'Word template endpoint returned 200 OK');
  const wordBuf = await wordRes.arrayBuffer();
  assert(wordBuf.byteLength > 5000, `Word template size is valid (${wordBuf.byteLength} bytes)`);

  // 3. Test uploading Excel template
  console.log('\n3. Testing Excel upload parsing...');
  const excelBlob = new Blob([excelBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const excelForm = new FormData();
  excelForm.append('file', excelBlob, 'template_test.xlsx');

  const excelUploadRes = await fetch('http://localhost:3000/api/upload-questions', {
    method: 'POST',
    body: excelForm
  });
  const excelUploadData = await excelUploadRes.json();
  assert(excelUploadData.success === true, 'Excel upload succeeded');
  assert(excelUploadData.count === 5, `Parsed exactly 5 questions from Excel template (got ${excelUploadData.count})`);

  // 4. Test uploading Word template
  console.log('\n4. Testing Word docx upload parsing...');
  const wordBlob = new Blob([wordBuf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const wordForm = new FormData();
  wordForm.append('file', wordBlob, 'template_test.docx');

  const wordUploadRes = await fetch('http://localhost:3000/api/upload-questions', {
    method: 'POST',
    body: wordForm
  });
  const wordUploadData = await wordUploadRes.json();
  assert(wordUploadData.success === true, 'Word upload succeeded');
  assert(wordUploadData.count === 7, `Parsed exactly 7 questions from Word template (got ${wordUploadData.count})`);

  // 5. Test parsing pasted Word text directly
  console.log('\n5. Testing Pasted Text parsing endpoint...');
  const samplePastedText = `1. [PG] Berapakah 10 + 15?
A. 20
B. 25
C. 30
D. 35
Kunci: B
Poin: 100

2. [BS] Bumi itu datar.
Kunci: Salah
Poin: 150`;

  const pasteRes = await fetch('http://localhost:3000/api/parse-word-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: samplePastedText })
  });
  const pasteData = await pasteRes.json();
  assert(pasteData.success === true, 'Pasted text parsing succeeded');
  assert(pasteData.count === 2, `Parsed 2 questions from pasted text (got ${pasteData.count})`);

  console.log('\n' + '═'.repeat(55));
  console.log(`📊 Upload Feature Test: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(55) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

testUploadFeatures().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
