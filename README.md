# FaceInsight AI

🌐 [Bahasa](README.md) | **Bahasa Indonesia**

**Analisis wajah lewat foto, langsung di browser. Fotomu tidak pernah diunggah ke mana pun.**

FaceInsight AI adalah web yang membaca fotomu, mengukur proporsi wajah, lalu memberi laporan lengkap: skor, penjelasan tiap penilaian, dan saran perawatan yang bisa langsung dicoba. Semua proses jalan di perangkatmu sendiri. Tidak ada server, tidak ada akun, dan tidak perlu API key.

## Kenapa proyek ini dibuat?

Banyak aplikasi analisis wajah meminta kita mengunggah foto ke server orang lain, dan hasilnya cuma berupa satu angka tanpa penjelasan. Dua hal itu yang mau dijawab FaceInsight AI:

1. **Privasi.** Foto diproses di tab browser dan hilang begitu tab ditutup. Tidak ada endpoint upload sama sekali.
2. **Transparan.** Setiap skor berasal dari pengukuran geometri yang bisa dilacak ke titik tertentu di wajah. Bukan "kotak hitam" yang tahu-tahu mengeluarkan angka.

---

## Fitur utama

- **Scan wajah 478 titik.** Dipetakan otomatis dengan MediaPipe FaceLandmarker dari Google.
- **10 aspek penilaian.** Simetri, golden ratio, bentuk wajah, canthal tilt, harmoni wajah, kualitas kulit, kejernihan kulit, bentuk mata, face fat, dan garis rahang.
- **Analisis area mata yang dirinci.** Skornya tidak cuma satu angka. Kamu bisa lihat bobot tiap bagian (canthal tilt 32%, proyeksi mata 25%, kelopak 28%, alis dan jarak antarmata 15%), jadi jelas bagian mana yang menaikkan atau menurunkan skor.
- **Analisis foto samping (opsional).** Tambahkan foto profil untuk membuka laporan sudut rahang (gonial), ramus, mandibula, proyeksi mata, hidung, dan garis profil.
- **Cek kelayakan foto.** Web mengecek kepercayaan deteksi, pencahayaan, ketajaman, dan arah kepala. Kalau fotonya kurang bagus, kamu diberi tahu, bukan dikasih skor asal-asalan.
- **Potensi dan kekuatan.** Menunjukkan aspek mana yang masih bisa diperbaiki (kulit, lemak wajah, definisi rahang, kelopak mata) dan empat fitur terkuat di wajahmu.
- **Tips yang menyesuaikan hasil.** Saran perawatan dipilih berdasarkan skor yang lemah di fotomu, jadi dua orang berbeda tidak dapat tips yang sama.

---

## Cara pakai

1. **Unggah foto.** Pakai foto yang tajam, terang merata, dan menghadap kamera. Bisa drag & drop atau klik untuk memilih.
2. **Tunggu proses scan.** Titik-titik wajah dideteksi dan diukur langsung di browser, biasanya sekitar 10 detik.
3. **Baca laporannya.** Ada skor, tier, penjelasan tiap aspek, dan tips yang paling perlu dikerjakan lebih dulu.

Foto samping bisa ditambahkan di slot kedua untuk laporan profil yang lebih lengkap.

---

## Bagaimana cara kerjanya?

| Tahap | Yang terjadi | Teknologinya |
|---|---|---|
| 1. Deteksi wajah | Foto dibaca dan 478 titik wajah dipetakan | MediaPipe FaceLandmarker |
| 2. Cek arah kepala | Web menentukan apakah foto depan, miring, atau samping dari kedalaman 3D titik-titik wajah | Data sumbu Z dari mesh MediaPipe |
| 3. Pengukuran | Jarak, sudut, dan rasio antartitik dihitung menjadi skor tiap aspek | Perhitungan geometri di `js/faceEngine.js` |
| 4. Deteksi gender | Dipakai hanya untuk memilih nama tier dan kata-kata tips, tidak mengubah skor | face-api.js (TinyFaceDetector + AgeGenderNet) |
| 5. Laporan | Skor digabung berdasar bobot, dicocokkan ke tier, lalu tips dipilih | `js/tips.js` |

Untuk foto dengan kepala menoleh sampai hampir 90°, model utama sering gagal mendeteksi wajah. Karena itu ada detektor cadangan (BlazeFace dan SSD MobileNet) yang setidaknya memastikan ada wajah di foto tersebut.

---

## Soal privasi

- Foto hanya dibaca oleh tab browser kamu dan tidak dikirim ke server mana pun.
- Tidak ada akun, database, ataupun penyimpanan hasil.
- Satu-satunya koneksi internet yang dipakai adalah untuk mengunduh **file model AI** dan font dari CDN publik (jsDelivr dan Google Storage). Setelah diunduh, browser menyimpannya di cache.

