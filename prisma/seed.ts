import "dotenv/config";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";

async function main() {
  console.log("🧹 [Seed] Membersihkan seluruh data lama & dummy di Neon PostgreSQL...");

  // 1. Bersihkan seluruh data lama
  await prisma.jawabanSiswa.deleteMany();
  await prisma.sesiUjian.deleteMany();
  await prisma.ujianKelas.deleteMany();
  await prisma.ujian.deleteMany();
  await prisma.pilihanJawaban.deleteMany();
  await prisma.soal.deleteMany();
  await prisma.bankSoal.deleteMany();
  await prisma.mataPelajaran.deleteMany();
  await prisma.siswaProfile.deleteMany();
  await prisma.guruProfile.deleteMany();
  await prisma.user.deleteMany();
  await prisma.kelas.deleteMany();

  // 2. Buat Data Kelas Dasar
  const kelas1 = await prisma.kelas.create({
    data: {
      nama: "XII MIPA 1",
      tingkat: 12,
      jurusan: "MIPA",
    },
  });

  const kelas2 = await prisma.kelas.create({
    data: {
      nama: "XII MIPA 2",
      tingkat: 12,
      jurusan: "MIPA",
    },
  });

  console.log("✅ Data Kelas dasar dibuat:", kelas1.nama, kelas2.nama);

  // 3. Buat Akun Admin & Guru
  const adminPassword = await hashPassword("admin123");
  const widodoPassword = await hashPassword("Widodo1123");
  const guruPassword = await hashPassword("guru123");

  await prisma.user.create({
    data: {
      username: "admin",
      nama: "Administrator Sekolah",
      email: "admin@sekolah.sch.id",
      password: adminPassword,
      role: "ADMIN",
    },
  });

  await prisma.user.create({
    data: {
      username: "Widodo",
      nama: "Widodo",
      password: widodoPassword,
      role: "ADMIN",
    },
  });

  const guruUser = await prisma.user.create({
    data: {
      username: "guru",
      nama: "Guru Pendidikan Pancasila",
      email: "guru@sekolah.sch.id",
      password: guruPassword,
      role: "GURU",
      guruProfile: {
        create: {
          nip: "198501012010011002",
        },
      },
    },
  });

  console.log("✅ Akun Admin & Guru dibuat");

  // 4. Buat Mata Pelajaran, Bank Soal, dan Paket Ujian: Pendidikan Pancasila
  const mapelPancasila = await prisma.mataPelajaran.create({
    data: {
      kode: "PAN-XII",
      nama: "Pendidikan Pancasila XII",
    },
  });

  const bankSoalPancasila = await prisma.bankSoal.create({
    data: {
      kode: "BS-PAN-01",
      judul: "Bank Soal Pendidikan Pancasila XII — PAS Semester Ganjil",
      deskripsi: "Paket soal ideologi negara, konstitusi, dan hak asasi manusia",
      mapelId: mapelPancasila.id,
      pembuatId: guruUser.id,
    },
  });

  // 5. Buat Paket Ujian Pendidikan Pancasila Aktif
  const now = new Date();
  const endTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  await prisma.ujian.create({
    data: {
      judul: "Penilaian Akhir Semester (PAS) — Pendidikan Pancasila XII",
      deskripsi: "Ujian Akhir Semester Pendidikan Pancasila Kurikulum Merdeka",
      mapelId: mapelPancasila.id,
      bankSoalId: bankSoalPancasila.id,
      token: "PAN-2026",
      durasiMenit: 90,
      kkm: 75.0,
      waktuMulai: now,
      waktuSelesai: endTime,
      acakSoal: true,
      acakOpsi: true,
      tampilkanNilai: true,
      status: "AKTIF",
      targetKelas: {
        create: [
          { kelasId: kelas1.id },
          { kelasId: kelas2.id },
        ],
      },
    },
  });

  console.log("✅ Paket Ujian Pendidikan Pancasila XII (Token: PAN-2026) siap!");
  console.log("🎉 Database bersih dari data dummy!");
}

main()
  .catch((e) => {
    console.error("❌ Error Seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
