# Dompetku

Pencatatan keuangan pribadi yang terhubung ke Telegram, dengan dashboard PWA yang bisa dipasang di HP maupun laptop.

- Catat transaksi dengan pesan biasa: `makan siang 25rb`, `gaji 5jt`, `transfer 100rb dari Tunai ke Rekening`.
- Dashboard berisi saldo semua dompet, arus kas harian, komposisi kategori, anggaran bulanan, dan riwayat transaksi.
- Bot bisa mengingatkan saat anggaran mendekati atau melewati batas.
- Ekspor CSV, Excel, dan backup JSON.
- Tema terang/gelap, tampilan responsif untuk HP dan laptop, serta bisa dipasang seperti aplikasi (PWA).

## Isi proyek

```
src/            server Express, bot Telegraf, service, dan REST API
public/         dashboard PWA (HTML, CSS, JS tanpa build step)
ops/keepalive/  Cloudflare Worker cron agar Render tetap bangun
scripts/        generator ikon dan data demo
test/           unit test
```

## Menjalankan di komputer

1. Pastikan Node.js 22 atau lebih baru terpasang.
2. Salin `.env.example` menjadi `.env`, lalu isi minimal `APP_PASSCODE`.
3. Jalankan:

```bash
npm install
npm run dev
```

Buka `http://localhost:3000` dan masuk dengan kode akses dari `.env`.

Tanpa `DATABASE_URL`, data disimpan lokal di `./data/pglite` (Postgres ringan berbasis WASM). Cocok untuk mencoba tanpa instalasi database apa pun.

Ingin data contoh untuk melihat tampilan penuh? Jalankan sekali saat database masih kosong:

```bash
npm run seed:demo
```

> Perintah ini sengaja berhenti jika sudah ada transaksi, supaya data asli tidak tertimpa.

## Menghubungkan bot Telegram

1. Buka **@BotFather** di Telegram, kirim `/newbot`, pilih nama dan username.
2. Buka dashboard Dompetku → **Pengaturan → Bot Telegram**, tempel token dari BotFather, lalu tekan **Simpan & hubungkan**. Token disimpan terenkripsi dan bot langsung aktif tanpa restart.
3. Buka bot kamu dan kirim `/start`. Chat pertama yang memulai bot otomatis menjadi pemilik; chat lain akan ditolak.
4. Setelah tertaut, tombol **menu** muncul di kiri kolom chat (atau ketik `/menu`). Coba kirim `kopi 25rb`; bot menampilkan draft, tekan **Simpan**.

Token juga masih bisa diisi lewat variabel `TELEGRAM_BOT_TOKEN` bila ingin dikelola dari server. Token yang disimpan dari dashboard dipakai lebih dulu.

Perintah bot:

| Perintah | Fungsi |
| --- | --- |
| `/start` | Menautkan chat dan membuka menu |
| `/menu` | Membuka menu tombol |
| `/saldo` | Saldo semua dompet |
| `/laporan` atau `/laporan 2026-10` | Ringkasan bulan ini atau bulan tertentu |
| `/anggaran` | Status anggaran bulan ini |
| `/kategori` | Daftar kategori beserta kata kunci |
| `/batal` | Membatalkan draft yang belum disimpan |
| `/backup` | Mengirim file backup JSON sekarang |
| `/help` | Bantuan |

Contoh pesan:

```
makan siang 25rb
gaji 8500000
transfer 750rb dari Rekening ke E-Wallet
bensin 30rb kemarin
obat 85rb Rekening
```

Bot menebak jenis, kategori, dompet, dan tanggal dari pesan. Kalau tebakan keliru, gunakan tombol pada draft untuk mengganti kategori/dompet sebelum menyimpan.

## Online dan bisa diakses dari HP

Bagian ini membuat aplikasi berjalan 24 jam dan bisa dibuka dari HP maupun laptop.

### 1. Database gratis di Neon

