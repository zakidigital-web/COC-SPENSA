# ⚔️ Clash of Champion — Real-Time Multiplayer Quiz Game

Game kuis edukasi real-time multiplayer berbasis web yang dirancang khusus untuk satu kelas (1 Admin/Guru + **30–40+ Siswa** secara simultan).

---

## 🚀 Fitur Utama & Optimasi Skala 30–40+ Siswa

### 1. 🛡️ Concurrency & Skalabilitas Tinggi (30–40+ Siswa)
- **Atomic Box Locking (Anti Race-Condition)**: Node.js single-threaded event loop dimanfaatkan secara sinkron untuk mengunci kotak pada saat klik pertama. Jika 40 siswa mengklik kotak yang sama pada milidetik yang sama, server secara deterministik memilih 1 pemenang dan menolak 39 lainnya seketika tanpa data corruption.
- **O(1) Player & Question Resolution**: Menggunakan `Map` bidirectional (`socketToPlayer`, `questionMap`) menggantikan pemindaian linier O(n).
- **Throttled Leaderboard Broadcast (300ms Debounce)**: Mencegah *broadcast storm* saat puluhan siswa mengirimkan jawaban hampir bersamaan.
- **Leaderboard Dirty Caching**: Peringkat hanya diurutkan ulang saat skor berubah.
- **Emote & Claim Rate Limiter**: Pembatasan request claim (cooldown 500ms) dan emote (1x/2 detik) dengan antrean visual (max 5 emote tampil bersamaan) agar layar tidak *lag*.
- **DOM Diffing & Element Reuse**: Update DOM client dilakukan secara granular tanpa me-render ulang seluruh halaman grid atau daftar klasemen.

### 2. 👨‍🏫 Panel Admin (Guru) & Upload Template Excel / Word
- **Room Code**: PIN 6 digit unik per sesi game.
- **Upload Soal Excel (.xlsx / .csv) & Word (.docx)**:
  - Guru dapat menyiapkan puluhan soal sekaligus menggunakan template Excel atau Word resmi.
  - Fitur **Drag & Drop** file atau **Tempel Teks Soal langsung dari Word**.
  - Pilihan mode: **Ganti Semua Soal** atau **Tambahkan ke Daftar Soal**.
  - Dilengkapi **Tabel Pratinjau (Preview)** sebelum soal diterapkan ke permainan.
- **Unduh Template Resmi Otomatis**:
  - `GET /api/template/excel` → mengunduh `template_soal_clash_of_champion.xlsx` yang sudah terformat rapi dengan 2 sheet (Soal Kuis & Panduan).
  - `GET /api/template/word` → mengunduh `template_soal_clash_of_champion.docx` lengkap dengan contoh soal 4 tipe.
- **Kelola Soal Dinamis**:
  - **Pilihan Ganda (4 Opsi)**
  - **Benar / Salah**
  - **Menjodohkan (Matching)**
  - **Isian Singkat**
  - Fitur **Acak Nilai Poin** & input manual satu per satu.
- **Live Monitor**:
  - Grid status kotak (Tersedia, Terkunci oleh Siswa, Selesai Benar/Salah).
  - Activity Feed real-time (mencatat aktivitas siswa mengambil dan menjawab kotak).
  - Filter pencarian siswa & statistik kelas real-time.
  - Tombol **Jeda (Pause)**, **Lanjut (Resume)**, dan **Akhiri Game**.

### 3. 🎨 SpriteGen — Procedural Champion & Battle Animation System
- **Generator Karakter Pixel-Art (8 Kelas RPG)**:
  - ⚔️ **Ksatria (Knight)**: Zirah baja, helm berpelindung, pedang lebar & tameng.
  - 🔮 **Penyihir (Mage)**: Jubah mistis, topi penyihir, tongkat sihir bertabur permata.
  - 🏹 **Pemanah (Archer)**: Tudung pemburu, tunik kulit, busur panah melengkung.
  - 🥷 **Ninja**: Topeng rahasia, ikat kepala shinobi, belati kembar kunai.
  - 🛡️ **Paladin**: Mahkota suci bersayap, zirah emas, palu penghukum.
  - ⚡ **Cyberpunk**: Helm visor neon futuristik, pedang energi plasma.
  - 🐾 **Beastmaster**: Tanduk buas, jubah bulu serigala, sarung tangan cakar.
  - 🧪 **Alkemis (Alchemist)**: Kacamata goggle, labu ramuan peledak.
- **8 Tema Elemen & Warna**: Emas Juara, Api Membara, Es Abadi, Bayangan Ungu, Penjaga Rimba, Neon Siber, Merah Satria, dan Kristal Mistis.
- **5 State Animasi Interaktif**:
  - `idle`: Animasi bernapas dan pantulan senjata retro halus.
  - `attack`: Menerjang maju saat mengunci/menyerang kotak soal!
  - `victory`: Melompat gembira dengan senjata terangkat dan ledakan bintang saat menjawab benar!
  - `hurt`: Terpukul mundur dengan ekspresi pusing saat jawaban salah atau sisa waktu <= 5 detik!
  - `combo`: Aura api menyala berkobar di sekeliling sprite saat streak >= 3!
