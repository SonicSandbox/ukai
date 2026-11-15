const el = (id) => document.getElementById(id);
chrome.storage.local.get('token').then((o) => { el('token').value = o.token || ''; });
el('save').onclick = async () => {
  await chrome.storage.local.set({ token: el('token').value.trim() });
  el('msg').textContent = 'Saved.';
};
