(function () {
  const { validateImage, formatBytes } = window.WebHelpers;
  const $ = (id) => document.getElementById(id);
  const els = {
    status: $('status'), drop: $('drop'), file: $('file'), preview: $('preview'),
    shot: $('shot'), meta: $('meta'), replace: $('replace'), remove: $('remove'),
  };
  const LEAD = 'No screenshot yet. Screenshot your X audience page and drop it here.';
  let objectUrl = null;

  function setStatus(text, isError = false) {
    els.status.textContent = text;
    els.status.classList.toggle('error', isError);
  }

  function releaseImage() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function showImage(file) {
    releaseImage();
    objectUrl = URL.createObjectURL(file);
    els.shot.src = objectUrl;
    els.meta.textContent = `${file.name || 'Pasted image'} · ${formatBytes(file.size)}`;
    els.preview.hidden = false;
    els.drop.hidden = true;
    setStatus('Screenshot ready.');
  }

  function reset() {
    releaseImage();
    els.shot.removeAttribute('src');
    els.meta.textContent = '';
    els.preview.hidden = true;
    els.drop.hidden = false;
    els.file.value = '';
    setStatus(LEAD);
    els.drop.focus();
  }

  function accept(file) {
    const result = validateImage(file);
    if (!result.ok) {
      setStatus(result.error, true);
      return;
    }
    showImage(file);
  }

  const firstFile = (dt) => (dt && dt.files && dt.files[0]) || null;

  function bindDropTarget(el) {
    const over = (e) => { e.preventDefault(); el.classList.add('dragging'); };
    el.addEventListener('dragenter', over);
    el.addEventListener('dragover', over);
    el.addEventListener('dragleave', (e) => {
      if (e.relatedTarget && el.contains(e.relatedTarget)) return;
      el.classList.remove('dragging');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('dragging');
      const file = firstFile(e.dataTransfer);
      if (file) accept(file);
    });
  }
  bindDropTarget(els.drop);
  bindDropTarget(els.preview);

  // A file dropped anywhere else must not make the browser navigate to it.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  els.drop.addEventListener('click', () => els.file.click());
  els.replace.addEventListener('click', () => els.file.click());
  els.remove.addEventListener('click', reset);

  els.file.addEventListener('change', () => {
    const file = els.file.files && els.file.files[0];
    if (file) accept(file);
    els.file.value = ''; // lets the same file be chosen again
  });

  document.addEventListener('paste', (e) => {
    const file = firstFile(e.clipboardData);
    if (!file) return; // plain-text paste keeps working
    e.preventDefault();
    accept(file);
  });
})();
