import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

interface InstallEvent extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PwaControls({ onBeforeUpdate }: { onBeforeUpdate: () => Promise<void> }) {
  const installEvent = useRef<InstallEvent | null>(null);
  const updateWorker = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);
  const [installable, setInstallable] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const updateButton = useRef<HTMLButtonElement>(null);
  const reloadApproved = useRef(false);
  const workerNeedsReload = useRef(false);

  useEffect(() => {
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      installEvent.current = event as InstallEvent;
      setInstallable(true);
    };
    const afterInstall = () => {
      installEvent.current = null;
      setInstallable(false);
      setInstalled(true);
    };
    setInstalled(window.matchMedia?.('(display-mode: standalone)').matches ?? false);
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', afterInstall);
    updateWorker.current = registerSW({
      onNeedRefresh: () => setUpdateReady(true),
      onNeedReload: () => {
        workerNeedsReload.current = true;
        if (reloadApproved.current) {
          window.location.reload();
        } else {
          setUpdateReady(true);
          setMessage('An app update was activated in another tab. This tab will not reload until you choose to sign out and update.');
        }
      },
      onOfflineReady: () => setMessage('App shell ready offline. Sign-in and personal agenda are not saved.'),
      onRegisterError: () => setMessage('Offline shell unavailable. You can still use the app online.'),
    });
    return () => {
      installEvent.current = null;
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', afterInstall);
    };
  }, []);

  useEffect(() => {
    if (updateOpen && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [updateOpen]);

  async function install() {
    const event = installEvent.current;
    if (!event) return;
    installEvent.current = null;
    setInstallable(false);
    try {
      const result = await event.prompt();
      setMessage(result.outcome === 'accepted'
        ? 'Installation requested. The app still needs a fresh sign-in after reopening.'
        : 'Installation dismissed. You can keep using this browser tab.');
    } catch {
      setMessage('Installation is not available. Use your browser’s install or Add to Home Screen menu if offered.');
    }
  }

  async function update() {
    if (updating) return;
    setUpdating(true);
    try {
      await onBeforeUpdate();
      reloadApproved.current = true;
      if (workerNeedsReload.current) {
        window.location.reload();
      } else {
        await updateWorker.current?.(true);
      }
      setMessage('Update requested. If the page does not reload, close and reopen it when ready.');
      closeDialog();
    } catch {
      reloadApproved.current = false;
      setMessage('The update could not be applied. Your local sign-in has been cleared. Reopen when ready.');
      closeDialog();
    } finally {
      setUpdating(false);
    }
  }

  function closeDialog() {
    dialog.current?.close();
    setUpdateOpen(false);
    updateButton.current?.focus();
  }

  return <div className="pwa-controls">
    {installable && !installed && <button className="button header-button" onClick={() => void install()}>Install app</button>}
    {updateReady && <button className="button header-button" ref={updateButton} onClick={() => setUpdateOpen(true)}>Update available</button>}
    <details className="install-help"><summary aria-label="Installation and offline information">App info</summary><div className="install-popover"><strong>{installed ? 'Running as an installed app' : 'Take the companion with you'}</strong><p>Use your browser’s Install app or Add to Home Screen option if offered. Installation support varies by browser.</p><p>Only the app shell is saved offline. A new tab or reopened app needs sign-in again; this open tab can show its current memory agenda.</p>{message && <p role="status">{message}</p>}</div></details>
    <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); if (!updating) closeDialog(); }} onClose={() => setUpdateOpen(false)} aria-labelledby="update-title" aria-describedby="update-description">
      <h2 id="update-title">Ready for a fresh start?</h2>
      <p id="update-description">Updating reloads this page, signs you out, and clears your memory-only agenda. No personal data will be restored afterward. Server sign-out may not be confirmed if you are offline.</p>
      <div className="dialog-actions"><button className="button secondary" disabled={updating} onClick={closeDialog}>Not now</button><button className="button primary" disabled={updating} onClick={() => void update()}>{updating ? 'Updating…' : 'Sign out & update'}</button></div>
    </dialog>
  </div>;
}
