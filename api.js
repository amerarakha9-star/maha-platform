/* api.js — ملف الربط بين صفحات الموقع و Google Apps Script
   لازم يكون في نفس فولدر الصفحات، وكل صفحة بتحمّله بـ <script src="api.js"></script> */

const API_URL = 'https://script.google.com/macros/s/AKfycbxSvU7N5ySwYF8cRNS2xOMZxczr0kHH0oLGFnDZNsqSRauCV9EoQcZTa0HV4fOskF_xVA/exec';

const TOKEN_KEY = 'mahaToken';

/* تخزين آمن: لو localStorage مقفول (تصفح خاص في سفاري مثلاً) بنجرّب sessionStorage ثم الذاكرة، ومفيش أي خطأ بيوقع الصفحة */
let memToken = '';
const safeGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
const safeRemove = k => { try { localStorage.removeItem(k); } catch (e) {} };

const getToken = () => {
  let t = safeGet(TOKEN_KEY);
  if (!t) { try { t = sessionStorage.getItem(TOKEN_KEY); } catch (e) {} }
  return t || memToken || '';
};
const setToken = t => {
  memToken = t || '';
  if (safeSet(TOKEN_KEY, t)) return true;
  try { sessionStorage.setItem(TOKEN_KEY, t); return true; } catch (e) { return false; }
};
const clearToken = () => {
  memToken = '';
  safeRemove(TOKEN_KEY);
  try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
};

/* الأوامر اللي مينفعش تتكرر لو الرد ضاع (ممكن تعمل نسخة مكررة)، فمنعيدهاش تلقائي */
const NO_RETRY = ['saveItem', 'submitHomework'];
const wait = ms => new Promise(r => setTimeout(r, ms));

/* استدعاء أي action. بنبعت text/plain عشان نتفادى مشكلة CORS preflight في Apps Script.
   لو السيرفر رجّع صفحة غلط/مشغول أو النت قطع لحظة: بنعيد المحاولة تلقائي (3 مرات) قبل ما نظهر خطأ للطالب */
async function api(action, data = {}, withToken = true, opts = {}) {
  const body = JSON.stringify({ action, ...data, token: withToken ? getToken() : undefined });
  const tries = (opts.keepalive || NO_RETRY.indexOf(action) >= 0) ? 1 : 3;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    if (i > 0) await wait(1200 * i);
    let text;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 45000) : null;
    try {
      const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, keepalive: !!opts.keepalive, signal: ctl ? ctl.signal : undefined });
      text = await res.text();
    } catch (e) {
      lastErr = new Error('تعذّر الاتصال بالسيرفر. برجاء التأكد من الإنترنت ثم إعادة المحاولة');
      continue;
    } finally { if (timer) clearTimeout(timer); }

    let out;
    try { out = JSON.parse(text); }
    catch (e) {
      console.warn('Non-JSON response from server:', String(text).slice(0, 300));
      lastErr = /accounts\.google\.com|ServiceLogin/i.test(text)
        ? new Error('إعدادات السيرفر محتاجة تعديل (Who has access لازم يكون Anyone). برجاء التواصل مع المعلمة.')
        : new Error('السيرفر مشغول حاليًا. برجاء الانتظار قليلًا ثم إعادة المحاولة');
      continue;
    }
    if (!out.ok) {
      if (out.error === 'AUTH') { onAuthLost(); throw new Error('انتهت الجلسة. برجاء تسجيل الدخول من جديد'); }
      throw new Error(out.error || 'حدث خطأ');
    }
    return out.data;
  }
  throw lastErr;
}

function onAuthLost() {
  const role = safeGet('userRole');
  clearToken();
  ['userRole', 'teacherLoggedIn', 'currentUser'].forEach(safeRemove);
  window.location.href = role === 'teacher' ? 'teacher-login.html' : 'student-login.html';
}

/* ملف -> base64 (للواجبات) */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('تعذّر قراءة الملف'));
    r.readAsDataURL(file);
  });
}

