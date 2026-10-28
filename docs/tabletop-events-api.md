# Tabletop.Events API reference (for a third-party dashboard)

Researched 2026-10-28. Tabletop.Events (TTE) is run by the team behind The Game Crafter (TGC), and both sites use the same "Wing" REST framework from Plain Black Corporation.

How claims are marked:

- No marker: stated in the official TTE developer docs at `https://tabletop.events/developer/`.
- **(observed)**: seen in live, unauthenticated responses from the public API on 2026-10-28. This is real behaviour, but it is not documented and could change.
- **(TGC docs)**: stated in The Game Crafter's docs, which use the same framework, but not in the TTE docs.
- **(unverified)**: my own inference. Check it before relying on it.

The docs warn that TTE may change the API at any time without notice, and that TTE gives no technical support for API clients.

---

## 1. Base URL and versioning

- Docs index: `https://tabletop.events/developer/Introduction.html`. The `/developer` URL itself returns a 404.
- API root: `https://tabletop.events/api/`. Every object path in the docs is relative to `https://tabletop.events/`, for example `GET https://tabletop.events/api/convention/{id}`.
- The URL carries no version number and the docs describe no versioning. Changes are announced on the **Deprecation Notices** page (`/developer/DeprecationNotices.html`), which lists renamed endpoints and fields with dates (2025-01, 2026-02, 2026-08).
- Liveness check: `GET /api/status` returns `{"result":{"datetime":"YYYY-MM-DD HH:MM:SS"}}`.
- Echo sandbox: `/api/_test` accepts GET, PUT, POST and DELETE, and echoes back your `params`, `method` and `path`. It is useful for testing a client.

## 2. Authentication, sessions and privileges

### Getting an API key

1. Log in to tabletop.events.
2. In account preferences, answer the developer question with "Yes" and save.
3. Click the **API Keys** link that now appears, and request a key. Keys are free.

An APIKey object has `id`, `name`, `user_id`, `uri`, `reason` and `private_key`. Only the owner can see `private_key`. When logging in you pass the key's **`id`** as `api_key_id`. The tabletop.js README calls this value the "Public Key".

Never commit the key id, the private key or the account password. Load them from environment variables or a secrets store.

### Starting a session

```
POST /api/session
  username=<USERNAME>
  password=<PASSWORD>
  api_key_id=<API_KEY_ID>
```

The response is `{"result": {"id": "<SESSION_ID>", "object_type": "session", "user_id": "...", ...}}`, where `result.id` is the session id.

- **Only developer accounts can log in this way.** Ordinary users are supposed to use Single Sign-On instead. The TTE SingleSignOn page says TTE does **not** currently let external programs authenticate on behalf of users, and that you should email info@tabletop.events to ask.
- On TGC the SSO endpoint is `POST /api/session/sso/{id}` with `private_key` **(TGC docs)**. TTE does not document an equivalent.
- What this means for a dashboard: it can only act as **your own developer account**. It sees what that account sees and cannot sign in as other organizers or attendees **(unverified, but follows from the above)**.

### Sending the session

- Send `session_id` either as a **cookie** or as a **query/form parameter**.
- The tabletop.js community client sends `session_id` as a field in the JSON body of POST and DELETE requests **(observed in source)**.
- If you send no session, you get the **public** result set. With a session, you also get **private** data that the session's user has privileges for.

### Other session endpoints

- `GET /api/session/{session_id}`: returns the session's `id`, `user_id`, and `extended`, a counter of how many times the session has been extended by activity. The page also lists `ip_address` as a session property.
- `DELETE /api/session/{session_id}`: logs out and returns `{"success": 1}`.

### Session lifetime

The docs do not say how long a session lasts. The `extended` counter suggests a sliding expiry that renews when you use the session. Error code **451 Session Expired** means you need to log in again. Handle 451 by logging in again and retrying once **(unverified pattern)**.

### Privileges

Private convention data depends on **ConventionPrivilege** flags, which a convention admin grants to a user. Each flag is a 0/1 integer:

`cashdrawers`, `everything`, `exhibitors`, `financials`, `merch`, `pages`, `pos`, `registration`, `scheduling`, `updates`, `volunteers`

