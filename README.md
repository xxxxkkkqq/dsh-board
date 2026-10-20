# dsh-board

A canvas beside the conversation, for the things a chat message carries badly: a
diagram, a layout, "this box here, not that one".

You draw, paste, write and annotate. Select what matters and send it over. The
agent gets every element's id, type, position and text, plus the comment threads,
and answers on the same board with markdown cards, sticky notes and arrows. It
can also open the board itself and wait for you to mark something up.

It lives in the right sidebar as a tab, so the board and the conversation sit
side by side. A button in the session header opens it.

## What you can do

| Tool | |
|---|---|
| **Select** (V) | Click to select, drag to move, drag empty space to marquee. Shift adds to the selection. Double-click text, a note or a card to edit it. |
| **Pan** (H) | Drag the canvas. Middle-drag or hold Space with any tool. Scroll pans; Ctrl/⌘-scroll zooms. |
| **Pen** (P) | Freehand. |
| **Eraser** (E) | Drag across elements to delete them. They fade while the trail touches them, and nothing commits until you let go, so one pass is one undo step. |
| **Rectangle** (R), **Ellipse** (O), **Arrow** (A), **Line** (L) | Drag to draw. |
| **Text** (T), **Sticky note** (N), **Markdown card** (M) | Click to place, then type. Cards render headings, lists, tables, fenced code, quotes and links. |
| **Pin** (K) | Drops a marker on whatever is under it and opens that element's thread. |

Paste an image and it lands on the board.

Selecting something opens a sheet with its comment thread, a box for a new
comment, and **Send to agent**. With several elements selected it also offers
grouping and six alignment actions.

`Delete` removes the selection. `Esc` clears it, or leaves whatever tool you are
in. The ⋯ menu exports the board as PNG or Markdown, toggles the help line, and
clears the board.

**Undo and redo** are on the toolbar, in the ⋯ menu, and on `Ctrl/⌘+Z`,
`Ctrl/⌘+Shift+Z` and `Ctrl/⌘+Y`. The unit is a gesture — a drag, a stroke, an
eraser pass, one committed edit — and a gesture in progress cannot be undone.
Sixty steps.

## What the agent gets

`board_read` without an id returns an overview: one line per element with its id,
type, author, box and a short excerpt, plus a comment count. With an id it
returns that element in full, markdown and whole thread included. That is how it
gets from "the user named three ids" to the actual drawing.

`board_write` adds, updates and removes elements, appends comments and clears the
board. It calls the same mutation function the browser does, so both sides share
one set of validation rules.

**Send to agent** builds a text digest of the selected elements (or the whole
board when nothing is selected), renders the marked area to a PNG, and posts
both into the session as one queued prompt. If the model refuses images, the same
digest goes as text instead of failing the send.

## When the agent asks on the board

`board_ask` opens the board in front of you and blocks the turn until you answer.
It rides the same question mechanism `ask_user_question` uses, so the answer is
submitted from the composer card below the conversation — that card is the only
surface that can settle a blocking question — while the board stays fully
editable. A strip at the top of the board says what is going on, and the tab
raises itself when the wait begins.

Write what you want the user to see first with `board_write`, then call
`board_ask` with a one-line `prompt`. The answer comes back with the board
revision before and after, so you can tell whether anything changed, and
`board_read` gives you the details.

## Where the data lives

Boards are plugin-owned JSON files, not session-log events: one per session under
`$DSH_HOME/boards`, written atomically and versioned by a per-board `rev`. A
browser edit carries the revision it saw, so a stale tab refetches instead of
overwriting what the agent just wrote. Two processes can share one home, so a
cached board is revalidated against its file's mtime before it is trusted.
Images go to `$DSH_HOME/boards/images`.

## Configuration

All optional, in the `board` row of `cordis.patch.yml`.

| Field | Default | |
|---|---|---|
| `dir` | `$DSH_HOME/boards` | Where boards and pasted images live. |
| `maxElements` | `4000` | Elements per board. |
| `promptSection` | `true` | Whether to add the "shared board" system-prompt section. |
| `maxImageBytes` | `3 MiB` | Largest pasted image. |

## Install

```
plugin_manager install_bundle /path/to/dsh-board
```

No dependencies. The host half imports nothing but Node built-ins and registers
its tools as raw definitions; the browser half is a hand-written `ModuleLoader`
bundle that uses only the `react` the shell already provides.

## Tests

```
bash test/run.sh
```

The host half runs against a fake Cordis context — storage, validation, routes,
both tools, conflict detection, cross-process consistency, per-session isolation,
and the four `board_ask` paths. The browser half renders through
`react-test-renderer`: registration, first paint, markdown rendering, selection,
commenting, eraser and undo, and the full send-to-agent path including the
snapshot.

## Prior art

The interactions are borrowed, not invented. Excalidraw's eraser deletes whole
elements and tests them by distance to the trail; its undo refuses to run while a
gesture is in flight. tldraw treats a tool as a top-level state and marks a
history stopping point before each interaction, so a drag is one undo step
rather than fifty.

## License

MIT