/* base64 -> Blob */
function b64ToBlob(b64, mime) {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

/* تحميل ملف base64 جاي من السيرفر */
function downloadBase64(fileName, mime, b64) {
  const url = URL.createObjectURL(b64ToBlob(b64, mime));
  const a = document.createElement('a');
  a.href = url; a.download = fileName || 'file';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* فتح PDF في تبويب جديد. لازم نفتح التبويب في نفس لحظة الضغطة (قبل أي انتظار) عشان المتصفح مايحجبوش */
function openPdfWindow() {
  try {
    const w = window.open('', '_blank');
    if (w) w.document.write('<!doctype html><meta charset="utf-8"><title>جاري الفتح…</title><body dir="rtl" style="font-family:sans-serif;text-align:center;padding-top:30vh;color:#555">⏳ جاري فتح الملف…</body>');
    return w;
  } catch (e) { return null; }
}
function showPdf(f, w) {
  if (w && !w.closed) {
    const url = URL.createObjectURL(b64ToBlob(f.base64, 'application/pdf'));
    w.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  } else {
    downloadBase64(f.fileName, 'application/pdf', f.base64); // لو المتصفح منع التبويب: ننزّله
  }
}

/* ===== اختصارات جاهزة للصفحات ===== */
const API = {
  signup:       d => api('signup', d, false),        // {name, phone, age, grade, password}
  studentLogin: d => api('studentLogin', d, false),  // {phone, password}
  teacherLogin: d => api('teacherLogin', d, false),  // {password}

  /* ---- الطالب ---- */
  studentData:      () => api('studentData'),
  submitHomework:   async (homeworkId, file) =>
    api('submitHomework', { homeworkId, fileName: file.name, base64: await fileToBase64(file) }),
  deleteSubmission: homeworkId => api('deleteSubmission', { homeworkId }),
  async viewMySubmission(homeworkId) {
    const w = openPdfWindow();
    try { showPdf(await api('getMySubmissionFile', { homeworkId }), w); }
    catch (e) { if (w) try { w.close(); } catch (_) {} throw e; }
  },
  async downloadMySubmission(homeworkId) {
    const f = await api('getMySubmissionFile', { homeworkId });
    downloadBase64(f.fileName, 'application/pdf', f.base64);
  },

  /* ---- المعلمة ---- */
  setReview:      (phone, homeworkId, review) => api('setReview', { phone, homeworkId, review }), // pending | accepted | redo
  teacherData:    () => api('teacherData'),
  setStatus:      (phones, status) => api('setStatus', { phones, status }),
  deleteStudent:  phone => api('deleteStudent', { phone }),
  /* للاستخدام وقت إغلاق الصفحة: keepalive بيخلّي المتصفح يكمّل الطلب حتى بعد ما الصفحة تتقفل (من غير إعادة محاولة) */
  deleteStudentOnLeave: phone => api('deleteStudent', { phone }, true, { keepalive: true }),
  saveItem:       (collection, item) => api('saveItem', { collection, item }),  // lessons | homework | quiz | content
  deleteItem:     (collection, id) => api('deleteItem', { collection, id }),
  saveWhatsapp:   (grade, link) => api('saveWhatsapp', { grade, link }),
  deleteWhatsapp: grade => api('deleteWhatsapp', { grade }),
  async viewSubmission(phone, homeworkId) {
    const w = openPdfWindow();
    try { showPdf(await api('getSubmissionFile', { phone, homeworkId }), w); }
    catch (e) { if (w) try { w.close(); } catch (_) {} throw e; }
  },
  async downloadSubmission(phone, homeworkId) {
    const f = await api('getSubmissionFile', { phone, homeworkId });
    downloadBase64(f.fileName, 'application/pdf', f.base64);
  }
};

/* ===== شريط العنوان ثابت في أعلى الصفحة (الموبايل واللابتوب) =====
   position:sticky بيتعطّل في بعض متصفحات الموبايل لو أي عنصر فوقه عامل overflow،
   فبنثبّت الشريط بـ fixed ونحط مكانه فراغ بنفس الارتفاع (بيتحدّث تلقائي لو الشريط كبر/صغر) */
(function pinHeader() {
  function init() {
    const h = document.querySelector('header.header');
    if (!h || document.getElementById('headerSpacer')) return;
    const sp = document.createElement('div');
    sp.id = 'headerSpacer';
    sp.setAttribute('aria-hidden', 'true');
    h.parentNode.insertBefore(sp, h.nextSibling);
    const sync = () => {
      const H = h.offsetHeight;
      sp.style.height = H + 'px';
      document.documentElement.style.setProperty('--header-h', H + 'px');
    };
    document.documentElement.classList.add('hdr-fixed');
    sync();
    if (window.ResizeObserver) new ResizeObserver(sync).observe(h);
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(sync);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
