import { db } from './index.js';

export const DEFAULT_ACCOUNTS = [
  { name: 'Tunai', type: 'cash', icon: 'banknote', color: '#0f9d76', initial_balance: 0, sort: 0 },
  { name: 'Rekening', type: 'bank', icon: 'bank', color: '#3b82f6', initial_balance: 0, sort: 1 },
  { name: 'E-Wallet', type: 'ewallet', icon: 'phone', color: '#8b5cf6', initial_balance: 0, sort: 2 },
];

export const DEFAULT_CATEGORIES = [
  {
    name: 'Makan & Minum', kind: 'expense', icon: 'food', color: '#f97316', sort: 0,
    keywords: 'makan,minum,nasi,kopi,jajan,snack,resto,restoran,warung,bakso,ayam,sate,gofood,grabfood,shopeefood,kafe,cafe,roti,susu,teh,cemilan,sarapan,makan siang,makan malam',
  },
  {
    name: 'Transportasi', kind: 'expense', icon: 'car', color: '#0ea5e9', sort: 1,
    keywords: 'bensin,bbm,ojol,gojek,grab,taksi,parkir,tol,tiket,krl,mrt,lrt,angkot,bus,travel,transport,servis,motor,mobil,ojek',
  },
  {
    name: 'Belanja', kind: 'expense', icon: 'shopping-bag', color: '#ec4899', sort: 2,
    keywords: 'belanja,indomaret,alfamart,supermarket,shopee,tokopedia,lazada,baju,sepatu,minimarket,online,skincare',
  },
  {
    name: 'Tagihan & Utilitas', kind: 'expense', icon: 'receipt', color: '#64748b', sort: 3,
    keywords: 'listrik,token,air,pdam,internet,wifi,pulsa,paket data,kos,sewa,bpjs,asuransi,iuran,langganan,tagihan',
  },
  {
    name: 'Kesehatan', kind: 'expense', icon: 'heart-pulse', color: '#ef4444', sort: 4,
    keywords: 'obat,dokter,klinik,rumah sakit,rs,vitamin,apotek,gym,olahraga,fitness',
  },
  {
    name: 'Hiburan', kind: 'expense', icon: 'gamepad', color: '#a855f7', sort: 5,
    keywords: 'nonton,bioskop,game,spotify,netflix,youtube,liburan,traveling,rekreasi,konser,hiburan',
  },
  {
    name: 'Pendidikan', kind: 'expense', icon: 'book', color: '#14b8a6', sort: 6,
    keywords: 'buku,kursus,sekolah,kuliah,les,workshop,seminar,pendidikan',
  },
  {
    name: 'Rumah Tangga', kind: 'expense', icon: 'home', color: '#eab308', sort: 7,
    keywords: 'sabun,sampo,odol,galon,gas,laundry,perbaikan,perabot,dapur',
  },
  {
    name: 'Lain-lain', kind: 'expense', icon: 'box', color: '#94a3b8', sort: 8,
    keywords: 'lain,lainnya,donasi,sedekah,zakat,hadiah,uang',
  },
  {
    name: 'Gaji', kind: 'income', icon: 'banknote', color: '#10b981', sort: 0,
    keywords: 'gaji,payroll,salary,upah',
  },
  {
    name: 'Bonus & Tunjangan', kind: 'income', icon: 'gift', color: '#22c55e', sort: 1,
    keywords: 'bonus,thr,tunjangan,komisi,insentif',
  },
  {
    name: 'Investasi', kind: 'income', icon: 'trending-up', color: '#06b6d4', sort: 2,
    keywords: 'dividen,bunga,reksadana,saham,crypto,profit,capital gain',
  },
  {
    name: 'Pemasukan Lain', kind: 'income', icon: 'coins', color: '#84cc16', sort: 3,
    keywords: 'masuk,terima,diterima,jual,refund,cashback,hadiah,utang dibayar',
  },
];

export async function ensureSeed() {
  const accounts = await db.query('SELECT count(*)::int AS c FROM accounts');
  if (accounts.rows[0].c === 0) {
    for (const account of DEFAULT_ACCOUNTS) {
      await db.query(
        `INSERT INTO accounts (name, type, initial_balance, color, icon, sort)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [account.name, account.type, account.initial_balance, account.color, account.icon, account.sort],
      );
    }
  }

  const categories = await db.query('SELECT count(*)::int AS c FROM categories');
  if (categories.rows[0].c === 0) {
    for (const category of DEFAULT_CATEGORIES) {
      await db.query(
        `INSERT INTO categories (name, kind, icon, color, keywords, sort)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [category.name, category.kind, category.icon, category.color, category.keywords, category.sort],
      );
    }
  }

  const defaultAccount = await db.query(`SELECT value FROM settings WHERE key = 'default_account_id'`);
  if (defaultAccount.rows.length === 0) {
    const first = await db.query('SELECT id FROM accounts ORDER BY sort, id LIMIT 1');
    if (first.rows.length > 0) {
      await db.query(
        `INSERT INTO settings (key, value) VALUES ('default_account_id', $1)
         ON CONFLICT (key) DO NOTHING`,
        [String(first.rows[0].id)],
      );
    }
  }
}
