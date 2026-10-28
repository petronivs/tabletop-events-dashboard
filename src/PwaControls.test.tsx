import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PwaControls } from './PwaControls';
import { applyUpdate, callbacks } from './test/pwa-register';

beforeEach(() => {
  applyUpdate.mockResolvedValue(undefined);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true, value() { this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true, value() { this.removeAttribute('open'); },
  });
});

describe('install and update honesty', () => {
  it('only offers installation when the browser supplies a prompt and explains offline limits', async () => {
    render(<PwaControls onBeforeUpdate={vi.fn()} />);
    const user = userEvent.setup();
    expect(screen.queryByRole('button', { name: 'Install app' })).not.toBeInTheDocument();
    await user.click(screen.getByText('App info'));
    expect(screen.getByText(/Only the app shell is saved offline/)).toBeInTheDocument();
    const prompt = vi.fn().mockResolvedValue({ outcome: 'accepted' });
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt });
    act(() => { fireEvent(window, event); });
    expect(event.defaultPrevented).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Install app' }));
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent('fresh sign-in after reopening');
    expect(screen.queryByRole('button', { name: 'Install app' })).not.toBeInTheDocument();
  });

  it('never applies an update automatically and requires a sign-out and reload confirmation', async () => {
    const signOut = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    render(<PwaControls onBeforeUpdate={signOut} />);
    const user = userEvent.setup();
    act(() => callbacks.onNeedRefresh?.());
    expect(applyUpdate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Update available' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Ready for a fresh start?');
    expect(dialog).toHaveAccessibleDescription(/clears your memory-only agenda/);
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(applyUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Update available' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Update available' }));
    await user.click(screen.getByRole('button', { name: 'Sign out & update' }));
    await waitFor(() => expect(applyUpdate).toHaveBeenCalledWith(true));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut.mock.invocationCallOrder[0]).toBeLessThan(applyUpdate.mock.invocationCallOrder[0]);
  });

  it('describes shell availability and registration failure without exposing technical errors', async () => {
    render(<PwaControls onBeforeUpdate={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByText('App info'));
    act(() => callbacks.onOfflineReady?.());
    expect(screen.getByRole('status')).toHaveTextContent('personal agenda are not saved');
    act(() => callbacks.onRegisterError?.());
    expect(screen.getByRole('status')).toHaveTextContent('Offline shell unavailable');
  });

  it('does not reload or sign out when another tab activates an update', async () => {
    const signOut = vi.fn<() => Promise<void>>();
    render(<PwaControls onBeforeUpdate={signOut} />);
    const user = userEvent.setup();
    act(() => callbacks.onNeedReload?.());
    expect(screen.getByRole('button', { name: 'Update available' })).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
    expect(applyUpdate).not.toHaveBeenCalled();
    await user.click(screen.getByText('App info'));
    expect(screen.getByRole('status')).toHaveTextContent('This tab will not reload until you choose');
  });
});
