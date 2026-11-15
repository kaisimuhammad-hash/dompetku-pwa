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
scripts/        generator ikon dan data demo
test/           unit test parser pesan Telegram
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
2. Salin token yang diberikan ke `TELEGRAM_BOT_TOKEN` di `.env`, lalu restart server.
3. Buka bot kamu dan kirim `/start`. Chat pertama yang memulai bot otomatis menjadi pemilik; chat lain akan ditolak.
4. Coba kirim `kopi 25rb`. Bot menampilkan draft, tekan **Simpan**.

Perintah bot:

| Perintah | Fungsi |
| --- | --- |
| `/start` | Menghubungkan chat dan menampilkan bantuan singkat |
| `/saldo` | Saldo semua dompet |
| `/laporan` atau `/laporan 2026-10` | Ringkasan bulan ini atau bulan tertentu |
| `/anggaran` | Status anggaran bulan ini |
| `/kategori` | Daftar kategori beserta kata kunci |
| `/batal` | Membatalkan draft yang belum disimpan |
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

1. Daftar di [render.com](https://render.com), pilih **New → Web Service**, lalu hubungkan repository GitHub tadi.
2. Isi:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
3. Tambahkan environment variable berikut:

| Variable | Nilai |
| --- | --- |
| `APP_PASSCODE` | kode akses rahasia kamu (jangan pakai `dompetku`) |
| `SESSION_SECRET` | hasil `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DATABASE_URL` | connection string Neon |
| `TELEGRAM_BOT_TOKEN` | token dari BotFather |
| `WEBHOOK_SECRET` | string acak, mis. hasil perintah di atas |
| `PUBLIC_URL` | alamat Render kamu, contoh `https://dompetku.onrender.com` |
| `TZ` | `Asia/Jakarta` |

4. Deploy. Setelah selesai, buka alamat Render tersebut dan masuk dengan `APP_PASSCODE`.
5. Kirim ulang `/start` ke bot bila sebelumnya sudah pernah terhubung di lokal. Bot akan memakai webhook karena `PUBLIC_URL` sudah diisi.

Catatan:

- Render free tidur setelah tidak dipakai. Permintaan pertama bisa lambat beberapa detik; bot akan bangun sendiri saat ada pesan.
- Disk Render free bersifat sementara, karena itu database wajib memakai Neon. Data tidak hilang saat redeploy.
- Kalau `PUBLIC_URL` belum diisi, bot memakai mode polling. Saat online, isi `PUBLIC_URL` agar webhook aktif.

### 4. Pasang di HP dan laptop

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
npm test           # unit test parser
npm run icons      # membuat ulang ikon PNG dari SVG
npm run seed:demo  # data contoh (hanya bila database kosong)
```

## Ekspor data

Di menu **Pengaturan** tersedia:

- **Excel (.xlsx)** — daftar transaksi dan ringkasan per kategori.
- **CSV** — bisa dibuka di Excel atau Google Sheets.
- **Backup JSON** — seluruh data mentah untuk arsip.

Ekspor dari menu pengaturan mencakup semua transaksi. Untuk mengekspor satu bulan, tambahkan `?month=YYYY-MM` pada tautan, misalnya `/api/export/xlsx?month=2026-11` setelah login.