- **Integrasi Live Seluruh Game**:
  - **Papan Kotak**: Mini sprite pemain muncul di kotak yang sedang dikerjakan.
  - **Modal Soal**: Sprite hero berdiri di samping timer dan bereaksi saat menjawab.
  - **Klasemen Live**: Sprite champion mendampingi nama pemain lengkap dengan mahkota juara 1.
  - **Podium Akhir**: Juara 1, 2, dan 3 berpose selebrasi kemenangan dengan sprite resolusi tinggi.

### 4. 🎓 Pengalaman Siswa
- **Join Interaktif**: Kustomisasi Champion Sprite langsung di lobi atau gunakan generator acak (🎲 *Acak Champion*).
- **Papan Kotak Reaktif**: Tampilan nomor kotak dan nilai poin dengan indikator animasi.
- **Anti-Cheat Authoritative**: Kunci jawaban tidak pernah dikirim ke browser siswa sebelum atau sesudah mengunci kotak.
- **Gamifikasi Lengkap**:
  - **Bonus Kecepatan**: Menjawab lebih cepat mendapat bonus proporsional waktu.
  - **Combo Streak**: Efek api "COMBO x3!", "COMBO x5!" dengan pengganda skor.
  - **Reaksi Emote Mengambang**: 👏 😂 😱 🔥 lengkap dengan sprite karakter yang bersorak.
  - **Audio Web API**: Efek suara interaktif tanpa file eksternal (dengan penyimpanan mute di LocalStorage).
  - **Reconnect Otomatis**: Jika siswa me-refresh browser atau koneksi terputus, sesi dipulihkan otomatis.
- **Podium & Gelar di Akhir Game**:
  - Podium 3D peringkat 1–3 dengan tarian kemenangan sprite + hujan konfeti.
  - Gelar penghargaan: *Sniper Cepat*, *Raja Poin*, *Penjelajah*, *Si Akurat*.

---

## 📦 Instalasi & Cara Menjalankan

### Persyaratan
- Node.js (v18+)
- npm

### 1. Jalankan Server
```bash
cd /home/darkverst/Work/fire
npm install
npm start
```
Server akan aktif di: **`http://localhost:3000`**

### 2. Akses Aplikasi
- **Guru / Admin**: Buka `http://localhost:3000/admin.html` (atau klik "Buat Room" di halaman utama).
- **Siswa**: Buka `http://localhost:3000` lalu masukkan PIN room, nama, dan avatar.

---

## 🧪 Pengujian Otomatis (Unit & Stress Test)

Tersedia skrip pengujian bawaan:

```bash
# 1. Integration Test Standar (15 Siswa)
npm test

# 2. Extreme Stress Benchmark (40 Siswa Simultan)
npm run test:stress
```

### Hasil Benchmark 40 Siswa Simultan
- **41 Socket Connection**: 158 ms total (~4 ms/socket)
- **Mass Join 40 Siswa**: 42 ms total (~1.1 ms/siswa)
- **40-Way Atomic Contention**: 1 pemenang, 39 ditolak dengan bersih tanpa corrupt
- **38 Parallel Answer Submissions**: Validasi server 100% konsisten
- **Leaderboard Calculation**: Real-time dengan sorting O(n log n) di-cache

---

## 📂 Struktur Direktori

```
fire/
├── game/
│   ├── GameEngine.js      # State machine, atomic lock, scoring, leaderboard cache
│   └── RoomManager.js     # O(1) socket-player mapping, room lifecycle, PIN generator
├── public/
│   ├── css/
│   │   └── style.css      # Tema game playful, responsif desktop & smartphone
│   ├── js/
│   │   ├── admin.js       # Kontrol dashboard guru, monitor grid, import JSON
│   │   ├── game.js        # Game loop siswa, DOM diffing, timer, emote queue
│   │   ├── join.js        # Validasi PIN 6-digit & pemilihan avatar
│   │   ├── results.js     # Animasi podium, konfeti, statistik akhir
│   │   └── sounds.js      # Web Audio API sound synthesizer & mute toggle
│   ├── admin.html         # Halaman guru
│   ├── game.html          # Arena permainan siswa
│   ├── index.html         # Halaman lobby / join
│   └── results.html       # Halaman podium & klasemen akhir
├── test-40-students.js    # Benchmark stress test 40 concurrent students
├── test-integration.js    # Integration test suite
├── package.json
└── server.js              # Express HTTP & Socket.io server teroptimasi
```