---

## Teknologi

- HTML, CSS, dan JavaScript murni (ES Modules). **Tanpa framework dan tanpa proses build.**
- [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) `0.10.14` untuk pemetaan wajah.
- [face-api.js](https://github.com/justadudewhohacks/face-api.js) `0.22.2` untuk deteksi gender dan detektor cadangan foto samping.
- Font Inter dan Space Grotesk dari Google Fonts.

Semua model dan library di atas gratis dan tidak membutuhkan API key.

---

## Cara menjalankan di komputer sendiri

Web ini memakai ES Modules, jadi tidak bisa dibuka langsung lewat `file://`. Jalankan lewat server lokal. Pilih salah satu yang sudah ada di komputermu:

**Opsi A: Node.js**
```bash
npx serve . -l 5501
```

**Opsi B: Python**
```bash
python -m http.server 5501
```

**Opsi C: VS Code**
Pasang ekstensi *Live Server*, klik kanan `index.html`, lalu pilih *Open with Live Server*.

Setelah itu buka `http://localhost:5501` di **Google Chrome**. Firefox dan Safari bisa membuka web-nya, tetapi deteksi gender baru diuji di Chrome.

> Butuh internet saat pertama kali dibuka, karena model AI diunduh dari CDN. Web ini murni statis, jadi bisa di-hosting di layanan static hosting mana pun (Vercel, Netlify, GitHub Pages, dan sebagainya).

---

## Struktur folder

```
index.html            Halaman utama (hero, fitur, scanner, FAQ, footer)
css/style.css         Semua tampilan
css/responsive.css    Penyesuaian untuk layar HP dan tablet
js/main.js            Mengatur UI: upload, drag & drop, progress bar, hasil
js/faceEngine.js      Deteksi wajah + seluruh logika penilaian
js/scale.js           Skala gradasi 0-100 yang interaktif
js/tips.js            Kumpulan tips, dipilih berdasarkan gender dan hasil scan
js/ui/                Komponen halaman: menu navigasi, FAQ, animasi scroll, toast
tools/                Skrip khusus developer untuk menguji dan menyetel skor
test_photos/          Foto uji untuk menyetel skor
```

---

## Batasan (biar jelas dari awal)

- **Ini bukan alat ilmiah atau medis.** Skor dihitung dari geometri wajah dan disetel manual memakai sejumlah kecil foto uji. Hasilnya bersifat hiburan dan gambaran arah, bukan ukuran kecantikan yang sah.
- **Kualitas foto sangat berpengaruh.** Foto buram, gelap, atau memakai filter tebal akan membuat skor bergoyang.
- **Deteksi gender bisa salah.** Kalau gagal mendeteksi, sistem memakai "male" sebagai default. Ini hanya memengaruhi nama tier dan kalimat tips, bukan skor.
- **Model iris MediaPipe sengaja tidak dipakai.** Lingkaran iris dari model itu berukuran tetap dan tidak terpotong kelopak mata, jadi tidak bisa dijadikan patokan untuk mengukur bagian putih mata (sclera). Pembuktiannya ada di `tools/probeIris.mjs`. Sebagai gantinya, bagian putih mata dibaca dari bukaan mata.
- **Tier hanya label bantu.** Nama tier (Low Tier sampai True Adam untuk pria, dan sampai Eve untuk wanita) mengikuti istilah yang populer di komunitas looksmaxxing dan bukan standar resmi apa pun. Batas angkanya disetel dari foto uji yang ada.

---

## Catatan untuk yang melanjutkan proyek

- Konstanta di `js/faceEngine.js` (bobot, batas tier, ambang sudut kepala) punya komentar yang menjelaskan alasan tiap angka. Baca dulu sebelum mengubahnya.
- Skrip di folder `tools/` (misalnya `probeIris.mjs`, `probeProfile.mjs`, `scoringCheck.mjs`) dipakai untuk mengambil ambang batas dari hasil deteksi nyata. Jalankan lebih dulu sebelum mengubah konstanta yang berkaitan.
- File `.env*` dan folder `.vercel/` sudah masuk `.gitignore` karena berisi token deploy dan bukan bagian dari proyek.

---

## Kontak

Dibuat oleh **anrahadi**
📧 anrahadi02@gmail.com
🐙 [github.com/anrahadi-dotcom](https://github.com/anrahadi-dotcom)

_Proyek ini dibuat untuk tujuan edukasi dan portofolio. Skor yang dihasilkan hanyalah perkiraan geometri untuk seru-seruan, bukan pengukuran medis._
