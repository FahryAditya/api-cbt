import "dotenv/config";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/password";

async function main() {
  console.log("🌱 [Seed] Memulai seeding database resmi ke Neon PostgreSQL...");

  // 1. Bersihkan data lama jika ada
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

  // 2. Buat Data Kelas
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

  console.log("✅ Data Kelas dibuat:", kelas1.nama, kelas2.nama);

  // 3. Buat Akun Pengguna
  const adminPassword = await hashPassword("admin123");
  const guruPassword = await hashPassword("guru123");
  const siswaPassword = await hashPassword("siswa123");

  // Admin
  const adminUser = await prisma.user.create({
    data: {
      username: "admin",
      nama: "Administrator Sekolah",
      email: "admin@sekolah.sch.id",
      password: adminPassword,
      role: "ADMIN",
    },
  });

  // Guru
  const guruUser = await prisma.user.create({
    data: {
      username: "guru",
      nama: "Budi Santoso, S.Pd.",
      email: "budi@sekolah.sch.id",
      password: guruPassword,
      role: "GURU",
      guruProfile: {
        create: {
          nip: "198501012010011002",
        },
      },
    },
  });

  // Siswa 1 (Default Siswa Farhan)
  const siswa1 = await prisma.user.create({
    data: {
      username: "210401889",
      nama: "Muhammad Farhan Pratama",
      password: siswaPassword,
      role: "SISWA",
      siswaProfile: {
        create: {
          nisn: "210401889",
          kelasId: kelas1.id,
          jenisKelamin: "LAKI_LAKI",
        },
      },
    },
  });

  // Siswa 2 (Bunga Citra Lestari)
  const siswa2 = await prisma.user.create({
    data: {
      username: "210402",
      nama: "Bunga Citra Lestari",
      password: siswaPassword,
      role: "SISWA",
      siswaProfile: {
        create: {
          nisn: "210402",
          kelasId: kelas1.id,
          jenisKelamin: "PEREMPUAN",
        },
      },
    },
  });

  // Siswa 3 (Dimas Anggara)
  const siswa3 = await prisma.user.create({
    data: {
      username: "210403",
      nama: "Dimas Anggara",
      password: siswaPassword,
      role: "SISWA",
      siswaProfile: {
        create: {
          nisn: "210403",
          kelasId: kelas2.id,
          jenisKelamin: "LAKI_LAKI",
        },
      },
    },
  });

  console.log("✅ Data Pengguna (Admin, Guru, Siswa) berhasil dibuat");

  // 4. Buat Mata Pelajaran
  const mapel = await prisma.mataPelajaran.create({
    data: {
      kode: "MAT-XII",
      nama: "Matematika Wajib XII",
    },
  });

  // 5. Buat Bank Soal
  const bankSoal = await prisma.bankSoal.create({
    data: {
      kode: "BS-MAT-01",
      judul: "Bank Soal Matematika Wajib XII — PAS Genap",
      deskripsi: "Paket soal geometri, kalkulus, dan trigonometri",
      mapelId: mapel.id,
      pembuatId: guruUser.id,
    },
  });

  // 6. Buat Butir Soal dengan Pilihan Ganda Custom (A - E)
  // Soal 1 (Geometri Segitiga)
  await prisma.soal.create({
    data: {
      bankSoalId: bankSoal.id,
      nomorUrut: 1,
      pertanyaan: "Sebuah segitiga ABC memiliki sudut A = 45°, sudut B = 75°, dan panjang sisi yang berseberangan dengan sudut C adalah 12 cm. Berapakah panjang sisi AB?",
      bobotNilai: 2.5,
      pilihanJawaban: {
        create: [
          { label: "A", teks: "6√2 cm", isKunci: false },
          { label: "B", teks: "3√2 cm", isKunci: true },
          { label: "C", teks: "12√2 cm", isKunci: false },
          { label: "D", teks: "3 cm", isKunci: false },
          { label: "E", teks: "6 cm", isKunci: false },
        ],
      },
    },
  });

  // Soal 2 (Turunan Fungsi)
  await prisma.soal.create({
    data: {
      bankSoalId: bankSoal.id,
      nomorUrut: 2,
      pertanyaan: "Jika fungsi f(x) = 2x³ - 9x² + 12x + 5, tentukan interval di mana grafik f(x) selalu naik!",
      bobotNilai: 2.5,
      pilihanJawaban: {
        create: [
          { label: "A", teks: "x < 1 atau x > 2", isKunci: true },
          { label: "B", teks: "1 < x < 2", isKunci: false },
          { label: "C", teks: "x < -2 atau x > -1", isKunci: false },
          { label: "D", teks: "-2 < x < 1", isKunci: false },
          { label: "E", teks: "Semua nilai real x", isKunci: false },
        ],
      },
    },
  });

  console.log("✅ Bank Soal & Butir Soal Pilihan Ganda Custom A-E berhasil dibuat");

  // 7. Buat Paket Ujian Aktif (Matematika)
  const now = new Date();
  const endTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 hari ke depan

  const ujian = await prisma.ujian.create({
    data: {
      judul: "Penilaian Akhir Semester (PAS) — Matematika Wajib XII",
      deskripsi: "Ujian Penilaian Akhir Semester berbasis komputer SMA Negeri 1",
      mapelId: mapel.id,
      bankSoalId: bankSoal.id,
      token: "MAT-8492",
      durasiMenit: 120,
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

  // 7b. Buat Mata Pelajaran, Bank Soal, dan Paket Ujian: Pendidikan Pancasila
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

  // Buat Paket Ujian Pendidikan Pancasila Aktif
  const ujianPancasila = await prisma.ujian.create({
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

  // 8. Buat Sesi Ujian Contoh untuk Siswa (Untuk Rekapitulasi Nilai & ExcelJS)
  // Siswa 2 (Bunga): Selesai, Nilai 95.0 (Tuntas)
  await prisma.sesiUjian.create({
    data: {
      ujianId: ujian.id,
      siswaId: siswa2.id,
      status: "SELESAI",
      waktuMulai: now,
      waktuSelesai: now,
      sisaWaktuDetik: 0,
      nilaiAkhir: 95.0,
      jumlahPelanggaran: 0,
    },
  });

  // Siswa 3 (Dimas): Selesai, Nilai 60.0 (Belum Tuntas / Remedial)
  await prisma.sesiUjian.create({
    data: {
      ujianId: ujian.id,
      siswaId: siswa3.id,
      status: "SELESAI",
      waktuMulai: now,
      waktuSelesai: now,
      sisaWaktuDetik: 0,
      nilaiAkhir: 60.0,
      jumlahPelanggaran: 2,
    },
  });

  // Siswa 1 (Farhan): Sedang Mengerjakan (Active Proctoring)
  await prisma.sesiUjian.create({
    data: {
      ujianId: ujian.id,
      siswaId: siswa1.id,
      status: "SEDANG_MENGERJAKAN",
      waktuMulai: now,
      sisaWaktuDetik: 6620,
      jumlahPelanggaran: 0,
    },
  });

  console.log("✅ Paket Ujian & Sesi Pengerjaan Siswa berhasil dibuat");
  console.log("🎉 Seeding ke NeonDB Selesai!");
}

main()
  .catch((e) => {
    console.error("❌ Error Seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

