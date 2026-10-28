import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ScheduleClient } from './api';
import type { AgendaRow, DeveloperCredentials, ScheduleSnapshot } from './domain';
import { clock, dayKey, dayLabel, filterRows, refreshedLabel } from './agenda-view';
import type { AgendaFilters } from './agenda-view';
import { useAgenda } from './useAgenda';
import { PwaControls } from './PwaControls';

const defaultFilters: AgendaFilters = { date: 'all', role: 'all', search: '' };

function SignIn({ submit, busy, online }: {
  submit: (input: DeveloperCredentials) => Promise<void>;
  busy: string | null;
  online: boolean;
}) {
  const [credentials, setCredentials] = useState<DeveloperCredentials>({
    username: '', password: '', apiKeyId: '',
  });
  const submitting = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || busy || !online) return;
    submitting.current = true;
    try {
      await submit({ ...credentials });
    } finally {
      setCredentials({ username: '', password: '', apiKeyId: '' });
      submitting.current = false;
    }
  }

  return <section className="welcome-grid" aria-labelledby="welcome-title">
    <div className="welcome-copy">
      <p className="eyebrow">LESS SCROLLING. MORE PLAYING.</p>
      <h1 id="welcome-title">Your convention.<br /><span>Your next adventure.</span></h1>
      <p className="lede">One clear agenda for the games you’re hosting and the events you’re attending.</p>
      <div className="benefit"><span aria-hidden="true">01</span><div><h2>Every role, one place</h2><p>Hosted events and confirmed tickets, brought together without losing either role.</p></div></div>
      <div className="benefit"><span aria-hidden="true">02</span><div><h2>Convention time, not guesswork</h2><p>Dates, rooms, and times in the convention’s own timezone.</p></div></div>
      <div className="benefit"><span aria-hidden="true">03</span><div><h2>Yours for this session</h2><p>No saved passwords. No personal agenda stored on your device.</p></div></div>
      <p className="independent">An independent companion for Tabletop.events. Not an official Tabletop.events application.</p>
    </div>
    <div className="panel sign-in-panel">
      <span className="section-marker" aria-hidden="true">LET’S GET YOU TO THE TABLE</span>
      <h2>Developer account sign-in</h2>
      <p>This MVP is limited to Tabletop.events developer accounts. It is not regular Tabletop.events single sign-on.</p>
      <form onSubmit={(event) => void handleSubmit(event)} aria-label="Developer account sign-in" aria-describedby="sign-in-privacy">
        <fieldset disabled={!!busy || !online} className="plain-fieldset">
          <label htmlFor="username">Developer username</label>
          <input id="username" name="username" autoComplete="off" autoCapitalize="none" spellCheck={false} required value={credentials.username} onChange={(event) => setCredentials({ ...credentials, username: event.target.value })} />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="off" required value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} />
          <label htmlFor="apiKeyId">API key ID <span className="label-note">not your private key</span></label>
          <input id="apiKeyId" name="apiKeyId" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} required value={credentials.apiKeyId} onChange={(event) => setCredentials({ ...credentials, apiKeyId: event.target.value })} />
          <p id="sign-in-privacy" className="privacy-note">Credentials go directly to Tabletop.events over HTTPS. Sign-in is memory-only: reloading or closing this page ends access here. No “remember me.” Fields clear after every attempt. Your browser’s password manager is controlled by you.</p>
          <button className="button primary wide" type="submit">{busy === 'Signing in…' ? 'Signing in…' : 'Sign in securely'} <span aria-hidden="true">↗</span></button>
        </fieldset>
      </form>
      <p className="help-link">Need developer access? <a href="https://tabletop.events/developer/APIKey.html" target="_blank" rel="noopener noreferrer">Read the official API key guide <span aria-hidden="true">↗</span></a></p>
      <p className="small muted">Authenticated browser compatibility is not yet live-verified. Unsupported access will show an error, never a sample agenda.</p>
    </div>
  </section>;
}

