const SubmitForm = (() => {
  const FORM_URL =
    'https://docs.google.com/forms/d/e/' +
    '1FAIpQLSfoqqaLtTwYxCh-SHf_037nAkAJ6cT074EIXyp9fa5Yrp3oGQ' +
    '/formResponse';

  const FIELDS = {
    name:      'entry.75521649',
    office:    'entry.360929184',
    level:     'entry.380105066',
    zip:       'entry.228749755',
    party:     'entry.757427596',
    website:   'entry.1355982586',
    phone:     'entry.510085498',
    email:     'entry.1401526771',
    sourceUrl: 'entry.1010322314',
    notes:     'entry.594491227',
  };

  let currentZip = '';

  function setZip(zip) { currentZip = zip; }

  function open() {
    const modal = document.getElementById('submit-modal');
    const zipField = document.getElementById('sf-zip');
    if (zipField && currentZip) zipField.value = currentZip;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.getElementById('sf-name').focus();
  }

  function close() {
    const modal = document.getElementById('submit-modal');
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    resetForm();
  }

  function resetForm() {
    document.getElementById('submit-official-form').reset();
    setStatus('', false);
  }

  function setStatus(msg, isError = false) {
    const el = document.getElementById('sf-status');
    el.textContent = msg;
    el.className = 'sf-status ' + (isError ? 'sf-error' : msg ? 'sf-success' : '');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const form = e.target;

    // Basic validation
    const name = form['sf-name'].value.trim();
    const office = form['sf-office'].value.trim();
    const zip = form['sf-zip'].value.trim();
    if (!name || !office || !zip) {
      setStatus('Please fill in Name, Office/Title, and ZIP Code.', true);
      return;
    }

    const btn = form.querySelector('.sf-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    // Build form-encoded body using Google Form entry IDs
    const params = new URLSearchParams({
      [FIELDS.name]:      name,
      [FIELDS.office]:    office,
      [FIELDS.level]:     form['sf-level'].value,
      [FIELDS.zip]:       zip,
      [FIELDS.party]:     form['sf-party'].value.trim(),
      [FIELDS.website]:   form['sf-website'].value.trim(),
      [FIELDS.phone]:     form['sf-phone'].value.trim(),
      [FIELDS.email]:     form['sf-email'].value.trim(),
      [FIELDS.sourceUrl]: form['sf-source'].value.trim(),
      [FIELDS.notes]:     form['sf-notes'].value.trim(),
    });

    try {
      // Google Forms requires no-cors - response is always opaque, we assume success
      await fetch(FORM_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      setStatus('Thank you! Your submission has been received and will be reviewed.');
      btn.textContent = 'Submitted ✓';
      setTimeout(close, 2500);
    } catch {
      setStatus('Submission failed - please try again or email us directly.', true);
      btn.disabled = false;
      btn.textContent = 'Submit';
    }
  }

  function init() {
    // Modal close triggers
    document.getElementById('sf-close-btn').addEventListener('click', close);
    document.getElementById('submit-modal-backdrop').addEventListener('click', close);

    // Escape key closes modal
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
    });

    // Form submission
    document.getElementById('submit-official-form').addEventListener('submit', handleSubmit);

    // Open button
    document.getElementById('add-official-btn').addEventListener('click', open);

    // Cancel button (replaces inline onclick removed for CSP compliance)
    document.getElementById('sf-cancel-btn').addEventListener('click', close);
  }

  return { init, setZip, open, close };
})();
