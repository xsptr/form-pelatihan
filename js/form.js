// ============================================================
// KONFIGURASI
// ============================================================
const SHEET_URL    = "https://script.google.com/macros/s/AKfycbw60djeICwQMdChz1ZpbIkOtKalHlfVWrdmp4aP0A_vUEw6caKGrlA8mMvvBQ1qLL-k/exec";
const KUOTA_LURING = 125;    // ← ubah angka ini jika kuota ditambah/dikurangi
const KUOTA_DARING = 500;  // ← ubah angka ini jika kuota ditambah/dikurangi

// ============================================================
// DAFTAR NIM KONSEKUENSI
// NIM yang daftar luring sebelumnya tapi tidak hadir
// → hanya boleh daftar daring pada pelatihan ini
// Tambahkan NIM baru di sini (format string, termasuk angka 0 di depan)
// ============================================================
var NIM_KONSEKUENSI = [
  "041234567",
  "042345678"
  // tambahkan NIM lain di sini...
];
const CACHE_KEY    = "kuota_cache";
const CACHE_TTL    = 60000; // cache berlaku 60 detik

// ── State ──
let kuota = { luring: null, daring: null };
let selectedMode   = "";
let selectedStatus = "";
let isSubmitting   = false;
let nimPendaftar            = ""; // menyimpan NIM saat proses submit, diakses modal konsekuensi
let sudahSetujuKonsekuensi = false; // flag: skip cek konsekuensi saat submit ulang

const fields = ["nim","nama","prodi","hp","email"];

// ── Mulai fetch kuota SEGERA — sebelum DOM siap sekalipun ──
// Ini memaksimalkan waktu yang tersedia sambil browser masih render UI
const kuotaPromise = fetchKuotaRaw();

async function fetchKuotaRaw() {
  // Cek cache dulu agar tidak perlu round-trip ke Google setiap kali
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL) return data; // pakai cache jika masih fresh
    }
  } catch(e) {}

  // Fetch ke Apps Script
  const res  = await fetch(SHEET_URL + "?action=getKuota");
  const data = await res.json();

  // Simpan ke cache
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch(e) {}

  return data;
}

// ============================================================
// LOAD KUOTA — dipanggil saat DOM siap, pakai hasil promise
// yang sudah mulai berjalan sejak script pertama dieksekusi
// ============================================================
async function loadKuota() {
  try {
    const data = await kuotaPromise; // hasilnya sudah hampir/sudah siap
    kuota.luring = parseInt(data.luring) || 0;
    kuota.daring = parseInt(data.daring) || 0;
    renderKuota();
  } catch (e) {
    // Jika gagal, sembunyikan loading dan anggap tersedia
    ["Luring","Daring"].forEach(cap => {
      document.getElementById("loading" + cap).style.display   = "none";
      document.getElementById("kuotaInfo" + cap).style.display = "block";
    });
    kuota.luring = 0;
    kuota.daring = 0;
    renderKuota();
  }
}

function renderKuota() {
  renderKuotaCard("luring", kuota.luring, KUOTA_LURING);
  renderKuotaCard("daring", kuota.daring, KUOTA_DARING);
  renderModeOptions();
}

function renderKuotaCard(mode, terisi, max) {
  const sisa    = max - terisi;
  const pct     = Math.min((terisi / max) * 100, 100);
  const penuh   = sisa <= 0;
  const hampir  = !penuh && pct >= 80;

  const Cap = mode.charAt(0).toUpperCase() + mode.slice(1);

  // Loading → hide, info → show
  document.getElementById("loading" + Cap).style.display    = "none";
  document.getElementById("kuotaInfo" + Cap).style.display  = "block";

  // Sisa
  const sisaEl = document.getElementById("sisa" + Cap);
  sisaEl.textContent = penuh ? "PENUH" : sisa.toLocaleString("id-ID");
  sisaEl.className   = "kuota-sisa" + (penuh ? " penuh" : hampir ? " hampir" : "");

  // Progress bar
  const fillEl = document.getElementById("fill" + Cap);
  fillEl.style.width = pct + "%";
  fillEl.className   = "kuota-fill" + (penuh ? " penuh" : hampir ? " hampir" : "");

  // Badge
  const badge = document.getElementById("badge" + Cap);
  if (penuh) {
    badge.textContent = "Penuh";
    badge.className   = "kuota-badge penuh";
  } else if (hampir) {
    badge.textContent = "Hampir Penuh";
    badge.className   = "kuota-badge hampir";
  } else {
    badge.textContent = "Tersedia";
    badge.className   = "kuota-badge tersedia";
  }
}

