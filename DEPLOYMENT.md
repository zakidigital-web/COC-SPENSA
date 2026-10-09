# 🚀 Panduan Deployment Clash of Champion (Production Ready)

Aplikasi **Clash of Champion** menggunakan arsitektur **Node.js + WebSockets (`socket.io`) + SQLite WAL**, yang membutuhkan server persisten untuk menjamin koneksi multiplayer stabil tanpa putus (*sub-5ms real-time response*).

Berikut adalah panduan lengkap cara mempublikasikan (*deploy*) aplikasi ke internet dengan mudah, cepat, dan optimal.

---

## 🌟 Ringkasan Opsi Platform Hosting Terbaik

| Platform | Kemudahan | Biaya | WebSocket Support | Rekomendasi |
| :--- | :---: | :---: | :---: | :--- |
| **Railway.app** | ⭐⭐⭐⭐⭐ (Sangat Mudah) | Gratis trial / ~$5 bln | ✅ Native 100% | **Paling Direkomendasikan** (1-klik dari GitHub) |
| **Render.com** | ⭐⭐⭐⭐ (Mudah) | Gratis / $7 bln disk | ✅ Native 100% | Bagus untuk pemula (tersedia `render.yaml`) |
| **Fly.io** | ⭐⭐⭐⭐ (Cepat) | Pay-as-you-go | ✅ Native (Region Singapore `sin`) | Latensi terendah untuk siswa di Indonesia |
| **VPS / Cloud (DigitalOcean, Hetzner, AWS)** | ⭐⭐⭐ (Fleksibel) | $4 - $6 bln | ✅ Full Control | Menggunakan Docker / Docker Compose |

---

## 1. 🥇 Cara Deploy ke Railway (Paling Cepat & Mudah)

Railway adalah platform termudah untuk Node.js + WebSocket:

1. Buat akun di [Railway.app](https://railway.app/) (bisa login dengan akun GitHub).
2. Unggah/Push repositori kode proyek ini ke akun GitHub Anda.
3. Di dashboard Railway:
   - Klik **"New Project"** → pilih **"Deploy from GitHub repo"**.
   - Pilih repositori kuis ini.
4. Railway akan otomatis mendeteksi file [`Dockerfile`](file:///home/darkverst/Work/fire/Dockerfile) atau [`railway.json`](file:///home/darkverst/Work/fire/railway.json).
5. Tambahkan **Persistent Volume** untuk database SQLite agar data nilai/siswa tidak hilang saat restart:
   - Di tampilan project Railway, klik service aplikasi Anda → buka tab **"Volumes"**.
   - Klik **"Add Volume"** → isi Mount Path: `/app/data`.
6. Klik tab **"Settings"** → pada bagian **Networking**, klik **"Generate Domain"** (misal: `clash-production.up.railway.app`).
7. **Selesai!** Buka link tersebut di browser laptop dan HP siswa.

---

## 2. 🥈 Cara Deploy ke Render.com

Render mendukung file Blueprint [`render.yaml`](file:///home/darkverst/Work/fire/render.yaml) yang sudah disiapkan:

1. Buat akun di [Render.com](https://render.com/).
2. Push repositori ke GitHub.
3. Di dashboard Render:
   - Klik **"New +"** → pilih **"Blueprint"**.
   - Hubungkan repositori GitHub Anda.
   - Render akan otomatis membaca file [`render.yaml`](file:///home/darkverst/Work/fire/render.yaml) yang otomatis menyetel:
     - Runtime: Docker
     - Health check: `/health`
     - Persistent Disk: 1 GB di `/app/data` (agar database tersimpan aman).
4. Klik **"Apply"**.
5. Tunggu proses build selesai (~1-2 menit). Aplikasi Anda langsung live dengan HTTPS gratis (`https://clash-of-champion.onrender.com`).

---

## 3. 🥉 Cara Deploy ke Fly.io (Region Singapore `sin` Terdekat ke Indonesia)

Fly.io menempatkan server sangat dekat dengan siswa Indonesia (Region Singapore):

1. Pasang CLI Fly di komputer:
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```
2. Login:
   ```bash
   fly auth login
   ```
3. Buat volume penyimpanan database:
   ```bash
   fly volumes create clash_data --region sin --size 1
   ```
4. Deploy aplikasi:
   ```bash
   fly deploy
   ```
5. File [`fly.toml`](file:///home/darkverst/Work/fire/fly.toml) yang sudah disediakan akan otomatis mengatur port dan health check.

---

## 4. 🐳 Cara Deploy Mandiri di VPS Linux (Docker / Docker Compose)

Jika Anda memiliki VPS Ubuntu/Debian sendiri (DigitalOcean, Contabo, AWS, Biznet, dll.):

1. Pasang Docker & Docker Compose di VPS:
   ```bash
   sudo apt update && sudo apt install -y docker.io docker-compose
   ```
2. Clone repositori ke VPS:
   ```bash
   git clone <URL_REPO_ANDA> /var/www/clash
   cd /var/www/clash
   ```
3. Jalankan dengan satu perintah:
   ```bash
   docker-compose up -d --build
   ```
4. Aplikasi akan aktif di port `3000`. Anda bisa memasang Nginx Reverse Proxy dan SSL gratis (Certbot/Let's Encrypt) untuk domain sekolah.

---

## 🔍 Endpoint Health Check & Pemantauan

Server telah dilengkapi endpoint status bawaan untuk memantau kesehatan server secara real-time:
- **URL:** `GET /health`
- **Output:**
  ```json
  {
    "status": "ok",
    "uptime": 120,
    "timestamp": 1790598237414,
    "activeRooms": 2
  }
  ```

---

## 🔐 Keamanan & Rekomendasi di Lingkungan Produksi

1. **Reverse Proxy:** Server sudah dilengkapi `app.set('trust proxy', 1);` sehingga aman di belakang Cloudflare atau load balancer.
2. **Graceful Shutdown:** Saat server di-restart atau di-update, server akan menutup koneksi socket secara tertib dan melakukan checkpoint database SQLite tanpa risiko korupsi data.
3. **Penyimpanan Nilai:** Sesi kuis otomatis tersimpan di database `/app/data/clash.db` dan rekap nilai dapat langsung di-download dalam format Excel (.xlsx) oleh guru kapan saja.
