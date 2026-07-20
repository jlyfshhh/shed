# Shed voice webhook and Unraid deployment

Shed can run as a LAN-only Docker service with its D1-compatible SQLite data
persisted under `/data`. The voice webhook uses Claude tool calls to read and
write the same husbandry tables as the web app.

## Configuration

Copy `.env.example` to `.env` and replace both secrets:

```dotenv
ANTHROPIC_API_KEY=your-api-key
SHED_VOICE_TOKEN=a-long-random-shared-secret
SHED_TIME_ZONE=America/New_York
PORT=3000
SHED_DATA_PATH=../data
```

Generate a suitable shared secret with `openssl rand -hex 32`. The real `.env`
is ignored by Git; `.env.example` contains placeholders only.

## Run with Docker Compose

```bash
docker compose up -d --build
```

For Unraid, map a durable appdata directory such as
`/mnt/user/appdata/shed/data` to the container's `/data` directory. Back up the
entire mapped directory, not an individual nested database file. The app also
provides JSON and CSV exports at `/api/export` and `/api/export?format=csv`.

Do not forward Shed's port directly to the public internet. Use it on the LAN,
or put it behind an authenticated HTTPS reverse proxy or private VPN if remote
access is added later.

## Voice endpoint contract

`POST /api/voice`

Headers:

```text
Content-Type: application/json
X-Shed-Token: <the SHED_VOICE_TOKEN value>
```

Body:

```json
{ "text": "I fed Dracarys today" }
```

Successful response:

```json
{ "response": "Dracarys's feeding is logged for today." }
```

Query example:

```json
{ "text": "What tasks are left for the ball pythons?" }
```

All expected errors also return a short `response` string that is safe to read
through a speaker. HTTP status codes still distinguish invalid requests,
authentication failures, missing server configuration, and upstream failures.

The endpoint uses `claude-haiku-4-5-20251001`. Animal names and species are
loaded from Shed's `animals` table for every request rather than being embedded
in route code. Logs append to `husbandry_events`; pending questions read
incomplete rows from `care_tasks` for the requested date.

Every authenticated, valid voice request also creates a durable row in
`voice_audit_logs`. The audit row contains the full utterance, model, tool calls
and results, final response, success or failure, duration, timestamps, and user
agent. API keys and shared-secret headers are never recorded. A request starts
with `processing` status so an interrupted request remains visible during an
audit.

Recent audit entries can be read through `GET /api/voice/audit?limit=50` using
the same `X-Shed-Token` header. The limit is clamped to 1–200. Voice audit rows
are also included in both full data-export formats.

## iPhone/HomePod Shortcut

Create a Shortcut named **Ask Shed**:

1. Add **Ask for Input** with a short husbandry prompt. Siri supplies the spoken
   answer when the Shortcut is invoked by voice.
2. Add **Get Contents of URL** with a URL such as
   `http://shed.local:3000/api/voice` or the Unraid server's reserved LAN IP.
3. Set the method to **POST**.
4. Add the header `X-Shed-Token` with the same shared secret used by the
   container.
5. Set the request body to **File** and use the answer from **Ask for Input**.
   The endpoint accepts this raw text as well as the documented JSON format.
6. Add **Get Dictionary Value**, selecting the `response` key from the result.
7. Add **Show Content** with that value so Siri reads the result and manual runs
   display it.

Enable Personal Requests for the HomePod and make sure the phone, HomePod, and
Shed server can reach one another on the same network. You can then say,
“Hey Siri, Ask Shed,” dictate the request, and hear Shed's response.