function renderModeOptions() {
  ["luring","daring"].forEach(mode => {
    const max    = mode === "luring" ? KUOTA_LURING : KUOTA_DARING;
    const terisi = kuota[mode];
    const sisa   = max - terisi;
    const penuh  = sisa <= 0;
    const Cap    = mode.charAt(0).toUpperCase() + mode.slice(1);
    const optEl  = document.getElementById("opt" + Cap);
    const tagEl  = document.getElementById("tag" + Cap);

    if (penuh) {
      optEl.classList.add("disabled");
      optEl.classList.remove("selected");
      tagEl.textContent = "Kuota Penuh";
      if (selectedMode === mode) {
        selectedMode = "";
        updateProgress();
        updateSubmitBtn();
      }
    } else {
      optEl.classList.remove("disabled");
      tagEl.textContent = "Sisa " + sisa.toLocaleString("id-ID") + " kursi";
    }
  });
}

// ============================================================
// FIELD HANDLERS
// ============================================================
function setFocused(cardId) {
  document.getElementById(cardId).classList.add("focused");
}
function clearFocused(cardId) {
  setTimeout(() => document.getElementById(cardId).classList.remove("focused"), 150);
}

function onFieldInput(field) {
  // Reset pesan error NIM duplikat jika user mengetik ulang
  if (field === "nim") {
    document.getElementById("errNim").textContent = "NIM tidak boleh kosong";
  }
  validateField(field, false);
  updateProgress();
  updateSubmitBtn();
}

function validateField(field, showErr) {
  const id    = "input" + field.charAt(0).toUpperCase() + field.slice(1);
  const errId = "err"   + field.charAt(0).toUpperCase() + field.slice(1);
  const cardId= "card"  + field.charAt(0).toUpperCase() + field.slice(1);
  const val   = document.getElementById(id).value.trim();
  let ok = true;

  if (field === "hp")    ok = val.length >= 10 && /^[0-9+\-\s]+$/.test(val);
  else if (field === "email") ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
  else ok = val.length > 0;

  const card = document.getElementById(cardId);
  const err  = document.getElementById(errId);
  const inp  = document.getElementById(id);

  if (!ok && showErr) {
    card.classList.add("error"); card.classList.remove("filled","focused");
    err.classList.add("show"); inp.classList.add("has-error");
  } else if (ok) {
    card.classList.remove("error"); card.classList.add("filled");
    err.classList.remove("show"); inp.classList.remove("has-error");
  } else {
    card.classList.remove("error","filled");
    err.classList.remove("show"); inp.classList.remove("has-error");
  }
  return ok;
}

function selectMode(mode) {
  const el = document.getElementById("opt" + mode.charAt(0).toUpperCase() + mode.slice(1));
  if (el.classList.contains("disabled")) return;
  selectedMode = mode;
  document.getElementById("optLuring").classList.toggle("selected", mode === "luring");
  document.getElementById("optDaring").classList.toggle("selected", mode === "daring");
  document.getElementById("errMode").classList.remove("show");
  document.getElementById("cardMode").classList.remove("error");
  updateProgress();
  updateSubmitBtn();
}

function selectStatus(status) {
  selectedStatus = status;
  document.getElementById("optMahasiswa").classList.toggle("selected", status === "mahasiswa");
  document.getElementById("optAlumni").classList.toggle("selected", status === "alumni");
  document.getElementById("errStatus").classList.remove("show");
  document.getElementById("cardStatus").classList.remove("error");
  updateProgress();
  updateSubmitBtn();
}

// ============================================================
// PROGRESS & SUBMIT BTN
// ============================================================
function getFieldValues() {
  return {
    nim:   document.getElementById("inputNim").value.trim(),
    nama:  document.getElementById("inputNama").value.trim(),
    prodi: document.getElementById("inputProdi").value.trim(),
    hp:    document.getElementById("inputHp").value.trim(),
    email: document.getElementById("inputEmail").value.trim(),
  };
}

function countFilled() {
  const v = getFieldValues();
  let n = 0;
  if (v.nim.length > 0) n++;
  if (v.nama.length > 0) n++;
  if (v.prodi.length > 0) n++;
  if (v.hp.length >= 10) n++;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) n++;
  if (selectedStatus) n++;
  if (selectedMode) n++;
  return n;
}

function updateProgress() {
  const n = countFilled();
  document.getElementById("progressCount").textContent = n + " / 7";
  document.getElementById("progressFill").style.width  = (n / 7 * 100) + "%";
}