1. Daftar di [neon.tech](https://neon.tech) dan buat project.
2. Di dashboard Neon, buka **Connect** dan salin connection string (pilih *Pooled connection*).
3. Simpan string tersebut, nanti dipakai sebagai `DATABASE_URL`.

### 2. Kode di GitHub

1. Buat repository baru di GitHub (boleh private).
2. Unggah proyek ini. Jangan mengunggah `.env`; berkas itu sudah diabaikan lewat `.gitignore`.

### 3. Deploy di Render

Cara tercepat memakai blueprint `render.yaml` yang sudah ada di repo:

1. Buka [dashboard.render.com](https://dashboard.render.com), pilih **New → Blueprint**.
2. Hubungkan repository GitHub Dompetku. Render membaca `render.yaml` secara otomatis.
3. Saat diminta, isi dua nilai:
   - `APP_PASSCODE`: kode akses rahasia kamu (jangan pakai `dompetku`).
   - `DATABASE_URL`: connection string Neon dari langkah 1.
   `SESSION_SECRET` dan `WEBHOOK_SECRET` dibuat otomatis oleh Render.
4. Klik **Apply / Deploy** dan tunggu sampai status **Live**.
5. Buka alamat Render (`https://nama-service.onrender.com`), masuk dengan `APP_PASSCODE`.
6. Tempel token bot di **Pengaturan → Bot Telegram**, lalu kirim `/start` ke bot kamu.

Alamat publik dibaca otomatis dari `RENDER_EXTERNAL_URL`, jadi `PUBLIC_URL` tidak perlu diisi saat deploy lewat Render. Token bot juga tidak perlu environment variable karena bisa ditempel dari dashboard.

Bila memilih **New → Web Service** secara manual:

| Variable | Nilai |
| --- | --- |
| `APP_PASSCODE` | kode akses rahasia kamu |
| `SESSION_SECRET` | hasil `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DATABASE_URL` | connection string Neon |
| `WEBHOOK_SECRET` | string acak |
| `TZ` | `Asia/Jakarta` |

Build Command `npm install`, Start Command `npm start`, Plan Free.

Catatan:

- Render free tidur setelah tidak dipakai. Permintaan pertama bisa lambat beberapa detik; bot akan bangun sendiri saat ada pesan. Langkah 4 menjaga server tetap bangun tanpa biaya.
- Disk Render free bersifat sementara, karena itu database wajib memakai Neon. Data tidak hilang saat redeploy.
- Kalau alamat publik tidak terdeteksi, isi `PUBLIC_URL` secara manual agar bot memakai webhook. Tanpa itu bot memakai polling.

### 4. Jaga server tetap bangun (keep-alive gratis)

Render free tidur setelah 15 menit tanpa permintaan. Cron gratis di Cloudflare Workers memanggil `/api/health` tiap 10 menit supaya server dan bot tetap siaga.

1. Daftar gratis di [dash.cloudflare.com](https://dash.cloudflare.com) (tidak perlu kartu kredit).
2. Buka `ops/keepalive/wrangler.toml`, ganti `APP_URL` dengan alamat Render kamu.
3. Dari folder proyek jalankan:

   ```bash
   cd ops/keepalive
   npx wrangler login
   npx wrangler deploy
   ```

4. Buka alamat worker yang muncul di browser. Hasilnya `{"ok":true,...}` dan berisi alamat Render yang dipanggil.
5. Pantau tiap ping dengan `npx wrangler tail`.

Worker tidak menyimpan secret karena hanya membaca endpoint health yang memang publik. Batas gratis Cloudflare (100.000 permintaan/hari) jauh di atas kebutuhan ini.

Alternatif tanpa kode: buat monitor HTTP gratis di [uptimerobot.com](https://uptimerobot.com) ke `https://alamat-render-kamu/api/health` setiap 5 menit.

### 5. Pasang di HP dan laptop

Instalasi hanya bisa dari alamat **HTTPS** (alamat Render sudah otomatis HTTPS). Tombol pasang juga tersedia di **Pengaturan → Pasang di HP & laptop** dengan panduan sesuai perangkat.

**Android (Chrome)**

1. Buka alamat Render di Chrome.
2. Ketuk menu **⋮ → Instal aplikasi** (atau **Tambahkan ke layar utama**).

**iPhone/iPad (Safari)**

1. Buka alamat Render di Safari — Chrome di iOS belum bisa memasang PWA.
2. Ketuk **Bagikan → Tambahkan ke Layar Utama → Tambah**.

**Laptop (Chrome/Edge)**

1. Buka alamat Render di Chrome atau Edge.
2. Klik ikon instal di address bar, atau menu **⋮ → Instal Dompetku**. Di Edge: menu **… → Aplikasi → Instal situs ini**.
3. Dompetku terbuka di jendela sendiri dan bisa dibuka dari Start menu / Applications.

Dompetku yang sudah terpasang tetap memakai data dan sesi login yang sama di semua perangkat.

## Keamanan

- Dashboard dilindungi kode akses. Sesi disimpan dalam cookie `httpOnly` bertanda tangan HMAC selama 30 hari.
- Percobaan login dibatasi 8 kali per 15 menit per alamat IP.
- Bot hanya menerima pesan dari chat pemilik yang pertama kali mengirim `/start`.
- Semua query memakai parameter, input divalidasi, dan output di-escape sebelum ditampilkan.
- Webhook dilindungi `secret_token` Telegram.
- Ganti `APP_PASSCODE` dan `SESSION_SECRET` sebelum dipakai online. Jangan bagikan `.env`.

## Perintah pengembangan

```bash
npm run dev        # server dengan auto-reload
npm start          # server produksi
npm test           # unit test
npm run icons      # membuat ulang ikon PNG dari SVG
npm run seed:demo  # data contoh (hanya bila database kosong)
```

## Backup otomatis

- Setiap 7 hari bot mengirim file `dompetku-backup-YYYY-MM-DD.json` ke chat pemilik. Isinya seluruh dompet, kategori, transaksi, dan anggaran.
- Penjadwalan dicek tiap 15 menit dan memakai penanda `backup_last_sent_at` di database, jadi backup tidak terkirim dobel walau server restart. Backup pertama terkirim begitu bot sudah tertaut.
- Kirim `/backup` kapan saja untuk meminta file backup langsung.
- Ubah jarak backup lewat `BACKUP_INTERVAL_DAYS` (mis. `30`).
- Simpan file backup di luar HP (Google Drive, laptop, dsb.). Isinya JSON mentah untuk arsip; pemulihan masih manual.

## Ekspor data

Di menu **Pengaturan** tersedia:

- **Excel (.xlsx)** — daftar transaksi dan ringkasan per kategori.
- **CSV** — bisa dibuka di Excel atau Google Sheets.
- **Backup JSON** — seluruh data mentah untuk arsip.

Ekspor dari menu pengaturan mencakup semua transaksi. Untuk mengekspor satu bulan, tambahkan `?month=YYYY-MM` pada tautan, misalnya `/api/export/xlsx?month=2026-11` setelah login.
