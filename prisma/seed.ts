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

  // Soal 1 Pancasila
  await prisma.soal.create({
    data: {
      bankSoalId: bankSoalPancasila.id,
      nomorUrut: 1,
      pertanyaan: "Pancasila sebagai dasar negara Indonesia secara yuridis ketatanegaraan tercantum secara resmi dalam...",
      bobotNilai: 20.0,
      pilihanJawaban: {
        create: [
          { label: "A", teks: "Pembukaan UUD NRI Tahun 1945 alinea keempat", isKunci: true },
          { label: "B", teks: "Piagam Jakarta tanggal 22 Juni 1945", isKunci: false },
          { label: "C", teks: "Dekrit Presiden 5 Juli 1959", isKunci: false },
          { label: "D", teks: "Batang Tubuh UUD NRI Tahun 1945", isKunci: false },
        ],
      },
    },
  });

  // Soal 2 Pancasila
  await prisma.soal.create({
    data: {
      bankSoalId: bankSoalPancasila.id,
      nomorUrut: 2,
      pertanyaan: "Sikap positif terhadap nilai-nilai Pancasila terutama sila kedua 'Kemanusiaan yang adil dan beradab' ditunjukkan dengan perilaku...",
      bobotNilai: 20.0,
      pilihanJawaban: {
        create: [
          { label: "A", teks: "Mengembangkan sikap saling mencintai sesama manusia dan tenggang rasa", isKunci: true },
          { label: "B", teks: "Rela berkorban untuk kepentingan golongan tertentu", isKunci: false },
          { label: "C", teks: "Mengutamakan kepentingan pribadi di atas kepentingan umum", isKunci: false },
          { label: "D", teks: "Menolak kerja sama dengan suku atau agama lain", isKunci: false },
        ],
      },
    },
  });

  // Soal 3 Pancasila
  await prisma.soal.create({
    data: {
      bankSoalId: bankSoalPancasila.id,
      nomorUrut: 3,
      pertanyaan: "Tata urutan peraturan perundang-undangan di Indonesia yang menempatkan UUD 1945 pada hierarki tertinggi diatur dalam...",
      bobotNilai: 20.0,
      pilihanJawaban: {
        create: [
          { label: "A", teks: "Undang-Undang Nomor 12 Tahun 2011", isKunci: true },
          { label: "B", teks: "Undang-Undang Nomor 20 Tahun 2003", isKunci: false },
          { label: "C", teks: "Ketetapan MPR Nomor III/MPR/2000", isKunci: false },
          { label: "D", teks: "Undang-Undang Nomor 30 Tahun 2002", isKunci: false },
        ],
      },
    },
  });

  // Soal 4 Pancasila
  await prisma.soal.create({
    data: {
      bankSoalId: bankSoalPancasila.id,
      nomorUrut: 4,
      pertanyaan: "Tradisi gotong royong dalam masyarakat Indonesia merupakan wujud pengamalan nilai Pancasila yang bertujuan untuk...",
      bobotNilai: 20.0,
      pilihanJawaban: {
        create: [
          { label: "A", teks: "Mempererat persatuan dan kesatuan serta meringankan beban bersama", isKunci: true },
          { label: "B", teks: "Menonjolkan perbedaan status sosial ekonomi warga", isKunci: false },
          { label: "C", teks: "Menghindari keterlibatan dalam kegiatan lingkungan", isKunci: false },
          { label: "D", teks: "Memperoleh keuntungan materi pribadi", isKunci: false },
        ],
      },
    },
  });

  // Soal 5 Pancasila
  await prisma.soal.create({
    data: {
      bankSoalId: bankSoalPancasila.id,
      nomorUrut: 5,
      pertanyaan: "Perwujudan sila kelima 'Keadilan sosial bagi seluruh rakyat Indonesia' dalam kehidupan bermasyarakat dicontohkan dengan...",
      bobotNilai: 20.0,
      pilihanJawaban: {
        create: [
          { label: "A", teks: "Menjaga keseimbangan antara hak dan kewajiban serta menghargai karya orang lain", isKunci: true },
          { label: "B", teks: "Gaya hidup konsumtif dan boros", isKunci: false },
          { label: "C", teks: "Memaksakan pendapat pribadi dalam musyawarah", isKunci: false },
          { label: "D", teks: "Mengabaikan peraturan ketertiban umum", isKunci: false },
        ],
      },
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