function updateSubmitBtn() {
  const ok  = countFilled() === 7;
  const btn = document.getElementById("submitBtn");
  const hint= document.getElementById("submitHint");
  btn.disabled = !ok;
  if (ok) {
    hint.textContent = "Semua isian lengkap. Siap mendaftar!";
    hint.style.color = "#1A7F4B";
  } else {
    const rem = 7 - countFilled();
    hint.textContent = "Lengkapi " + rem + " isian lagi untuk mendaftar";
    hint.style.color = "var(--text-muted)";
  }
}

// ============================================================
// SUBMIT
// ============================================================
async function submitForm() {
  if (isSubmitting) return;

  // Validasi semua field
  let allOk = true;
  fields.forEach(f => { if (!validateField(f, true)) allOk = false; });
  if (!selectedStatus) {
    document.getElementById("errStatus").classList.add("show");
    document.getElementById("cardStatus").classList.add("error");
    allOk = false;
  }
  if (!selectedMode) {
    document.getElementById("errMode").classList.add("show");
    document.getElementById("cardMode").classList.add("error");
    allOk = false;
  }
  if (!allOk) {
    showToast("Periksa kembali isian yang belum lengkap", true);
    return;
  }

  // ── Kunci tombol SEKARANG sebelum operasi apapun ──
  // Mencegah double-submit akibat klik ganda saat ada jeda network
  isSubmitting = true;
  document.getElementById("submitBtn").disabled      = true;
  document.getElementById("spinner").style.display   = "block";
  document.getElementById("submitLabel").textContent  = "Memeriksa data...";

  const v = getFieldValues();
  nimPendaftar = v.nim;

  // Simpan semua nilai ke variabel outer agar tetap tersedia
  // saat submitForm dipanggil ulang oleh setujuKonsekuensi
  var vNim   = v.nim;
  var vNama  = v.nama;
  var vProdi = v.prodi;
  var vHp    = v.hp;
  var vEmail = v.email;

  // Cek kuota + NIM duplikat real-time sebelum submit
  // (paksa bypass cache agar data selalu fresh saat submit)
  try {
    sessionStorage.removeItem(CACHE_KEY); // invalidate cache sebelum cek
    const data = await fetchKuotaRaw();
    kuota.luring = parseInt(data.luring) || 0;
    kuota.daring = parseInt(data.daring) || 0;
    renderKuota();

    // Cek NIM duplikat — normalisasi keduanya ke string agar 0 di depan tidak hilang
    if (data.nimList && data.nimList.map(function(n){ return String(n).trim(); }).includes(String(vNim).trim())) {
      showToast("NIM " + nimPendaftar + " sudah terdaftar sebelumnya!", true);
      document.getElementById("cardNim").classList.add("error");
      document.getElementById("errNim").textContent = "NIM ini sudah terdaftar. Setiap mahasiswa hanya bisa mendaftar 1 kali.";
      document.getElementById("errNim").classList.add("show");
      document.getElementById("inputNim").classList.add("has-error");
      resetSubmitBtn(); return;
    }

    // Cek NIM konsekuensi — wajib daring jika masuk daftar
    // Skip jika user sudah setuju di modal sebelumnya
    if (!sudahSetujuKonsekuensi &&
        NIM_KONSEKUENSI.map(function(n){ return String(n).trim(); }).includes(String(vNim).trim())) {
      if (selectedMode === "luring") {
        resetSubmitBtn();
        showModalKonsekuensi();
        return;
      }
    }
    sudahSetujuKonsekuensi = false;

    const max    = selectedMode === "luring" ? KUOTA_LURING : KUOTA_DARING;
    const terisi = kuota[selectedMode];
    if (terisi >= max) {
      showToast("Maaf, kuota " + selectedMode + " baru saja penuh!", true);
      resetSubmitBtn(); return;
    }
  } catch(e) { /* lanjut jika tidak bisa cek */ }

  document.getElementById("submitLabel").textContent = "Mendaftarkan...";
  const payload = {
    action:    "daftar",
    timestamp: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
    nim:       v.nim,
    nama:      v.nama,
    prodi:     v.prodi,
    hp:        v.hp,
    email:     v.email,
    status:    selectedStatus.charAt(0).toUpperCase() + selectedStatus.slice(1),
    mode:      selectedMode.charAt(0).toUpperCase() + selectedMode.slice(1)
  };

  try {
    const formData = new URLSearchParams(payload);

    const res  = await fetch(SHEET_URL, {
      method: "POST",
      body: formData
    });
    if (!res.ok) {
      throw new Error("HTTP " + res.status);
    }

    const text = await res.text();
    console.log("RAW RESPONSE:", text);

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error("Response bukan JSON valid");
    }

    if (data.status === "ok") {
      sessionStorage.removeItem(CACHE_KEY); // paksa refresh kuota untuk pengunjung berikutnya
      showSuccess(payload, data.no);
    } else if (data.status === "nim_duplikat") {
      showToast("NIM " + nimPendaftar + " sudah terdaftar sebelumnya!", true);
      document.getElementById("cardNim").classList.add("error");
      document.getElementById("errNim").textContent = "NIM ini sudah terdaftar. Setiap mahasiswa hanya bisa mendaftar 1 kali.";
      document.getElementById("errNim").classList.add("show");
      document.getElementById("inputNim").classList.add("has-error");
    } else if (data.status === "penuh") {
      showToast("Maaf, kuota " + selectedMode + " sudah penuh!", true);
      kuota[selectedMode] = data.mode === "luring" ? KUOTA_LURING : KUOTA_DARING;
      renderKuota();
      selectedMode = "";
      document.getElementById("optLuring").classList.remove("selected");
      document.getElementById("optDaring").classList.remove("selected");
      updateProgress(); updateSubmitBtn();
    } else {
      throw new Error(data.message || "Unknown error");
    }
  } catch (err) {
    console.error(err);
    showToast("Error: " + err.message, true);
  } finally {
    resetSubmitBtn();
  }
}

