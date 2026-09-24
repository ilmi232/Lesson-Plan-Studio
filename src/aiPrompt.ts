// Instructions teachers paste into ChatGPT / Google AI Studio so the generated HTML is a
// printable document the editor can work with (real tables, no scripts, no floating toolbars).
// Every rule here maps to an editor limitation; keep them in sync when the editor changes.

const PAPER_LABELS: Record<string, string> = {
  a4: 'A4 (210 × 297 mm)',
  f4: 'F4/Folio (215,9 × 330,2 mm)',
  letter: 'Letter (215,9 × 279,4 mm)',
  legal: 'Legal (215,9 × 355,6 mm)',
};

export function buildAiPrompt(paperSize: string): string {
  const paper = PAPER_LABELS[paperSize] ?? PAPER_LABELS.a4;
  return `[TULIS PERMINTAAN ANDA DI SINI, misalnya: Buatkan RPP Biologi kelas X tentang Fotosintesis, 2 × 45 menit, Kurikulum Merdeka]

ATURAN FORMAT OUTPUT (wajib diikuti):
1. Berikan SATU dokumen HTML lengkap (<!DOCTYPE html> sampai </html>) dalam satu blok kode, tanpa penjelasan di luar kode.
2. Dokumen ini akan dicetak di kertas ${paper}, bukan ditampilkan sebagai halaman web. Jangan buat bingkai kertas, bayangan, atau latar di luar area isi.
3. Semua data berbentuk tabel WAJIB memakai <table> dengan <thead> dan <tbody>. JANGAN membuat tabel atau kolom memakai display:grid, display:flex, atau <div> berderet.
4. Atur lebar kolom tabel hanya dengan <colgroup><col style="width: ...%"></colgroup>. Jangan beri lebar pada <td>/<th>.
5. Tabel: style="border-collapse: collapse; width: 100%;" dan setiap sel diberi border 1px solid #000 serta padding 4–6px.
6. JANGAN memakai Tailwind, Bootstrap, atau framework CSS lain. Tulis style di satu <style> di <head> atau inline.
7. JANGAN menyertakan <script>, tombol (Print / Save PDF / Download), form, atau elemen interaktif apa pun.
8. JANGAN memakai position: fixed, sticky, atau absolute.
9. Gunakan <h1>–<h3> untuk judul, <p> untuk paragraf, <ul>/<ol> untuk daftar. Font 11–12pt, warna gelap di atas latar putih.
10. Jika isi perlu dipisah per halaman, sisipkan <div class="page-break"></div> di antara halaman.
11. Rumus matematika ditulis dengan LaTeX di antara tanda $...$, misalnya $x^2 + y^2 = r^2$.

Jika Anda sudah membuat RPP di percakapan ini, ubah hasil sebelumnya agar mengikuti aturan di atas.`;
}
