/* Shared browser-side helpers for Dark Chat (exposed as window.DarkChat). */
(function (global) {
  const byId = (id) => document.getElementById(id);

  const setText = (el, text) => {
    const node = typeof el === 'string' ? byId(el) : el;
    if (node) node.textContent = text;
  };

  const showOverlay = (el) => el.classList.remove('hidden');
  const hideOverlay = (el) => el.classList.add('hidden');

  // Toggles `panel` via `.active` when `btn` is clicked and closes it on any
  // outside click. Used by the emoji picker and the "More" menu.
  function bindDismissablePanel(btn, panel) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('active');
    });
    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && e.target !== btn) {
        panel.classList.remove('active');
      }
    });
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Requests media, alerting the user on failure and returning null.
  async function requestMedia(constraints, errorLabel) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      alert(errorLabel + ': ' + err.message);
      return null;
    }
  }

  function stopStream(stream) {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }

  // Flips the enabled state of the first track of `kind` and syncs the button.
  function toggleTrack(stream, kind, btn, onIcon, offIcon) {
    if (!stream) return;
    const track = (kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks())[0];
    if (!track) return;
    track.enabled = !track.enabled;
    btn.classList.toggle('active', !track.enabled);
    btn.textContent = track.enabled ? onIcon : offIcon;
  }

  global.DarkChat = {
    byId,
    setText,
    showOverlay,
    hideOverlay,
    bindDismissablePanel,
    readFileAsDataURL,
    requestMedia,
    stopStream,
    toggleTrack
  };
})(window);
