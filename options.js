const $ = (id) => document.getElementById(id);

chrome.storage.sync
  .get({ deskUrl: '', deskToken: '', businessName: '' })
  .then((s) => {
    $('deskUrl').value = s.deskUrl;
    $('deskToken').value = s.deskToken;
    $('businessName').value = s.businessName;
  });

$('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({
    deskUrl: $('deskUrl').value.trim(),
    deskToken: $('deskToken').value.trim(),
    businessName: $('businessName').value.trim(),
  });
  $('status').textContent = 'Saved — reload the Yelp reviews page.';
  setTimeout(() => ($('status').textContent = ''), 4000);
});