A read-only `some` field is 1 when the user holds any of these flags. The User docs say that "running" a convention means holding privileges through ConventionPrivilege **or** through the Group that owns the convention.

Privileges each object's page names:

| Object | Privilege named in the docs |
|---|---|
| Badge | `registration` to edit. Users always see their own badges. Users with `registration` or `pos` see all badges in a convention. Friends can see each other's badges in some cases. |
| BadgeType | `registration` to edit |
| Ticket | `registration`. Search results also include tickets on badges you own, and tickets for conventions where you have `merch`. |
| EventType, Space, Slot | `scheduling` |
| Room | `scheduling` or `exhibitors` |
| ConventionDay, DayPart, ConventionPrivilege | `everything` |
| User (read/update) | Admin, or the user themselves |
| `GET /api/user/{id}/events-hosted` and `/events-reserved` with `convention_id` | `scheduling` |

Many object pages state a privilege for the whole object, but public reads of events, days and so on still work without a session **(observed)**. So treat the privilege notes as applying to writes and to private fields, not to every read **(unverified)**.

Property tables also mark individual fields as viewable by "Everyone" or "Owner". For example, Event `priority` and APIKey `private_key` are owner-only.

## 3. Request and response conventions

- **Verbs:** POST creates, GET reads, PUT updates, DELETE deletes. Parameters can be sent as form fields (the docs' curl examples use `-F`) or as a query string. The tabletop.js client sends JSON bodies **(observed)**.
- **Method tunnelling:** You can send a POST with an `X-HTTP-Method` header or query parameter set to the real verb.
- **IDs:** 36-character GUID strings. They are case-sensitive, so store them exactly as returned.
- **Success:** The response is `{"result": {...}}`. A delete returns `{"result": {"success": 1}}`.
- **Errors:** The response is `{"error": {"code": <int>, "message": "<safe to display>", "data": <null or debug info, such as a field name>}}`.
- **Warnings:** Non-fatal problems appear in `result._warnings`, an array of `{code, message, data}`.
- **Common fields:** Every object has `id`, `date_created`, `date_updated`, `view_uri`, `edit_uri`, `object_type` and `object_name`.
- **Enumerations:** `GET /api/{type}/_options`, or `_include_options=1` on a single read, returns the allowed values for enumerated fields.
- **HTTP status:** A request for an unknown object id returned HTTP 404 **(observed)**. Whether the HTTP status always matches `error.code` is unverified.

### Error codes (from `/developer/ErrorCodes.html`)

| Code | Meaning |
|---|---|
| 404 | Resource not found (the URI does not exist) |
| 440 | Object not found |
| 441 | Missing required parameter |
| 442 | Out of range (a bad number or enum value) |
| 443 | Not available (already in use) |
| 444 / 445 | File type not supported / file mismatch |
| 446 | Payment declined |
| 450 | Insufficient privileges |
| 451 | Session expired |
| 452 | RPC request limit exceeded (too many requests per minute) |
| 453 | Prerequisite failed |
| 454 | Password incorrect |
| 499 | Offline processing (the request was moved to a background job) |
| 500 | Undefined error (the docs treat this as a bug) |
| 504 | Could not connect to an upstream resource |

## 4. Paging, sorting, filtering and includes

### Paging

| Param | Default | Notes |
|---|---|---|
| `_items_per_page` | 25 | Documented range is 1 to 100 |
| `_page_number` | 1 | |
| `_max_items` | none | Caps the total number of items a query returns |

A list response looks like `{"result": {"paging": {...}, "items": [...]}}`. The `paging` object has `total_items`, `total_pages`, `page_number`, `items_per_page`, `next_page_number` and `previous_page_number`.

To iterate, read `total_pages` from page 1, then request pages 2 through `total_pages`. Stop when `page_number >= total_pages`. **Do not loop on `next_page_number`**: see the gotchas in section 10.

### Sorting

- `_order_by`: any field. The default order is chosen by the server and differs by object.
- `_sort_order`: `asc` (the default) or `desc`.

The docs say `_order_by` accepts "editable" fields, but sorting events by `event_number`, which is read-only, worked **(observed)**.

### Filtering

- **Qualifiers:** pass `field=value` as a parameter. You can prefix the value with `>`, `>=`, `<=` or `<>`. Passing `field=null` matches nulls, and an empty value disables that qualifier. Each relationship's doc page lists which qualifiers it accepts.
- **Text search:** `query=<text>` does a partial match. Some objects also accept `query_field=<field>` to search a non-default field. Badge also accepts `query_single_term`.
- **Dotted qualifiers:** some qualifiers use dotted names such as `shift.conventionday_id` or `volunteer.firstname`. These need the matching `_include_related_objects=` value to be present.

### Includes

- `_include_relationships=1` adds a `_relationships` map of URIs, for example `events: /api/convention/{id}/events` and `self: ...`.
- `_include_related_objects=<name>` embeds a short copy of a **1:1** related object. For example, `_include_related_objects=type` on events embeds the EventType **(observed)**. 1:N relationships have to be fetched separately.
- `_include=<name>` adds computed extras. It can be repeated. Each object documents its own include names, for example Event `hosts` and `liked_count`, EventSession `end_date`, and Room `child_counts`.

### Field selection

The docs describe no field-selection parameter. Every list returns full objects.

## 5. Key objects for a dashboard

All paths are relative to `https://tabletop.events`. `{cid}` is a convention id.

Most collections **cannot be searched across conventions**. You list them through a parent's relationship URL, which has the form `/api/{parent}/{id}/{relationship}`. Some old global searches, such as `GET /api/event` and `GET /api/badge`, are now admin-only.

How the objects relate:

```
Group ──< Convention >── Venue, GeoLocation (has timezone)
Convention ──< ConventionDay ──< DayPart
Convention ──< Room ──< Space
Slot = DayPart × Space  (event_id set when an event is assigned to it)
Convention ──< EventType ──< Event ──< EventSession (2nd+ sessions)
Event ──< Ticket >── Badge >── BadgeType ── Convention
Convention ──< Shift >── ShiftType;  Volunteer ──< VolunteerShift >── Shift
```

| Object | Read one | List via (documented relationship) | Notes |
|---|---|---|---|
| Convention | `GET /api/convention/{cid}` | `GET /api/convention?query=` | Docs say the search returns only conventions that have not ended. With a session, it also returns conventions run by your groups. Long text fields are split out into the ConventionJson and ConventionWebfiltered objects. |
| ConventionDay | `GET /api/conventionday/{id}` | `/api/convention/{cid}/days` (qualifiers `day_type`, `use_exhibitor_dates`), `/api/convention/{cid}/event-days` | Has `start_date`, `end_date`, `slot_*`, `attendee_*` and `exhibit*_` date fields. `day_type` defaults to `events`. |
| DayPart (time slot) | `GET /api/daypart/{id}` | `/api/convention/{cid}/dayparts` (qualifiers `conventionday_id`, `start_date`), `/api/conventionday/{id}/dayparts` | Fields: `name` (for example "Friday at 7:00 PM"), `start_date`, `is_hidden`. Relationships include `eventstarts` and `sessionstarts-union`. |
| Room | `GET /api/room/{id}` | `/api/convention/{cid}/rooms` | Relationships: `spaces`, `events`, `eventsessions-union`, `slots`. `GET /api/room/{id}/slot-grid?daypart_id=` |
| Space | `GET /api/space/{id}` | `/api/convention/{cid}/spaces` (qualifier `room_id`) | A table or area inside a room. Has `max_tickets`. |
| Slot | `GET /api/slot/{id}` | `/api/convention/{cid}/slots` (qualifiers `conventionday_id`, `daypart_id`, `event_id`, `room_id`, `space_id`) | Fields include `is_assigned` and `is_reserved`. |
| EventType | `GET /api/eventtype/{id}` | `/api/convention/{cid}/eventtypes` (qualifier `user_submittable`) | Examples: "RPG". Embedded objects carry `custom_fields` and `end_buffer` **(observed)**. |
| Event | `GET /api/event/{id}` | `/api/convention/{cid}/events`; also via EventType, Room, Space, DayPart and EventGroup | See below. |
| EventSession | `GET /api/eventsession/{id}` | `/api/convention/{cid}/eventsessions` | Only exists for an event's 2nd and later sessions. The Event row itself holds the first session. |
| Event + sessions union | (cannot be read by id) | `/api/convention/{cid}/eventsessions-union`, also via Room, Space and DayPart `sessionstarts-union` | Read-only view mixing `object_type` `event` and `eventsession` rows. This is the simplest way to build a full schedule grid. |
| BadgeType | `GET /api/badgetype/{id}` | `/api/convention/{cid}/badgetypes` | Fields: `available_quantity`, `taken_count`, `max_quantity`. |
| Badge | `GET /api/badge/{id}` | `/api/convention/{cid}/badges`, `/api/convention/{cid}/badges/my`, `/api/user/{uid}/badges` | Needs `registration` or `pos` to see other people's badges. Qualifiers include `badgetype_id`, `checked_in`, `verified`, `badge_number`. |
| Badge counts | `GET /api/convention/{cid}/badge-summary` | `GET /api/convention/{cid}/badge-sales-history` | Summary fields: `checked_in`, `printed`, `sold`, `in_carts`, `verified`. Sales history is monthly `total_sales`. The privilege these need is not stated. |
| Ticket | `GET /api/ticket/{id}` | `/api/convention/{cid}/tickets`, `/api/event/{id}/tickets`, `/api/badge/{id}/tickets`, `/api/convention/{cid}/tickets/my` | Has `ticket_number`. Qualifiers include `event_id`, `badge_id`, `picked_up`, `collected`. |
| Shift / ShiftType | (see Shift.html) | `/api/convention/{cid}/shifts` (qualifiers `conventionday_id`, `shifttype_id`), `/api/convention/{cid}/shifttypes` | |
| Volunteer | (see Volunteer.html) | `/api/convention/{cid}/volunteers`, `/api/convention/{cid}/volunteers/scheduled` (also `/unscheduled` and `/declined`, each with a `/count` variant) | |
| VolunteerShift | `GET /api/volunteershift/{id}` | `/api/convention/{cid}/volunteershifts` (qualifiers `shift_id`, `volunteer_id`, `status`) | `status` is `scheduled`, `declined` or `unscheduled`. Includes: `shift_day`, `shift_room`. |
| User | `GET /api/user/{uid}` (yourself only) | `/api/convention/{cid}/user?query=` (requires login) | `GET /api/user/{uid}/events-hosted`, `/events-reserved`, `/conventions-running`, `/conventions-helping` |
| Event waits and likes | | `/api/convention/{cid}/eventwaits`, `/api/convention/{cid}/eventlikes` (listed in the docs) | The docs do not describe a "wishlist" object. See section 12. |

### Event fields worth knowing

Fields documented on EventProperties include:

`event_number`, `name`, `description`, `long_description_html`, `type_id`, `duration` (an integer; one observed value was 240, which suggests minutes **(unverified)**), `start_date`, `startdaypart_id`, `startdaypart_name`, `preferreddaypart_id`, `alternatedaypart_id`, `room_id`, `room_name`, `space_id`, `space_name`, `is_scheduled`, `published_to_schedule`, `is_cancelled`, `private`, `sellable`, `trashed`, `max_quantity`, `taken_count`, `available_quantity`, `wait_count`, `price`, `host_count`, `session_count`.

Useful event qualifiers: `type_id`, `room_id`, `is_scheduled`, `is_cancelled`, `startdaypart_id`, `event_number`, `sellable`, `max_quantity` (0 means unticketed), `has_multiple_sessions`.

Event `query` searches `name` by default. Set `query_field=event_number` or `query_field=host.display_name` to search those instead.

The public schedule search on the website uses **Algolia**, with an index named `{convention_id}_events`. The docs give no API credentials for it.

## 6. Rate limits, etiquette and caching

- The TTE docs ask clients to make **no more than 1 request per second**. Limits are enforced only against abuse, but abusers can be **blocked entirely**. Email info@tabletop.events if you need more.
- Error code 452 exists for exceeding a per-minute request limit.
- TGC documents a limit of 240 requests per minute, and says going over it returns 500 errors **(TGC docs; may not apply to TTE)**. Treat both 452 and 500 as a signal to back off.
- TGC also says to expect maintenance windows between 11pm and 7am US Central, announced on its blog **(TGC docs; unverified for TTE)**. Make your dashboard tolerate downtime.

Suggestions **(unverified, but sensible)**:

- Throttle to 1 request per second with a single shared queue, and use `_items_per_page=100` to cut down the number of calls.
- Cache data that rarely changes for hours: the convention, days, dayparts, rooms, spaces, event types and badge types.
- Re-poll data that changes often less frequently: events, tickets and badge counts every 5 to 15 minutes. Use `badge-summary` instead of paging through every badge.
- Use `date_updated` qualifiers with `>` to fetch only changed rows. Whether `date_updated` works as a qualifier on each relationship is unverified.
- For a purely public view, the website offers nightly public CSV exports (Help Center, "Accessing Reports"). These are not part of the API.

## 7. Dates, times and time zones

- The docs say every date is formatted `YYYY-MM-DD HH:MM:SS` and is in **UTC**. The strings carry no `Z` or offset, so parse them explicitly as UTC.
- A convention has no timezone field. Its **GeoLocation** (`geolocation_id`, at `GET /api/geolocation/{id}`) has a read-only `timezone` varchar. That is the documented place to look up local time.
- Example **(observed)**: an event had `start_date` "2023-04-14 23:00:00" and `startdaypart_name` "Friday at 7:00 PM". That is UTC minus 4 hours, which is US Eastern Daylight Time. So stored dates are UTC, and the human-readable DayPart names are in local time.
- The convention also carries display hints: `clock_type` (12 or 24) and `client_clock_format` (for example `{"moment": "h:mm a"}`) **(observed)**.
- An event's end time is not stored. Compute it as `start_date + duration`, assuming `duration` is in minutes **(unverified)**. On EventSession, the `_include=end_date` include also adds the event type's `end_buffer`.
- An undocumented `helpertimezones` relationship appears in `_relationships`. It returned an empty list **(observed)**.

## 8. Writes and reads

A dashboard mostly needs GETs. Writes (POST, PUT and DELETE) need a session, and usually a ConventionPrivilege.

Writes have side effects you should know about:

- `POST /api/convention/{cid}/message-volunteers` sends real emails.
- Badge `check-in`, ticket `pick-up` and slot assignment change live convention state.

Do not let a read-only dashboard hold write paths it does not need. If you only need public data, skip creating a session entirely.

## 9. Minimal worked example (curl)

Placeholders only. Load real values from the environment.

```bash
BASE=https://tabletop.events/api

# 1. Start a session (developer account + API key id)
SESSION_ID=$(curl -s -X POST "$BASE/session" \
  -F "username=$TTE_USERNAME" \
  -F "password=$TTE_PASSWORD" \
  -F "api_key_id=$TTE_API_KEY_ID" | jq -r '.result.id')

# 2. Fetch a convention (with relationship URIs and its geolocation embedded)
curl -s "$BASE/convention/$CONVENTION_ID?session_id=$SESSION_ID&_include_relationships=1&_include_related_objects=geolocation"
#   Note: whether _include_related_objects=geolocation works on Convention is unverified;
#   otherwise GET $BASE/geolocation/<geolocation_id> for .result.timezone

# 3. Page through events, 100 per page, sleeping ~1s between calls
page=1
while :; do
  resp=$(curl -s "$BASE/convention/$CONVENTION_ID/events?session_id=$SESSION_ID&_items_per_page=100&_page_number=$page&_order_by=event_number")
  echo "$resp" | jq -c '.result.items[] | {event_number, name, start_date, duration, room_name}'
  total=$(echo "$resp" | jq '.result.paging.total_pages')
  [ "$page" -ge "$total" ] && break
  page=$((page + 1)); sleep 1
done

# 4. End the session
curl -s -X DELETE "$BASE/session/$SESSION_ID"
```

The same loop as pseudo-code:

```
session = POST /api/session {username, password, api_key_id}  -> result.id
try:
  conv = GET /api/convention/{cid}?session_id=...
  tz   = GET /api/geolocation/{conv.geolocation_id} -> result.timezone
  page = 1
  loop:
    r = GET /api/convention/{cid}/events?_items_per_page=100&_page_number=page&session_id=...
    if r.error: if r.error.code == 451: re-login, retry; elif code in (452, 500): back off; else raise
    yield r.result.items
    if page >= int(r.result.paging.total_pages): break
    page += 1; sleep(1)
finally:
  DELETE /api/session/{session.id}
```

## 10. Caveats and gotchas

1. **`next_page_number` is not null on the last page.** On page 3 of 3, it was 4 **(observed)**. On page 1, `previous_page_number` was 1. Always compare against `total_pages`.
2. **An out-of-range `_items_per_page` falls back silently.** Requesting 500 returned 25 items per page, not 100, and no warning appeared in the part of the response that could be checked **(observed)**. Stay within 1 to 100.
3. **Some paging values come back as strings.** `items_per_page` and `page_number` echo back as strings (`"100"`, `"3"`) when you supply them, and as numbers when they are defaulted **(observed)**. Coerce them to integers.
4. **Booleans are 0 or 1 integers**, not `true`/`false`. They are `tinyint` in the property tables.
5. **The convention search returns ended conventions.** The docs say `GET /api/convention` returns only conventions that have not ended, but an unauthenticated request returned 2,155 conventions, including ones from 2023 **(observed)**. Filter on `has_ended` and `end_date` yourself.
6. **Developer-only login.** Username and password login works only for accounts flagged as developers, and SSO on behalf of other users is not offered. A multi-tenant dashboard where each organizer logs in is not supported without contacting TTE.
7. **Deprecated names still appear.** `sold_count` was renamed to `taken_count`. `max_tickets` and `max_available_count` were renamed to `max_quantity`. Embedded EventType objects still show `max_tickets` **(observed)**, and Event create still lists `max_tickets` as required even though it is called deprecated. Read the new name and fall back to the old one.
8. **Events and sessions are separate tables.** An Event holds only its first session. Multi-session events have EventSession rows for the 2nd and later sessions. Use `eventsessions-union` for a complete schedule.
9. **There is no cross-convention search** for most objects. Always go through `/api/convention/{cid}/...`.
10. **Undocumented relationships** appear in `_relationships`, for example `helpertimezones`, `news`, `orderlines`, `external_jsons` and `reschedules`. Do not depend on them.
11. **Long text lives on separate objects.** Fields such as the description and CSS moved off Convention into ConventionJson and ConventionWebfiltered. Some of them are reachable through `_include`.
12. **Doc inconsistencies.** The Convention page gives the same path for "collect ticket" and "collect generic ticket". The ConventionDay page has a mislabeled heading. Both endpoint lists are partly incomplete; for example, "Remaining Event Groups" has no path.
13. **Recent breaking changes.** `available-dayparts/refresh` endpoints stopped doing anything (2026-08). Library relationship names were renamed (2026-02). Check DeprecationNotices periodically.
14. **Large responses.** Events carry full HTML descriptions. A 100-item page was about 200 KB **(observed)**.

## 11. Client libraries (from the TTE docs)

- Perl: Wing::Client (on MetaCPAN).
- AngularJS 1: wing.js / wing.angular.js.
- Node.js: `mwisconsin/tabletop.js`. This is small and lightly maintained: it is a gulp task that posts a session, then creates or deletes an event, and it has no paging.

No maintained Python or TypeScript client was found.

## 12. Open questions (not resolved)

- What is the exact session lifetime, and what extends it?
- What exact rate-limit thresholds does TTE use, and what HTTP status and error code does throttling return (452 or 500)?
- Do all error responses use an HTTP status equal to `error.code`, or do some return 200?
- Which reads actually need a session or a privilege? For example, do `badge-summary`, `/volunteers` and DayPart reads need one? Several object pages name a privilege, yet public reads succeeded.
- Is there a "wishlist" object in the API? Only `eventlikes` and `eventwaits` relationships and the `liked_count` include were found. Their item shape is undocumented.
- Is there a filter for incremental sync, such as `date_updated>...`? Is there a webhook? TGC has a WebHook API, but none was found for TTE.
- Does `_include_related_objects=geolocation` work on Convention (it is 1:1, so it should)?
- What exactly do `view_uri` and `uri_part` contain, for building links back to the convention site?
- Is the Algolia `{convention_id}_events` index usable by third parties?
- Are maintenance windows announced, and where (news.tabletop.events)?

## 13. Sources

Official TTE developer docs:

- https://tabletop.events/developer/Introduction.html
- https://tabletop.events/developer/DeprecationNotices.html
- https://tabletop.events/developer/Session.html
- https://tabletop.events/developer/SingleSignOn.html
- https://tabletop.events/developer/APIKey.html
- https://tabletop.events/developer/ErrorCodes.html
- https://tabletop.events/developer/Status.html
- https://tabletop.events/developer/Test.html
- https://tabletop.events/developer/Convention.html
- https://tabletop.events/developer/ConventionProperties.html
- https://tabletop.events/developer/ConventionPrivilege.html
- https://tabletop.events/developer/ConventionDay.html
- https://tabletop.events/developer/DayPart.html
- https://tabletop.events/developer/Slot.html
- https://tabletop.events/developer/Room.html
- https://tabletop.events/developer/Space.html
- https://tabletop.events/developer/EventType.html
- https://tabletop.events/developer/Event.html
- https://tabletop.events/developer/EventProperties.html
- https://tabletop.events/developer/EventSession.html
- https://tabletop.events/developer/EventSessionUnion.html
- https://tabletop.events/developer/Badge.html
- https://tabletop.events/developer/BadgeType.html
- https://tabletop.events/developer/Ticket.html
- https://tabletop.events/developer/VolunteerShift.html
- https://tabletop.events/developer/User.html
- https://tabletop.events/developer/GeoLocation.html
- https://tabletop.events/developer/Venue.html

Same-team (TGC) docs:

- https://www.thegamecrafter.com/developer/
- https://www.thegamecrafter.com/developer/Session.html

Community and help:

- https://github.com/mwisconsin/tabletop.js (README and gulpfile.js)
- https://help.tabletop.events/article/143-reports

Live public responses checked on 2026-10-28:

- `GET https://tabletop.events/api/convention?_items_per_page=2&_include_relationships=1`
- `GET https://tabletop.events/api/convention/{cid}/events` (with paging and sorting variations)
- `GET https://tabletop.events/api/convention/{cid}/helpertimezones`
- `GET https://tabletop.events/api/event/{bad-id}`

## 14. Browser developer-account transport follow-up

Rechecked 2026-10-28 without credentials or authenticated requests:

- The Introduction's documented POST method tunnel works with `?X-HTTP-Method=GET` and an `application/x-www-form-urlencoded` body. The official `/api/_test` returned method GET and the supplied harmless body parameters; public convention, event and session-union reads also accepted it. This permits `URLSearchParams` read parameters without custom headers/preflight. Session authorization through that body remains untested; do not interpret an anonymous transport probe as a successful login.
- Anonymous tunneled responses returned `Access-Control-Allow-Origin: *`. Session OPTIONS returned no Allow-Credentials and no allowed custom headers. Existing TTE cookies cannot be reused with credentialed cross-origin Pages fetches under those headers. Use `credentials: "omit"` and `cache: "no-store"`; do not place session IDs in read query strings when using this form transport.
- A Pages app cannot securely remember a JS bearer token across restarts as an HttpOnly backend cookie would. Recommended developer sign-in retains the session only in memory until reload/logout/expiry; no browser storage or service-worker authentication caching. Login and logout remain explicitly developer-account operations, not general-user SSO.
- Session Logout documents the token in `/api/session/{id}`; no body-only revocation endpoint was established. This unavoidable documented logout URL must never be logged or cached.
- Ticket `verified=1` is enabled/checked-out attendance, not necessarily a positive payment: free and organizer-granted tickets exist. Select owned badges explicitly. Verified reservation-origin tickets can count; reservation records alone cannot. Do not use pickup/collection as purchase proof.
- A public event with duration 240 and start 23:00 UTC returned included end 02:50 UTC next day with type end_buffer 10: observed evidence for duration in minutes and a subtracted end buffer. Slot end should use start plus duration, not blindly use the buffered include. The property tables still do not explicitly name duration units.

The approved implementation uses the public contracts in `src/api/index.ts` and
`src/domain/index.ts`. See [session privacy and PWA behavior](privacy-and-pwa.md)
for the memory-only boundary and current acceptance limits. Basic live login and
event loading have since been user-verified; detailed private-data edge cases and
schedule correctness still require comparison with the real schedule.
