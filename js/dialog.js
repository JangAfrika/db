/* Themed dialog boxes: replaces native alert / confirm / prompt.
   Usage (all return Promises):
     await uiAlert('Saved.', { title: 'Done', tone: 'success' });
     if (await uiConfirm('Delete this user?', { danger: true, okText: 'Delete' })) { ... }
     const pw = await uiPrompt({ title:'Reset password', message:'...', type:'password', minLength:6 }); // null if cancelled
     const vals = await uiForm({
       title: 'Edit user', okText: 'Save changes',
       fields: [
         { key: 'name', label: 'Name', value: u.name },
         { key: 'role', label: 'Role', type: 'select', value: u.role, options: [{ value: 'MANAGER', label: 'Manager' }] },
         { key: 'screenshot', label: 'Screenshot', type: 'file', required: false } // values.screenshot is a File or null
       ]
     }); // { name, role, ... } or null if cancelled
*/
(function () {
  const ICONS = {
    info: '<path d="M12 8v.01M11 12h1v5h1"/><circle cx="12" cy="12" r="9"/>',
    success: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
    danger: '<path d="M12 4 3 20h18L12 4Z"/><path d="M12 10v4M12 17v.01"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8m-3 3 3 3"/>'
  };

  function h(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function open(o) {
    return new Promise(function (resolve) {
      const prevFocus = document.activeElement;
      const overlay = h('div', 'dlg-overlay');
      const box = h('div', 'dlg');
      box.setAttribute('role', o.kind === 'alert' ? 'alertdialog' : 'dialog');
      box.setAttribute('aria-modal', 'true');
      if (o.kind === 'form') box.classList.add('dlg-wide');

      const tone = o.danger ? 'danger' : (o.tone || 'info');
      const iconName = o.icon || (o.danger ? 'danger' : tone);
      box.appendChild(h('div', 'dlg-icon dlg-' + tone,
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[iconName] || ICONS.info) + '</svg>'));

      const head = h('div', 'dlg-head');
      const titleId = 'dlg-t-' + Date.now();
      head.appendChild(h('h3', 'dlg-title', esc(o.title || '')));
      head.firstChild.id = titleId;
      box.setAttribute('aria-labelledby', titleId);
      if (o.message) head.appendChild(h('p', 'dlg-msg', esc(o.message).replace(/\n/g, '<br>')));
      box.appendChild(head);

      let input = null, err = null;
      if (o.kind === 'prompt') {
        const wrap = h('div', 'dlg-field');
        if (o.label) wrap.appendChild(h('label', 'dlg-label', esc(o.label)));
        const row = h('div', 'dlg-input-row');
        input = document.createElement(o.multiline ? 'textarea' : 'input');
        if (o.multiline) input.rows = 3; else input.type = o.type || 'text';
        input.className = 'dlg-input';
        input.placeholder = o.placeholder || '';
        input.value = o.value || '';
        input.autocomplete = o.type === 'password' ? 'new-password' : 'off';
        row.appendChild(input);
        if (o.type === 'password') {
          const eye = h('button', 'dlg-eye', 'Show');
          eye.type = 'button';
          eye.onclick = function () {
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            eye.textContent = show ? 'Hide' : 'Show';
            input.focus();
          };
          row.appendChild(eye);
        }
        wrap.appendChild(row);
        if (o.hint) wrap.appendChild(h('div', 'dlg-hint', esc(o.hint)));
        err = h('div', 'dlg-error');
        err.setAttribute('role', 'alert');
        wrap.appendChild(err);
        box.appendChild(wrap);
      }

      // Multi-field form: each entry in o.fields becomes its own labelled
      // input/select, all inside the same dialog chrome as the other kinds.
      const fields = [];
      if (o.kind === 'form') {
        (o.fields || []).forEach(function (f) {
          const wrap = h('div', 'dlg-field');
          if (f.label) wrap.appendChild(h('label', 'dlg-label', esc(f.label) + (f.required === false && f.optionalLabel ? ' <span class="dlg-optional">(' + esc(f.optionalLabel) + ')</span>' : '')));
          const row = h('div', 'dlg-input-row');
          let fieldInput, filePreview = null, fileValue = null;
          if (f.type === 'select') {
            fieldInput = document.createElement('select');
            (f.options || []).forEach(function (opt) {
              const o2 = document.createElement('option');
              o2.value = opt.value;
              o2.textContent = opt.label;
              if (opt.value === f.value) o2.selected = true;
              fieldInput.appendChild(o2);
            });
          } else if (f.type === 'file') {
            // An optional image attachment: a small preview box (matching
            // the photo-picker look elsewhere in the app) plus a file input.
            // The chosen File itself — not a string — ends up in values[key].
            filePreview = h('div', 'dlg-photo-thumb');
            filePreview.appendChild(h('span', 'dlg-photo-thumb-empty', esc(f.placeholder || 'No image selected')));
            fieldInput = document.createElement('input');
            fieldInput.type = 'file';
            fieldInput.accept = f.accept || 'image/*';
            fieldInput.addEventListener('change', function () {
              fileValue = fieldInput.files && fieldInput.files[0] ? fieldInput.files[0] : null;
              filePreview.innerHTML = '';
              if (fileValue) {
                const img = document.createElement('img');
                img.src = URL.createObjectURL(fileValue);
                filePreview.appendChild(img);
              } else {
                filePreview.appendChild(h('span', 'dlg-photo-thumb-empty', esc(f.placeholder || 'No image selected')));
              }
            });
            const pickWrap = h('div', 'dlg-photo-pick');
            pickWrap.appendChild(filePreview);
            pickWrap.appendChild(fieldInput);
            row.appendChild(pickWrap);
          } else {
            fieldInput = document.createElement(f.multiline ? 'textarea' : 'input');
            if (f.multiline) fieldInput.rows = f.rows || 3; else fieldInput.type = f.type || 'text';
            fieldInput.placeholder = f.placeholder || '';
            fieldInput.value = f.value || '';
            fieldInput.autocomplete = f.type === 'password' ? 'new-password' : 'off';
          }
          if (f.type !== 'file') { fieldInput.className = 'dlg-input'; row.appendChild(fieldInput); }
          if (f.type === 'password') {
            const eye = h('button', 'dlg-eye', 'Show');
            eye.type = 'button';
            eye.onclick = function () {
              const show = fieldInput.type === 'password';
              fieldInput.type = show ? 'text' : 'password';
              eye.textContent = show ? 'Hide' : 'Show';
              fieldInput.focus();
            };
            row.appendChild(eye);
          }
          wrap.appendChild(row);
          if (f.hint) wrap.appendChild(h('div', 'dlg-hint', esc(f.hint)));
          const fieldErr = h('div', 'dlg-error');
          fieldErr.setAttribute('role', 'alert');
          wrap.appendChild(fieldErr);
          box.appendChild(wrap);
          fieldInput.addEventListener('input', function () { fieldErr.textContent = ''; fieldInput.classList.remove('dlg-invalid'); formErr.textContent = ''; });
          fields.push({ key: f.key, input: fieldInput, err: fieldErr, def: f });
        });
      }
      const formErr = h('div', 'dlg-error');
      if (o.kind === 'form') { formErr.setAttribute('role', 'alert'); box.appendChild(formErr); }

      const actions = h('div', 'dlg-actions');
      let cancelBtn = null;
      if (o.kind !== 'alert') {
        cancelBtn = h('button', 'dlg-btn dlg-cancel', esc(o.cancelText || 'Cancel'));
        cancelBtn.type = 'button';
        actions.appendChild(cancelBtn);
      }
      const okBtn = h('button', 'dlg-btn dlg-ok' + (o.danger ? ' dlg-ok-danger' : ''), esc(o.okText || 'OK'));
      okBtn.type = 'button';
      actions.appendChild(okBtn);
      box.appendChild(actions);

      overlay.appendChild(box);
      document.body.appendChild(overlay);
      requestAnimationFrame(function () { overlay.classList.add('dlg-in'); });
      (input || (fields[0] && fields[0].input) || okBtn).focus();

      function close(val) {
        overlay.classList.remove('dlg-in');
        document.removeEventListener('keydown', onKey, true);
        setTimeout(function () { overlay.remove(); }, 150);
        if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) {}
        resolve(val);
      }
      function submit() {
        if (o.kind === 'prompt') {
          const v = o.trim === false ? input.value : input.value.trim();
          let msg = '';
          if (o.required !== false && !v) msg = 'This field is required.';
          else if (o.minLength && v.length < o.minLength) msg = 'Must be at least ' + o.minLength + ' characters.';
          else if (o.validate) msg = o.validate(v) || '';
          if (msg) { err.textContent = msg; input.classList.add('dlg-invalid'); input.focus(); return; }
          close(v);
        } else if (o.kind === 'form') {
          const values = {};
          let firstBad = null;
          fields.forEach(function (f) {
            const def = f.def;
            if (def.type === 'file') {
              // Unlike the text fields, a file input is optional by default
              // (a screenshot/attachment) — only required when asked for.
              const file = f.input.files && f.input.files[0] ? f.input.files[0] : null;
              let msg = '';
              if (def.required === true && !file) msg = 'Required.';
              else if (def.validate) msg = def.validate(file, values) || '';
              if (msg) {
                f.err.textContent = msg;
                if (!firstBad) firstBad = f.input;
              } else {
                values[f.key] = file;
              }
              return;
            }
            const raw = def.type === 'select' ? f.input.value : f.input.value;
            const v = def.trim === false || def.type === 'select' ? raw : raw.trim();
            let msg = '';
            if (def.required !== false && !v) msg = 'Required.';
            else if (def.minLength && v.length < def.minLength) msg = 'Must be at least ' + def.minLength + ' characters.';
            else if (def.validate) msg = def.validate(v, values) || '';
            if (msg) {
              f.err.textContent = msg;
              f.input.classList.add('dlg-invalid');
              if (!firstBad) firstBad = f.input;
            } else {
              values[f.key] = v;
            }
          });
          if (o.validate) {
            const topMsg = o.validate(values) || '';
            if (topMsg) { formErr.textContent = topMsg; firstBad = firstBad || fields[0].input; }
          }
          if (firstBad) { firstBad.focus(); return; }
          close(values);
        } else close(true);
      }
      function cancel() { close(o.kind === 'prompt' || o.kind === 'form' ? null : (o.kind === 'alert' ? true : false)); }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        else if (e.key === 'Enter' && !(o.multiline && e.target === input) && e.target.tagName !== 'BUTTON') { e.preventDefault(); submit(); }
        else if (e.key === 'Tab') {
          const f = box.querySelectorAll('input,textarea,button');
          const first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      if (input) input.addEventListener('input', function () { err.textContent = ''; input.classList.remove('dlg-invalid'); });
      document.addEventListener('keydown', onKey, true);
      okBtn.onclick = submit;
      if (cancelBtn) cancelBtn.onclick = cancel;
      overlay.addEventListener('mousedown', function (e) { if (e.target === overlay && o.kind !== 'alert') cancel(); });
    });
  }

  function opts(kind, a, b) {
    const o = typeof a === 'object' && a !== null ? Object.assign({}, a) : Object.assign({ message: a }, b || {});
    o.kind = kind;
    return o;
  }
  window.uiAlert = function (m, o) { const x = opts('alert', m, o); x.title = x.title || 'Notice'; return open(x); };
  window.uiConfirm = function (m, o) { const x = opts('confirm', m, o); x.title = x.title || 'Please confirm'; return open(x); };
  window.uiPrompt = function (m, o) { const x = opts('prompt', m, o); x.title = x.title || 'Enter a value'; return open(x); };
  window.uiForm = function (o) { const x = Object.assign({}, o); x.kind = 'form'; x.title = x.title || 'Enter details'; return open(x); };

  // ---- host dialog: show EXISTING page content as a popup ----
  //
  // uiForm() only handles a flat list of simple fields — it can't represent
  // the repeating task/material/equipment rows and photo pickers that the
  // Work Plan and Daily Report forms use. Rather than rewrite that logic,
  // uiHostDialog() temporarily moves the real section into the modal chrome
  // (same overlay/box look as the other dialogs) and puts it back exactly
  // where it came from when the dialog closes — the section's own ids,
  // event listeners and submit handlers never move or get re-created.
  //
  //   const dlg = uiHostDialog(document.getElementById('submitplan'), { title: 'New work plan' });
  //   // ... later, e.g. from the form's own success handler:
  //   dlg.close();
  window.uiHostDialog = function (contentEl, o) {
    o = o || {};
    const placeholder = document.createComment('dlg-host-placeholder');
    contentEl.parentNode.insertBefore(placeholder, contentEl);
    const originalHidden = contentEl.hidden;
    contentEl.hidden = false;

    const prevFocus = document.activeElement;
    const overlay = h('div', 'dlg-overlay dlg-host-overlay');
    const box = h('div', 'dlg dlg-wide dlg-host');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const head = h('div', 'dlg-head dlg-host-head');
    const titleId = 'dlg-t-' + Date.now();
    const titleEl = h('h3', 'dlg-title', esc(o.title || ''));
    titleEl.id = titleId;
    head.appendChild(titleEl);
    const closeBtn = h('button', 'dlg-host-close', '&times;');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    head.appendChild(closeBtn);
    box.setAttribute('aria-labelledby', titleId);
    box.appendChild(head);

    const body = h('div', 'dlg-host-body');
    body.appendChild(contentEl);
    box.appendChild(body);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('dlg-in'); });
    const firstField = contentEl.querySelector('input, select, textarea');
    (firstField || closeBtn).focus();

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      overlay.classList.remove('dlg-in');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(function () {
        overlay.remove();
        // Hand the content back to its original spot in the page, restoring
        // whatever hidden state it had before this dialog opened.
        placeholder.parentNode.insertBefore(contentEl, placeholder);
        placeholder.remove();
        contentEl.hidden = originalHidden;
      }, 150);
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) {}
      if (o.onClose) o.onClose();
    }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
    document.addEventListener('keydown', onKey, true);
    closeBtn.onclick = close;
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });

    return { close: close };
  };
})();
