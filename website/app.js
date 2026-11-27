const briefs = {
  reel: ['“Turn this interview into a 30-second vertical reel. Lead with the strongest idea, tighten the pauses, and give it readable, animated captions.”', 'The hook. The framing. The pace. Captions that leave the speaker room.'],
  interview: ['“Make this conversation flow. Remove long pauses and repeated takes, keep the speaker’s meaning, and use a quiet caption style.”', 'Natural speech boundaries. A clear thread. Space for the conversation to breathe.'],
  launch: ['“Cut a concise product story from these clips. Open with the problem, show the product in action, and finish with a simple title.”', 'A coherent story. Restrained motion. Titles and colour that feel like one piece.']
};
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-prompt]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  const [brief, details] = briefs[button.dataset.prompt];
  document.getElementById('brief-text').textContent = brief;
  document.getElementById('brief-details').textContent = details;
}));
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = 'Copied'; document.getElementById('copy-status').textContent = 'Login command copied.'; setTimeout(() => button.textContent = 'Copy', 2000); }
  catch { document.getElementById('copy-status').textContent = 'Copy unavailable. Select the command and copy it manually.'; }
}));