function EventCard({ row, timeZone }: { row: AgendaRow; timeZone: string }) {
  const location = [row.roomName, row.spaceName].filter(Boolean).join(' · ');
  return <li className={`event-card${row.cancelled || row.trashed ? ' event-inactive' : ''}`}>
    <div className="event-time">
      {row.startUtc ? <>
        <time dateTime={row.startUtc}>{clock(row.startUtc, timeZone)}</time>
        {row.endUtc ? <span>to <time dateTime={row.endUtc}>{clock(row.endUtc, timeZone)}{dayKey(row.startUtc, timeZone) !== dayKey(row.endUtc, timeZone) ? ` · ${dayLabel(row.endUtc, timeZone)}` : ''}</time></span> : <span>End time unknown</span>}
      </> : <span className="unknown-time">Time not scheduled</span>}
    </div>
    <div className="event-details">
      <div className="event-tags">
        {row.roles.includes('hosting') && <span className="role-tag hosting">Hosting</span>}
        {row.roles.includes('attending') && <span className="role-tag attending">Attending <span className="sr-only">(confirmed ticket)</span></span>}
        {row.cancelled && <span className="status-tag">Cancelled</span>}
        {row.trashed && <span className="status-tag">Removed from public schedule</span>}
        {!row.publishedToSchedule && <span className="status-tag">Unpublished</span>}
        {!row.isScheduled && <span className="status-tag">Unscheduled</span>}
      </div>
      <h3>{row.name}</h3>
      {row.sessionName && <p className="session-name">{row.sessionName}</p>}
      <p className="event-location"><span aria-hidden="true">◇ </span>{location || 'Location not announced'}{row.eventNumber && <span className="event-number"> · #{row.eventNumber}</span>}</p>
      {row.durationMinutes !== null && <p className="duration">{row.durationMinutes} min{row.objectType === 'eventsession' ? ' · Additional session' : ''}</p>}
    </div>
  </li>;
}

function Agenda({ snapshot, stale, busy, filters, setFilters }: {
  snapshot: ScheduleSnapshot;
  stale: boolean;
  busy: boolean;
  filters: AgendaFilters;
  setFilters: (value: AgendaFilters) => void;
}) {
  const rows = filterRows(snapshot.rows, snapshot.timeZone, filters);
  const days = new Map<string, AgendaRow[]>();
  const allDays = new Map<string, string>();
  for (const row of filterRows(snapshot.rows, snapshot.timeZone, defaultFilters)) {
    allDays.set(dayKey(row.startUtc, snapshot.timeZone), dayLabel(row.startUtc, snapshot.timeZone));
  }
  for (const row of rows) {
    const key = dayKey(row.startUtc, snapshot.timeZone);
    days.set(key, [...(days.get(key) ?? []), row]);
  }
  return <>
    <div className={`freshness${stale ? ' stale' : ''}`}>
      <span className="freshness-dot" aria-hidden="true" />
      <p>{stale ? 'Showing previous agenda. ' : busy ? 'Refreshing; showing previous agenda. ' : 'Last complete refresh: '}
        <time dateTime={snapshot.refreshedAt}>{refreshedLabel(snapshot.refreshedAt, snapshot.timeZone)}</time>
        {(stale || busy) && <span> · Last successful refresh</span>}
      </p>
    </div>
    <div className="filter-bar" role="search" aria-label="Filter agenda">
      <div className="search-field"><label htmlFor="agenda-search">Search agenda</label><input id="agenda-search" type="search" placeholder="Event, room, or number…" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></div>
      <div><label htmlFor="agenda-day">Day</label><select id="agenda-day" value={filters.date} onChange={(event) => setFilters({ ...filters, date: event.target.value })}><option value="all">All days</option>{[...allDays].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      <div><label htmlFor="agenda-role">Your role</label><select id="agenda-role" value={filters.role} onChange={(event) => setFilters({ ...filters, role: event.target.value as AgendaFilters['role'] })}><option value="all">All roles</option><option value="hosting">Hosting</option><option value="attending">Attending</option></select></div>
    </div>
    <p className="results-meta" role="status">{rows.length} {rows.length === 1 ? 'session' : 'sessions'} shown · All times: <strong>{snapshot.timeZone}</strong></p>
    {rows.length ? [...days].map(([key, group]) => <section key={key} className="agenda-day" aria-label={dayLabel(group[0].startUtc, snapshot.timeZone)}>
      <h2 className="day-heading">{dayLabel(group[0].startUtc, snapshot.timeZone)}<span>{group.length} {group.length === 1 ? 'session' : 'sessions'}</span></h2>
      <ul className="event-list">{group.map((row) => <EventCard key={row.key} row={row} timeZone={snapshot.timeZone} />)}</ul>
    </section>) : <div className="empty-state panel">
      <span className="empty-symbol" aria-hidden="true">◇</span>
      <h2>{snapshot.rows.length ? 'No matching events' : 'Your agenda has room for adventure'}</h2>
      <p>{snapshot.rows.length ? 'Try another day, role, or search term.' : 'No hosted events or confirmed event tickets were found for this selection. Select a badge to include its attending events, or keep hosting only.'}</p>
      {snapshot.rows.length > 0 && <button className="button secondary" onClick={() => setFilters(defaultFilters)}>Clear filters</button>}
    </div>}
    <p className="small muted agenda-note">Hosting and confirmed-ticket roles apply to every session of an event. Cancellations and unpublished events stay visible. A complete refresh is not a transactional server snapshot.</p>
  </>;
}

export function App({ client }: { client: ScheduleClient }) {
  const model = useAgenda(client);
  const [filters, setFilters] = useState<AgendaFilters>(defaultFilters);
  const selectionName = model.conventions.find((choice) => choice.id === model.conventionId)?.name;
  const isSigningIn = model.busy === 'Signing in…';
  const isSigningOut = model.busy === 'Signing out…';
  const title = model.snapshot?.convention.name ?? selectionName ?? 'Make room for a great convention.';
  const previousAuth = useRef(model.authenticated);

  useEffect(() => {
    if (previousAuth.current !== model.authenticated) {
      document.getElementById('main')?.focus();
      previousAuth.current = model.authenticated;
    }
  }, [model.authenticated]);

  return <>
    <a className="skip-link" href="#main">Skip to main content</a>
    <header className="site-header">
      <div className="header-inner">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="Convention Companion home (reloads and ends this session)"><img src={`${import.meta.env.BASE_URL}icons/companion.svg`} width="42" height="42" alt="" /><span>Convention<span>Companion</span></span></a>
        <div className="header-actions">
          <span className={`connection${model.online ? '' : ' offline'}`}><span aria-hidden="true">●</span> {model.online ? 'Online' : 'Offline'}</span>
          <PwaControls onBeforeUpdate={model.logout} />
          {(model.authenticated || isSigningIn) && <button className="button header-button" disabled={isSigningOut} onClick={() => void model.logout()}>{isSigningIn ? 'Cancel sign-in' : 'Sign out'}</button>}
        </div>
      </div>
    </header>
    <main id="main" tabIndex={-1}>
      {!model.online && <div className="banner warning" role="status"><strong>You’re offline.</strong> {model.snapshot ? 'You can view this open tab’s memory-only agenda. It may be out of date. Reconnect for a complete refresh.' : 'Only the app shell is available offline. No saved sign-in or agenda is available; reconnect to sign in and load your events.'}</div>}
      {model.notice && <div className="banner" role="status">{model.notice}</div>}
      {model.error && <div className="banner error" role="alert"><strong>We couldn’t complete that request.</strong> {model.error}</div>}
      {model.busy && <div className="loading-banner" role="status"><span className="spinner" aria-hidden="true" />{model.busy} <span className="muted">Large conventions can take a few minutes; requests are paced politely.</span></div>}
      {!model.authenticated ? <SignIn key={model.credentialEpoch} submit={model.login} busy={model.busy} online={model.online} /> : <div className="dashboard-layout">
        <aside className="selection-panel" aria-label="Choose your agenda">
          <section className="panel selection-card">
            <p className="eyebrow">YOUR PERSONAL LINEUP</p>
            <h2><span className="step-number">1</span> Pick your convention</h2>
            <label htmlFor="convention">Convention</label>
            <select id="convention" value={model.conventionId} disabled={isSigningOut || !model.online} onChange={(event) => { setFilters(defaultFilters); model.chooseConvention(event.target.value); }}><option value="">Choose a convention…</option>{model.conventions.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select>
            {!model.conventions.length && !model.busy && <p className="small">{model.conventionsReady ? 'No conventions with verified owned badges or hosted events were found for this account.' : 'Your convention choices could not be loaded. Try reloading below.'}</p>}
            <button className="text-button" disabled={!!model.busy || !model.online} onClick={() => { setFilters(defaultFilters); void model.discover(); }}>Reload convention choices</button>
            {model.conventionId && <>
              <hr />
              <h2><span className="step-number">2</span> Choose your badges</h2>
              <p className="small">Select only the badges whose confirmed tickets you want to include. Hosted events are always included.</p>
              <fieldset className="badge-fieldset" disabled={!model.badgesReady || isSigningOut || !model.online}><legend className="sr-only">Attending badges</legend>
                {model.badges.map((badge) => <label className="badge-choice" key={badge.id}><input type="checkbox" checked={model.badgeIds.includes(badge.id)} onChange={(event) => { setFilters(defaultFilters); model.chooseBadge(badge.id, event.target.checked); }} /><span>{badge.label}</span></label>)}
              </fieldset>
              {model.badgesReady && model.badges.length === 0 && <p className="small">No eligible owned badges found. You can still load your hosted events.</p>}
              {!model.badgesReady && !model.busy && <button className="text-button" disabled={!model.online} onClick={() => model.chooseConvention(model.conventionId)}>Retry badge lookup</button>}
              <div className="selection-summary">{model.badgeIds.length === 0 ? 'Hosting only · No badges selected' : `Hosting + attending · ${model.badgeIds.length} ${model.badgeIds.length === 1 ? 'badge' : 'badges'} selected`}</div>
              <button className="button primary wide" disabled={!!model.busy || !model.badgesReady || !model.online} onClick={() => void model.refresh()}>{model.snapshot ? 'Refresh agenda' : 'Load my agenda'} <span aria-hidden="true">↗</span></button>
            </>}
          </section>
          <div className="session-note"><span aria-hidden="true">◈</span><div><strong>Private by design</strong><p>Your session and agenda live only in this page’s memory. Reloading, closing, or signing out clears access here.</p></div></div>
        </aside>
        <section className="agenda-panel" aria-labelledby="agenda-title" aria-busy={!!model.busy}>
          <div className="agenda-heading"><p className="eyebrow">YOUR CONVENTION, AT A GLANCE</p><h1 id="agenda-title">{title}</h1><p>{model.snapshot ? 'Your tables. Your tickets. A little less to keep track of.' : 'Choose a convention and your badges, then load your complete agenda.'}</p></div>
          {model.snapshot ? <Agenda snapshot={model.snapshot} stale={!!model.error || !model.online} busy={!!model.busy} filters={filters} setFilters={setFilters} /> : <div className="empty-state panel"><span className="empty-symbol" aria-hidden="true">◇</span><h2>{model.busy ? 'Bringing your lineup together' : model.conventionId ? 'Your selection, your schedule' : 'A great day starts with a plan'}</h2><p>{model.busy ? 'We’ll show your agenda only when the complete selection is ready. You can sign out at any time.' : model.conventionId ? 'Choose any attending badges, or leave them unchecked for hosting only. Then select “Load my agenda.”' : 'Pick a convention from your verified badges and hosted events to get started.'}</p></div>}
        </section>
      </div>}
    </main>
    <footer className="site-footer"><p>Made for the moments around the table.</p><p>App shell only offline · No personal data saved · <a href="https://tabletop.events/developer/Introduction.html" target="_blank" rel="noopener noreferrer">Tabletop.events API docs <span aria-hidden="true">↗</span></a></p></footer>
  </>;
}
