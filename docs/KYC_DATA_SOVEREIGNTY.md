# O'zbekiston Shaxsga Doir Ma'lumotlar To'g'risidagi Qonunchilik va KYC Ma'lumotlar Suvereniteti

Ushbu hujjat **Bobo-Doda** platformasining shaxsni tasdiqlash (KYC) va shaxsga doir ma'lumotlarni saqlash tizimining O'zbekiston Respublikasi qonunchiligi talablariga muvofiqligi, texnik arxitekturasi va tavsiya etiladigan amaliy choralarini belgilaydi.

---

## 1. Huquqiy Asos: O'zbekiston Respublikasining "Shaxsga doir ma'lumotlar to'g'risida"gi Qonuni (O'RQ-547)

### 1.1. 27-modda talabi (Lokalizatsiya / Ma'lumotlar Suvereniteti)
O'RQ-547-sonli Qonunning 27-moddasiga (2021-yil 14-yanvardagi O'RQ-666-sonli Qonun bilan kiritilgan o'zgartirish) muvofiq:
> *"Mulkdor va (yoki) operator axborot texnologiyalaridan foydalangan holda O'zbekiston Respublikasi fuqarolarining shaxsga doir ma'lumotlariga ishlov berishda, shu jumladan Internet jahon axborot tarmog'ida ularni to'plash, tizimlashtirish va saqlashda ushbu ma'lumotlarning **O'zbekiston Respublikasi hududida jismonan joylashgan** texnik vositalarda hamda belgilangan tartibda Shaxsga doir ma'lumotlar bazalarining davlat reyestrida ro'yxatdan o'tkazilgan shaxsga doir ma'lumotlar bazalarida saqlanishini ta'minlashi shart."*

### 1.2. Amaliy oqibatlar va qat'iy majburiyatlar
1. **Baza joylashuvi (PostgreSQL & Object Storage):**
   - O'zbekiston fuqarolarining pasport ma'lumotlari, JSHSHIR (PINFL), STIR (INN), yashash manzili va yuz suratlari (selfie) saqlanadigan ma'lumotlar bazalari (PostgreSQL serverlari) va ob'ekt saqlash tizimlari (S3/MinIO) **O'zbekiston Respublikasi hududidagi ma'lumotlar markazlarida (Data Center)** jismonan joylashtirilishi shart.
   - Xorijiy bulut platformalari (AWS us-east-1, Google Cloud eu-west, Hetzner va h.k.)da O'zbekiston fuqarolarining xom shaxsga doir ma'lumotlarini asosiy saqlovchi sifatida ishlatish qonunan taqiqlanadi.
