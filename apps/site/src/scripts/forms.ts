// Demo and contact forms: sent to Web3Forms, which e-mails them to us (decision 0022). On success the
// thank-you shows; on failure what was typed stays and the visitor sees how to reach us directly.
// The hidden "botcheck" field is Web3Forms' honeypot: a filled one marks the message as spam.
import { BRAND, FORM_ACCESS_KEY, FORM_ENDPOINT } from '../site';

for (const box of document.querySelectorAll<HTMLElement>('[data-form-box]')) {
  const form = box.querySelector<HTMLFormElement>('form')!;
  const done = box.querySelector<HTMLElement>('[data-part="done"]')!;
  const error = box.querySelector<HTMLElement>('[data-part="error"]')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const label = submit.textContent;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    // Multipart form data (no CORS preflight); ticked boxes with one name become one line.
    const data = new FormData(form);
    const body = new FormData();
    body.set('access_key', FORM_ACCESS_KEY);
    body.set('subject', form.dataset.subject ?? `Website form – ${BRAND}`);
    body.set('from_name', `${BRAND} website`);
    for (const key of new Set(data.keys())) body.set(key, data.getAll(key).map(String).join(', '));
    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const res = await fetch(FORM_ENDPOINT, { method: 'POST', headers: { accept: 'application/json' }, body });
      const reply = (await res.json().catch(() => null)) as { success?: boolean } | null;
      if (!res.ok || !reply?.success) throw new Error(String(res.status));
      form.hidden = true;
      done.hidden = false;
      done.focus();
    } catch {
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
  });

  box.querySelector('[data-part="again"]')?.addEventListener('click', () => {
    form.reset();
    done.hidden = true;
    form.hidden = false;
  });
}
