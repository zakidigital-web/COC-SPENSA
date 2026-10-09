# 🚀 Clash of Champion - Vercel Serverless Edition

Sub-folder ini berisi versi khusus **Clash of Champion** yang telah dioptimasi 100% agar dapat di-deploy ke **Vercel** tanpa error.

---

## 🛠️ Optimasi Khusus untuk Vercel:
1. **Database Pure JavaScript (`/tmp` Storage)**:
   - Menghapus dependensi native C++ (`better-sqlite3`) yang sering gagal kompilasi di lingkungan serverless AWS/Vercel.
   - Menggunakan penyimpanan data berbasis `/tmp/clash_store.json` murni JavaScript yang aman, cepat, dan otomatis menginisialisasi akun default (*Admin*, *Guru*, dan *Siswa*).
2. **Socket.io Serverless Polling**:
   - Mendukung transportasi `polling` HTTP yang kompatibel dengan arsitektur serverless Vercel.
3. **Struktur Standar Vercel**:
   - `api/index.js`: Serverless entry point untuk routing Express & WebSocket Engine.
   - `vercel.json`: Konfigurasi routing bawaan Vercel.
   - `public/`: Semua aset frontend (HTML, CSS, JS 3D Scene).

---

## 📦 Cara Deploy ke Vercel (Paling Mudah):

### Metode 1: Lewat Dashboard Vercel (Rekomendasi)
1. Buka [**vercel.com/new**](https://vercel.com/new).
2. Hubungkan repositori GitHub Anda (**`zakidigital-web/COC-SPENSA`**).
3. ⚠️ **PENTING**: Pada bagian **Root Directory**, klik tombol **Edit**:
   - Ketik atau pilih folder: **`vercel`**
   - Klik **Continue**.
4. Klik tombol **Deploy**.
5. Tunggu 1–2 menit hingga build selesai. Aplikasi Anda langsung aktif dengan domain `.vercel.app`!

---

### Metode 2: Lewat Vercel CLI (Terminal)
Jika Anda memiliki Vercel CLI di komputer:
```bash
cd vercel
npx vercel
```
Ikuti instruksi di layar, pilih deploy default, dan proyek akan langsung ter-deploy.

---

## 🔑 Akun Default:
- **Admin**: Username: `admin` | Password: `admin123`
- **Guru**: Username: `guru` | Password: `guru123`
- **Siswa**: NIS `1001` - `1005` | Password: `123`
