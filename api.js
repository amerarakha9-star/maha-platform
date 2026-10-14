/* api.js — ملف الربط بين صفحات الموقع و Google Apps Script
   لازم يكون في نفس فولدر الصفحات، وكل صفحة بتحمّله بـ <script src="api.js"></script> */

const API_URL = 'https://script.google.com/macros/s/AKfycbxSvU7N5ySwYF8cRNS2xOMZxczr0kHH0oLGFnDZNsqSRauCV9EoQcZTa0HV4fOskF_xVA/exec';

const TOKEN_KEY = 'mahaToken';
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
const setToken = t => localStorage.setItem(TOKEN_KEY, t);
const clearToken = () => { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} };

/* استدعاء أي action. بنبعت text/plain عشان نتفادى مشكلة CORS preflight في Apps Script */
async function api(action, data = {}, withToken = true) {
  const body = JSON.stringify({ action, ...data, token: withToken ? getToken() : undefined });
  let res, out;
  try {
    res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
  } catch (e) {
    throw new Error('تعذّر الاتصال بالسيرفر، اتأكدي من الإنترنت وحاولي تاني');
  }
  try {
    out = await res.json();
  } catch (e) {
    throw new Error('السيرفر رجّع رد غير متوقع. اتأكدي إن النشر Web App على Who has access: Anyone');
  }
  if (!out.ok) {
    if (out.error === 'AUTH') { onAuthLost(); throw new Error('انتهت الجلسة، سجّلي دخول من جديد'); }
    throw new Error(out.error || 'حدث خطأ');
  }
  return out.data;
}

function onAuthLost() {
  const role = localStorage.getItem('userRole');
  clearToken();
  ['userRole', 'teacherLoggedIn', 'currentUser'].forEach(k => localStorage.removeItem(k));
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

/* تحميل ملف base64 جاي من السيرفر */
function downloadBase64(fileName, mime, b64) {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName || 'file';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ===== اختصارات جاهزة للصفحات ===== */
const API = {
  signup:       d => api('signup', d, false),        // {name, phone, age, grade, password}
  studentLogin: d => api('studentLogin', d, false),  // {phone, password}
  teacherLogin: d => api('teacherLogin', d, false),  // {password}

  studentData:      () => api('studentData'),
  submitHomework:   async (homeworkId, file) =>
    api('submitHomework', { homeworkId, fileName: file.name, base64: await fileToBase64(file) }),
  deleteSubmission: () => api('deleteSubmission'),

  teacherData:    () => api('teacherData'),
  setStatus:      (phones, status) => api('setStatus', { phones, status }),
  deleteStudent:  phone => api('deleteStudent', { phone }),
  saveItem:       (collection, item) => api('saveItem', { collection, item }),  // lessons | homework | quiz
  deleteItem:     (collection, id) => api('deleteItem', { collection, id }),
  saveWhatsapp:   (grade, link) => api('saveWhatsapp', { grade, link }),
  deleteWhatsapp: grade => api('deleteWhatsapp', { grade }),
  async downloadSubmission(phone) {
    const f = await api('getSubmissionFile', { phone });
    downloadBase64(f.fileName, f.mime, f.base64);
  }
};
