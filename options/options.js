const el = (id) => document.getElementById(id);
async function show() {
  const { token } = await chrome.storage.local.get('token');
  el('state').textContent = token ? 'Connected to Surasura.' : 'Not connected. Open Ukai and press Connect.';
  el('forget').hidden = !token;
}
el('forget').onclick = async () => {
  await chrome.storage.local.remove('token');
  el('msg').textContent = 'Disconnected here. (Surasura keeps its side until you press Forget Ukai there.)';
  show();
};
show();
