# greygoose

A private archive of the people in greygoose and the parties we throw.
Every member has a file; every party has a file.

## Running it

Saving from the admin panel needs the small Python server — a plain
`python3 -m http.server` has no API to write to.

```bash
python3 server.py            # http://127.0.0.1:8777
python3 server.py --gate     # also enforce the question gate
```

- `http://127.0.0.1:8777` — the site
- `http://127.0.0.1:8777/admin.html` — edit members, parties, gallery, questions

The admin panel shows a green `server.py` chip when it can save, and a red
`no server` chip when it cannot.

## Layout

| file | what it is |
|---|---|
| `index.html` | crews and member files |
| `parties.html` | upcoming and past parties |
| `gallery.html` | every photo |
| `party.html` | one-party share link (`?id=…&k=…`) |
| `admin.html` | the editor |
| `data.json` | all content — edit through the admin panel |
| `server.py` | dev server + save/upload/unlock API |
| `photos/` | images |

## The access gate

Visitors answer one personal question at random. Answers are stored as
SHA-256 hashes, never as text, and matching ignores capitals, spaces and
punctuation.

**This is a doorlock, not a vault.** Served as plain static files the check
happens in the browser, and anyone can read `data.json` directly. Run
`python3 server.py --gate` to have the server withhold the archive until the
question is answered.