2. **Davlat reyestridan ro'yxatdan o'tish:**
   - Platforma rasmiy ishga tushishidan avval "O'zkomnazorat" (Axborotlashtirish va telekommunikatsiyalar sohasida nazorat bo'yicha davlat inspeksiyasi) orqali Shaxsga doir ma'lumotlar bazalarining davlat reyestriga ro'yxatdan o'tkazilishi lozim.

---

## 2. Bobo-Doda KYC Tizimining Xavfsizlik Arxitekturasi

Platformada joriy qilingan texnik arxitektura xalqaro OWASP ASVS standartlari va milliy qonunchilik talablariga to'liq javob beradi:

### 2.1. Ma'lumotlarni shifrlash (Encryption at Rest & in Transit)
- **PII maydonlari (Pasport, STIR, JSHSHIR):**
  - Ma'lumotlar bazasida (`kyc_verifications` jadvalida) ochiq (plaintext) ko'rinishda saqlanmaydi.
  - Har bir maydon **AES-256-GCM** autentifikatsiyalangan shifr bilan shifrlanadi (har bir yozuv uchun unikal IV va AuthTag).
  - Shifrlangan satrlar `v1:<iv>:<authTag>:<ciphertext>` formatida saqlanadi.
- **Deterministik qidiruv va takrorlanishdan himoya:**
  - Pasport raqamining bir tomonlama kriptografik heshi (**HMAC-SHA256**) alohida ustunda (`passportNumberHash`) saqlanadi. Bu xom pasport raqamini oshkor qilmasdan takroriy ro'yxatdan o'tishning oldini oladi.
- **Fayllar (Pasport skanerlari, ID karta, selfi):**
  - Ob'ekt saqlash xotirasida (Local Storage Provider yoki S3-compatible storage) barcha fayllar diskka yozilishidan oldin AES-256-GCM bilan to'liq shifrlanadi.
  - Diskka to'g'ridan-to'g'ri kirish imkoniga ega bo'lgan tizim ma'muri ham fayllarning asl mazmunini (rasm/PDF) ko'ra olmaydi.

### 2.2. Ochiq URL-lar yo'qligi va qisqa muddatli ruxsat (Time-limited Signed Access)
- **Hech qanday ommaviy havola (Public URL) yo'q:**
  - Hujjatlar saqlanadigan S3 bucket yoki fayl kataloglari tashqi tarmoqqa to'g'ridan-to'g'ri ochiq emas (private ACL).
- **HMAC-SHA256 imzoli vaqtinchalik tokenlar:**
  - Tasdiqlash huquqiga ega operator (Staff with `KYC` permission) ariza tafsilotlarini so'raganda, har bir hujjat uchun muddati **5 daqiqa (300 soniya)** bilan cheklangan imzo (`GET /kyc/documents/stream?token=...`) yaratiladi.
  - Token muddati o'tgach yoki tokenga o'zgartirish kiritilsa (tampered), server `401 INVALID_TOKEN` bilan zudlikda rad etadi.

### 2.3. Brauzerda ma'lumotlar minimallashtirilishi (Zero LocalStorage)
- Mijoz ilovasida (Frontend Next.js):
  - Pasport raqamlari, tug'ilgan sanalar yoki hujjat base64 suratlari `localStorage`, `sessionStorage` yoki `IndexedDB`ga **mutlaqo yozilmaydi**.
  - Foydalanuvchi profilida pasport raqami faqat niqoblangan (masked) ko'rinishda (masalan: `AA*****43`) ko'rsatiladi.

### 2.4. Antivirus va zararli dasturlarni tekshirish (Fail-Closed Scanning)
- Yuklangan barcha fayllar (JPEG, PNG, WebP, PDF) avval **Magic Bytes** tekshiruvidan o'tadi (fayl kengaytmasi soxtalashtirilishining oldini olish uchun).
- Izolyatsiyalangan **ClamAV daemon** xizmati orqali real vaqtda skanerlanadi.
- Agar skaner xizmati ishlamay qolsa yoki xatolik bersa, tizim **Fail-Closed** tamoyili bo'yicha ishlaydi: hujjat qabul qilinmaydi va xotiraga yozilmaydi.

---

## 3. Server va Infratuzilma Bo'yicha Tavsiyalar (DevOps & Hosting)

Bobo-Doda ishlab chiqarish (production) muhitiga chiqarilishi uchun quyidagi infratuzilma qadamlari bajarilishi shart:

1. **Mahalliy Provayderlar (O'zbekiston hududida):**
   - Server va ma'lumotlar bazasi Uztelecom (Uzcloud), Servercore Tashkent, RealSoft Data Center yoki Beeline Uzbekistan ma'lumotlar markazlarida ijaraga olingan serverlarda joylashtirilishi zarur.
2. **S3 Ob'ekt Saqlash Xizmati:**
   - Mahalliylashtirilgan MinIO klasteri (O'zbekiston data-markazida o'rnatilgan) yoki mahalliy provayderlarning S3-compatible saqlash xizmatidan foydalanish.
3. **Kriptografik Kalitlar Xavfsizligi:**
   - `KYC_STORAGE_ENCRYPTION_KEY` va `STAFF_TOTP_ENCRYPTION_KEY` muhit o'zgaruvchilari (env) shifrlangan secret manager tizimlarida (HashiCorp Vault yoki Kubernetes Secrets) saqlanishi kerak.
