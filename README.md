# CBT Sekolah - Backend API

Backend REST API menggunakan **Express.js**, **TypeScript**, dan **Prisma ORM**.

---

## 📁 Struktur Direktori

```text
Backend/
├── prisma/
│   └── schema.prisma        # Definisi schema database Prisma
├── prisma.config.ts         # Konfigurasi Prisma
├── src/
│   ├── config/
│   │   └── prisma.ts        # Client instance Prisma
│   ├── controllers/
│   │   └── health.controller.ts
│   ├── middlewares/
│   │   └── error.middleware.ts # Handler not-found & internal error
│   ├── routes/
│   │   ├── index.ts         # Router utama (/api)
│   │   └── health.routes.ts # Endpoint /api/health
│   ├── utils/
│   │   └── password.ts      # Enkripsi & verifikasi password (Argon2)
│   ├── app.ts               # Inisialisasi Express & middleware
│   └── index.ts             # Entry point server
├── .env                     # Environment variables
├── .env.example             # Contoh environment variables
├── package.json
└── tsconfig.json
```

---

## 🚀 Cara Menjalankan

### 1. Masuk ke folder Backend
```bash
cd Backend
```

### 2. Instal dependensi
```bash
npm install
```

### 3. Konfigurasi Environment Variable
Salin `.env.example` ke `.env` dan sesuaikan koneksi database PostgreSQL Anda:
```env
PORT=5000
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/DBNAME?schema=public"
```

### 4. Prisma Setup
- **Generate Client**:
  ```bash
  npm run prisma:generate
  ```
- **Migrasi Database**:
  ```bash
  npm run prisma:migrate
  ```
- **Buka Prisma Studio**:
  ```bash
  npm run prisma:studio
  ```

### 5. Menjalankan Server
- **Mode Development (Hot-reload)**:
  ```bash
  npm run dev
  ```
- **Mode Production**:
  ```bash
  npm run build
  npm run start
  ```

---

## 📡 Endpoint Awal

| Method | Endpoint | Keterangan |
| :--- | :--- | :--- |
| `GET` | `/` | Pesan selamat datang & info API |
| `GET` | `/api/health` | Health check status server |
