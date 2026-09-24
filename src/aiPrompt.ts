// Format rules for AI-generated lesson plans, shared by the "Salin Prompt AI" button (teachers
// paste them into ChatGPT / AI Studio) and "Rapikan Dokumen (AI)" (Gemini restructures an
// existing document). Every rule maps to an editor limitation; keep them in sync with the editor.

// Text stand-in for <div class="page-break"> while a document is restructured (see restructure.ts)
export const PAGE_BREAK_MARKER = 'PAGEBREAK7F3';

const PAPER_LABELS: Record<string, string> = {
  a4: 'A4 (210 × 297 mm)',
  f4: 'F4/Folio (215,9 × 330,2 mm)',
  letter: 'Letter (215,9 × 279,4 mm)',
  legal: 'Legal (215,9 × 355,6 mm)',
};

// "document": a complete HTML file from scratch. "fragment": one part of an existing document's
// <body>, merged with other parts afterwards, so styles must be inline (no shared <style>).
function formatRules(paperSize: string, mode: 'document' | 'fragment'): string[] {
  const paper = PAPER_LABELS[paperSize] ?? PAPER_LABELS.a4;
  return [
    mode === 'document'
      ? 'Berikan SATU dokumen HTML lengkap (<!DOCTYPE html> sampai </html>) dalam satu blok kode, tanpa penjelasan di luar kode.'
      : 'Kembalikan HANYA potongan HTML hasil (isi <body>) dalam satu blok kode, tanpa <html>, <head>, <style>, atau penjelasan.',
    `Dokumen ini akan dicetak di kertas ${paper}, bukan ditampilkan sebagai halaman web. Jangan buat bingkai kertas, bayangan, atau latar di luar area isi.`,
    'Semua data berbentuk tabel WAJIB memakai <table> dengan <thead> dan <tbody>. JANGAN membuat tabel atau kolom memakai display:grid, display:flex, atau <div> berderet.',
    'Atur lebar kolom tabel hanya dengan <colgroup><col style="width: ...%"></colgroup>. Jangan beri lebar pada <td>/<th>.',
    'Tabel: style="border-collapse: collapse; width: 100%;" dan setiap sel diberi border 1px solid #000 serta padding 4–6px.',
    mode === 'document'
      ? 'JANGAN memakai Tailwind, Bootstrap, atau framework CSS lain. Tulis style di satu <style> di <head> atau inline.'
      : 'JANGAN memakai class (Tailwind, Bootstrap, dll). Semua tampilan ditulis sebagai style inline (style="...").',
    'JANGAN menyertakan <script>, tombol (Print / Save PDF / Download), form, atau elemen interaktif apa pun.',
    'JANGAN memakai position: fixed, sticky, atau absolute.',
    'Gunakan <h1>–<h3> untuk judul, <p> untuk paragraf, <ul>/<ol> untuk daftar. Font 11–12pt, warna gelap di atas latar putih.',
    mode === 'document'
      ? 'Jika isi perlu dipisah per halaman, sisipkan <div class="page-break"></div> di antara halaman.'
      : 'Jangan menambah batas halaman baru.',
    'Rumus matematika ditulis dengan LaTeX di antara tanda $...$, misalnya $x^2 + y^2 = r^2$.',
  ];
}

const numbered = (rules: string[]) => rules.map((r, i) => `${i + 1}. ${r}`).join('\n');

export function buildAiPrompt(paperSize: string): string {
  return `[TULIS PERMINTAAN ANDA DI SINI, misalnya: Buatkan RPP Biologi kelas X tentang Fotosintesis, 2 × 45 menit, Kurikulum Merdeka]

ATURAN FORMAT OUTPUT (wajib diikuti):
${numbered(formatRules(paperSize, 'document'))}

Jika Anda sudah membuat RPP di percakapan ini, ubah hasil sebelumnya agar mengikuti aturan di atas.`;
}

// Prompt for restructuring one part of an existing document. Content must survive untouched:
// the caller verifies the words afterwards and rejects answers that changed them.
export function buildRestructurePrompt(paperSize: string, partHtml: string, part: number, total: number, retryNote?: string): string {
  return `Kamu adalah perapih FORMAT dokumen RPP (Rencana Pelaksanaan Pembelajaran). Di bawah ini bagian ${part} dari ${total} sebuah dokumen HTML buatan AI. Ubah FORMAT-nya saja agar mengikuti aturan, TANPA mengubah isi.

ATURAN ISI (paling penting, akan diperiksa otomatis kata per kata):
- Semua teks harus tetap SAMA PERSIS: jangan menerjemahkan, meringkas, menambah, menghapus, atau memperbaiki kalimat, ejaan, maupun angka. Bahasa tetap seperti aslinya.
- Urutan isi tetap sama. Jangan menambah judul, label, atau nomor baru.
- Rumus ($...$, \\(...\\), atau <math>) dibiarkan apa adanya.
- Penanda batas halaman [[${PAGE_BREAK_MARKER}]] dibiarkan persis di tempatnya, dalam <p> tersendiri.

ATURAN TAMPILAN:
- Pertahankan kesan tampilan aslinya (warna latar kotak, warna garis tepi, warna judul, tebal/miring), tetapi ditulis sebagai style inline.
- Deretan kolom berisi data (dibuat dengan grid/flex/div) diubah menjadi <table>. Kotak penjelasan berwarna tetap <div> dengan border/background inline, bukan tabel.
- Kotak isian siswa (garis titik-titik, "Name:", ruang jawaban) dipertahankan.

ATURAN FORMAT OUTPUT:
${numbered(formatRules(paperSize, 'fragment'))}
${retryNote ? `\nPERHATIAN: ${retryNote}\n` : ''}
BAGIAN DOKUMEN:
${partHtml}`;
}
