# The sermon-notes file format

A church that publishes sermon notes can publish them in this format, and
anyone using **My Life With Christ** can bring the file straight into an entry.

It is deliberately boring. One JSON object, one text field, no wrapper, no
compression, no signature. A church should be able to produce one with an
ordinary script, or by hand in a text editor, and should never need this app —
or an account with anyone — to do it.

---

## The shape

```json
{
  "format": "my-life-with-christ-sermon-notes",
  "version": 1,
  "title": "Setting Godly Priorities",
  "church": "City Gate Church",
  "speaker": "Pastor John Smith",
  "date": "2026-09-20",
  "scripture": ["Matthew 6:19-34"],
  "bodyMarkdown": "## Three treasures\n\n1. Where your treasure is…\n2. …\n"
}
```

Save it with a `.json` extension. That is the whole format.

## The fields

| Field | Required | Type | What it is |
| --- | --- | --- | --- |
| `format` | **yes** | string | Exactly `my-life-with-christ-sermon-notes`. A file without it is not one of these and is refused. |
| `version` | **yes** | integer | `1`. See *Versions* below. |
| `bodyMarkdown` | **yes** | string | The notes themselves. Markdown, or plain text — plain text is valid Markdown. |
| `title` | no | string | What the sermon was called. |
| `church` | no | string | Who is providing the notes. Shown as *Provided by …*. |
| `speaker` | no | string | Who preached it. |
| `date` | no | string | The date of the sermon, `YYYY-MM-DD`. |
| `scripture` | no | array of strings | References as you would print them: `["Matthew 6:19-34", "Psalm 62"]`. |

### Validation rules

These are what the app actually enforces, not a wish list.

- The file must parse as JSON and be a single object — not an array, not a
  string, not `null`.
- `format` must match exactly. Case-sensitive.
- `version` must be an integer.
- `bodyMarkdown` must be present and, once trimmed, not empty. A sermon-notes
  file with no sermon notes in it is refused rather than imported empty.
- `date` must be a real calendar date in `YYYY-MM-DD` form. Anything else is
  **ignored**, not guessed at and not an error — the notes still import, just
  without a date.
- `scripture` entries that are not strings are dropped. Very long ones are
  shortened and a very long list is cut; both limits are generous.
- Empty strings count as absent, everywhere.
- **Unknown fields are ignored.** A church that adds something this version has
  never heard of gets the parts that are understood rather than a refusal.
- Nothing is inherited. Keys such as `__proto__` are read as ordinary data and
  cannot reach anything but the fields listed above.

### Limits

| Limit | Value | Why |
| --- | --- | --- |
| File size | 8 MB | Many times larger than any handout. |
| Body length | 200,000 characters | About forty thousand words. Longer is refused rather than cut, because truncating somebody else's words and presenting the result as theirs is a small lie. |

## Versions

`version` says which revision of *this document* the file was written against.

- A file whose `version` is **higher** than the app understands is refused,
  with a message saying so. It is not partially read: a newer version may mean
  something different by a field of the same name, and guessing would be worse
  than waiting.
- A file whose `version` is lower, when there is a lower one, is read.
- There is exactly one version today. This section exists so that the first
  time there are two, the rule was already written down.

## What the app does with it

The notes are stored as **provided notes** on a journal entry: their own
section, under the name of whoever provided them, kept apart from everything
the person using the app writes.

They do **not** become the reader's notes. After an import, the entry's
**Notes**, **Reflection** and **Prayer** are as empty as on any blank entry.
That separation is the reason this feature is shaped the way it is — the
journal is a record of one person's walk, and a sermon outline somebody handed
them is not their voice. It survives into the export, into the Markdown files
and into the printed book, labelled as provided material every time.

`title`, `date`, `speaker` and `scripture` may fill in the entry's own fields
where the reader has not already put something there. Prose never does.

## Privacy and offline

- The file is read **on the device**. Nothing is uploaded, and nothing is sent
  anywhere to be converted.
- There is no account, no identifier, no token and no call home. The format
  carries none, and the app would have nowhere to send one.
- Nothing in the file is hidden. What you see in a text editor is what is read.
- A checksum (SHA-256) of the file is recorded with the notes, so the same
  handout can be recognised later. It is a digest of the file, not of anything
  about the person.

## Other things that can be imported

The same control takes a plain `.txt` or `.md` file, and a `.pdf` that contains
real text. Those carry no metadata, so the app records only what it can stand
behind: the text, the filename, and when it was imported. It does **not** guess
a church or a speaker out of a filename or out of prose — a name invented that
way would end up on the permanent record of somebody's life.

A scanned PDF — a photograph of a page — cannot be read, and is refused with a
message saying so. There is no text recognition in this version.

The original file is not stored. The app keeps the text it read, the file's
name and its checksum; the PDF itself stays the reader's own file.

## Generating one

There is no generator in this repository yet. There does not need to be: the
format is one JSON object, and any language can write it.

```js
const notes = {
  format: 'my-life-with-christ-sermon-notes',
  version: 1,
  title: 'Setting Godly Priorities',
  church: 'City Gate Church',
  speaker: 'Pastor John Smith',
  date: '2026-09-20',
  scripture: ['Matthew 6:19-34'],
  bodyMarkdown: fs.readFileSync('outline.md', 'utf8'),
};
fs.writeFileSync('sermon-notes.json', JSON.stringify(notes, null, 2));
```