// ── Reset tombol submit ke kondisi semula ──
function resetSubmitBtn() {
  isSubmitting = false;
  document.getElementById("spinner").style.display   = "none";
  document.getElementById("submitLabel").textContent  = "Daftar Sekarang \uD83C\uDFA4";
  document.getElementById("submitBtn").disabled       = countFilled() < 7;
}

// ============================================================
// MODAL KONSEKUENSI LURING
// ============================================================
function showModalKonsekuensi() {
  document.getElementById("modalKonsekuensi").classList.add("show");
}

function hideModalKonsekuensi() {
  document.getElementById("modalKonsekuensi").classList.remove("show");
}

function setujuKonsekuensi() {
  hideModalKonsekuensi();
  sudahSetujuKonsekuensi = true; // tandai sudah setuju agar skip cek konsekuensi
  selectMode("daring");
  updateProgress();
  updateSubmitBtn();
  showToast("Mode diubah ke Daring. Mendaftarkan...", false);
  setTimeout(function() { submitForm(); }, 400);
}

function tolakKonsekuensi() {
  hideModalKonsekuensi();
  // Kembalikan mode kosong
  selectedMode = "";
  document.getElementById("optLuring").classList.remove("selected");
  document.getElementById("optDaring").classList.remove("selected");
  document.getElementById("errMode").classList.add("show");
  document.getElementById("cardMode").classList.add("error");
  updateProgress();
  updateSubmitBtn();
  showToast("Pendaftaran dibatalkan.", false);
}
function showSuccess(p, no) {
  const modeLabel   = p.mode === "Luring" ? "\uD83C\uDFEB Luring (Tatap Muka)" : "\uD83D\uDCBB Daring (Online)";
  const statusLabel = p.status === "Mahasiswa" ? "\uD83C\uDFEB Mahasiswa" : "\uD83C\uDF93 Alumni";
  document.getElementById("successDetail").innerHTML = [
    { label: "No. Pendaftaran", val: "#" + String(no).padStart(4,"0"), hl: true },
    { label: "NIM",             val: p.nim },
    { label: "Nama",            val: p.nama },
    { label: "Status",          val: statusLabel },
    { label: "Program Studi",   val: p.prodi },
    { label: "Nomor HP",        val: p.hp },
    { label: "Email",           val: p.email },
    { label: "Mode Pelatihan",  val: modeLabel, hl: true },
  ].map(r =>
    '<div class="success-row' + (r.hl ? " highlight" : "") + '">' +
    '<span class="success-row-label">' + r.label + '</span>' +
    '<span class="success-row-val">'   + r.val   + '</span></div>'
  ).join("");

  document.getElementById("formView").style.display    = "none";
  document.getElementById("successView").style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg, isError, isWarn) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : isWarn ? " warn" : "");
  setTimeout(() => { t.className = "toast" + (isError ? " error" : isWarn ? " warn" : ""); }, 4000);
}

// ============================================================
// INIT
// ============================================================
window.selectMode          = selectMode;
window.selectStatus        = selectStatus;
window.submitForm          = submitForm;
window.onFieldInput        = onFieldInput;
window.setFocused          = setFocused;
window.clearFocused        = clearFocused;
window.setujuKonsekuensi   = setujuKonsekuensi;
window.tolakKonsekuensi    = tolakKonsekuensi;


loadKuota();
updateProgress();
updateSubmitBtn();