// KALA — minimal i18n. Only UI chrome is translated; the user's own words never change.

export const I18N = {
  id: {
    "Settings": "Pengaturan",
    "Your profile": "Profil kamu",
    "Name": "Nama",
    "Date of birth": "Tanggal lahir",
    "Life expectancy": "Harapan hidup",
    "Save changes": "Simpan perubahan",
    "Appearance": "Tampilan",
    "Light": "Terang", "Dark": "Gelap",
    "Pick a mood. Earth tones, every one.": "Pilih suasana. Semua bernuansa bumi.",
    "Language": "Bahasa",
    "Start over": "Mulai dari awal",
    "Your data": "Data kamu",
    "Your life is yours. Download a backup anytime, or restore from one.": "Hidupmu milikmu. Unduh cadangan kapan saja, atau pulihkan dari cadangan.",
    "Export backup": "Ekspor cadangan", "Import backup": "Impor cadangan",
    "Backup restored.": "Cadangan dipulihkan.", "Couldn't read that file.": "Tidak bisa membaca berkas itu.",
    "Erase everything — profile, plans, diary, memories — and begin fresh.":
      "Hapus semuanya — profil, rencana, diary, memori — dan mulai dari awal.",
    "Reset KALA": "Reset KALA",
    "Life": "Hidup", "Reflect": "Refleksi", "Plans": "Rencana", "Simulate": "Simulasi",
    "Memory Timeline": "Linimasa Memori", "Diary": "Diary", "Wrapped": "Wrapped",
    "Your life in weeks": "Hidupmu dalam minggu",
    "Weeks lived": "Minggu dijalani", "Weeks remaining": "Minggu tersisa",
    "These numbers assume a long life": "Angka ini mengandaikan umur panjang",
    "they're a gentle estimate, not a promise. The point isn't how much time is left, but how you choose to spend it.": "ini perkiraan lembut, bukan janji. Yang penting bukan berapa waktu tersisa, tapi bagaimana kamu memilih menjalaninya.",
    "Life lived": "Hidup terpakai", "Years old": "Tahun",
    "This week": "Minggu ini", "Lived": "Dijalani", "Ahead": "Masih ada",
    "Active plan": "Rencana aktif", "Manage plans →": "Kelola rencana →",
    "Main": "Utama", "More": "Lainnya",
  },
};
export function tr(s, lang) {
  if (lang === "id" && I18N.id[s]) return I18N.id[s];
  return s;
}

