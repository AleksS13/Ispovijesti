// public/js/main.js
document.addEventListener('click', async (e) => {
  // LIKE
  const likeBtn = e.target.closest('.like-btn');
  if (likeBtn) {
    e.preventDefault();

    // spriječi dvostruke klikove
    if (likeBtn.dataset.busy === '1') return;
    likeBtn.dataset.busy = '1';

    const id = likeBtn.getAttribute('data-id');
    try {
      const resp = await fetch(`/confessions/${id}/like`, {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
      });

      // Ako nismo dobili JSON (npr. redirect na login), pošalji korisnika na login
      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        window.location.href = '/auth/login';
        return;
      }

      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || 'Greška pri lajkovanju');

      // broj lajkova
      const counter = document.querySelector(`#like-count-${id}`);
      if (counter) counter.textContent = data.count;

      // vizuelni state
      if (data.liked) {
        likeBtn.classList.remove('btn-outline-primary');
        likeBtn.classList.add('btn-primary');
      } else {
        likeBtn.classList.add('btn-outline-primary');
        likeBtn.classList.remove('btn-primary');
      }
    } catch (err) {
      console.error(err);
      alert(err.message || 'Greška pri lajkovanju');
    } finally {
      likeBtn.dataset.busy = '0';
    }
    return; // spriječi padanje na approve handler ispod
  }

  // APPROVE
  const approveBtn = e.target.closest('.approve-btn');
  if (approveBtn) {
    e.preventDefault();

    if (approveBtn.dataset.busy === '1') return;
    approveBtn.dataset.busy = '1';

    const id = approveBtn.getAttribute('data-id');
    try {
      const resp = await fetch(`/confessions/${id}/approve`, {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
      });

      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        // approve je dozvoljen i gostima u tvom kodu, ali za svaki slučaj:
        window.location.href = '/auth/login';
        return;
      }

      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || 'Greška pri odobravanju');

      // disable & label
      approveBtn.classList.add('disabled');
      approveBtn.textContent = 'Odobreno';

      // badge status
      const badge = document.querySelector(`.status-badge[data-id="${id}"]`);
      if (badge && data.status) {
        badge.textContent = data.status;
        if (data.status === 'published') {
          badge.classList.remove('bg-secondary');
          badge.classList.add('bg-success');
        }
      }
    } catch (err) {
      console.error(err);
      alert(err.message || 'Greška pri odobravanju');
    } finally {
      approveBtn.dataset.busy = '0';
    }
  }
});
