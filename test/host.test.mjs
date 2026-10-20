/**
 * dsh-board Host-half test: mounts the plugin on a fake Cordis context and
 * exercises the tools and the browser routes through the same store the real
 * composition uses. Run with `node test/host.test.mjs`.
 */
import { mkdtemp, rm, readdir, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const dir = await mkdtemp(path.join(tmpdir(), 'dsh-board-test-'))
process.env.DSH_HOME = dir

const { apply } = await import('../index.js')

/** Requests the board_ask tool handed to the question seam. */
const asked = []
/** Set by a test to answer the next board_ask; throwing models a dismissed panel. */
let askAnswer = null

/** Minimal Cordis context: `inject`, `effect`, `tools`, `systemPrompt`, `connection`. */
function fakeContext() {
  const tools = new Map()
  const sections = []
  const routes = new Map()
  const disposers = []
  const ctx = {
    effect(callback, label) {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push({ dispose, label })
      return () => {}
    },
    inject(services, callback) {
      callback({
        effect(cb) {
          return ctx.effect(cb)
        },
        // The board_ask row registers its tool and asks through this seam; the
        // suite drives `ask` directly to stand in for a user answering.
        tools: ctx.tools,
        userQuestions: {
          async ask(request) {
            asked.push(request)
            if (typeof askAnswer === 'function') return askAnswer(request)
            throw new Error('ASK_CANCELLED')
          },
        },
        connection: {
          fetch: {
            register(route) {
              routes.set(route.path, route)
              return async () => {
                routes.delete(route.path)
              }
            },
          },
        },
        systemPrompt: {
          section(section) {
            sections.push(section)
            return () => {}
          },
        },
      })
    },
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => {}
      },
    },
  }
  return {
    ctx, tools, sections, routes, disposers,
    /** The plugin's store instance, published by `apply` for tests that need to
     *  drive a sweep directly instead of waiting on the timer. */
    get store() {
      return ctx.__boardStore
    },
  }
}

const { ctx, tools, sections, routes } = fakeContext()
apply(ctx, {})

assert.ok(tools.has('board_read'), 'board_read registered')
assert.ok(tools.has('board_write'), 'board_write registered')
assert.equal(sections.length, 1, 'one prompt section')
assert.ok(routes.has('/api/board/state'), 'state route')
assert.ok(routes.has('/api/board/op'), 'op route')
assert.ok(routes.has('/api/board/image'), 'image route')
assert.ok(routes.has('/api/board/events'), 'events route')

const sessionId = 'session:test/one'
const read = tools.get('board_read')
const write = tools.get('board_write')

/** Call one tool with a synthetic agent. */
let callSeq = 0
/** @returns {Promise<boolean>} whether the path exists. */
const exists = async (target) => {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

const call = (tool, args, agent = { session: { id: sessionId } }) => {
  callSeq += 1
  return tool.execute(args, {
    agent,
    callId: `call-${callSeq}`,
    signal: new AbortController().signal,
  })
}

// ── empty board ──────────────────────────────────────────────────────────────
let result = await call(read, {})
assert.match(result.text, /Board \(empty\)/)
assert.match(result.text, /0 elements/)

// ── agent writes a card, a note and an arrow ────────────────────────────────
result = await call(write, {
  add: [
    { type: 'card', x: 100, y: 100, w: 320, h: 220, markdown: '# Plan\n\n- one\n- two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |' },
    { type: 'note', x: 460, y: 120, text: 'remember this' },
    { type: 'arrow', x: 420, y: 200, x2: 460, y2: 150 },
  ],
})
assert.match(result.text, /Board rev 1: 3 elements/)

// ── read overview ───────────────────────────────────────────────────────────
result = await call(read, {})
assert.match(result.text, /3 elements/)
assert.match(result.text, /card · by agent/)
assert.match(result.text, /note · by agent/)
assert.match(result.text, /arrow · by agent/)
const cardId = /(e_[a-z0-9]+) · card/u.exec(result.text)[1]
const noteId = /(e_[a-z0-9]+) · note/u.exec(result.text)[1]

// ── read one element in full ────────────────────────────────────────────────
result = await call(read, { elementId: cardId })
assert.match(result.text, /# Plan/)
assert.match(result.text, /card · by agent/)

// ── a user comment, then an agent reply ─────────────────────────────────────
// The browser path and the tool path share one store, so drive the browser
// route for the user side.
const opRoute = routes.get('/api/board/op')
let response = await opRoute.fetch(new Request('http://x/api/board/op', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    sessionId,
    baseRev: 1,
    ops: [{ op: 'comment', id: noteId, text: '这个便签什么意思？' }],
  }),
}))
let body = await response.json()
assert.equal(body.rev, 2, 'comment bumps the revision')
assert.equal(body.elements.find((element) => element.id === noteId).comments.length, 1)
assert.equal(body.elements.find((element) => element.id === noteId).comments[0].author, 'user')

result = await call(write, { comments: [{ elementId: noteId, text: '它是提醒你第三步要重跑。' }] })
assert.match(result.text, /rev 3/)

result = await call(read, { elementId: noteId })
assert.match(result.text, /这个便签什么意思？/)
assert.match(result.text, /它是提醒你第三步要重跑。/)
assert.match(result.text, /- user: 这个便签什么意思？/)
assert.match(result.text, /- agent: 它是提醒你第三步要重跑。/)

// ── conflict detection ──────────────────────────────────────────────────────
response = await opRoute.fetch(new Request('http://x/api/board/op', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionId, baseRev: 1, ops: [{ op: 'clear' }] }),
}))
body = await response.json()
assert.equal(body.conflict, true, 'a stale baseRev is refused')
assert.equal(body.elements.length, 3, 'the board is untouched')

// ── update, remove, group ───────────────────────────────────────────────────
result = await call(write, {
  update: [{ id: noteId, x: 500, y: 300, color: 'warn' }],
})
assert.match(result.text, /rev 4/)
result = await call(read, { elementId: noteId })
assert.match(result.text, /box \[x,y,w,h\] 500,300/)

// ── invalid input is rejected with a reason ─────────────────────────────────
await assert.rejects(() => call(write, { add: [{ type: 'blob', x: 0, y: 0 }] }), /unknown element type/)
await assert.rejects(() => call(write, { comments: [{ elementId: 'e_nope', text: 'x' }] }), /no element/)
await assert.rejects(() => call(write, { add: [{ type: 'card', markdown: '' }] }), /needs markdown/)

// ── images ──────────────────────────────────────────────────────────────────
const imageRoute = routes.get('/api/board/image')
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex')
response = await imageRoute.fetch(new Request('http://x/api/board/image', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ mediaType: 'image/png', data: png.toString('base64') }),
}))
body = await response.json()
assert.match(body.id, /^i_[a-z0-9]+$/u, 'image id')
response = await imageRoute.fetch(new Request(`http://x/api/board/image?id=${body.id}`))
assert.equal(response.headers.get('content-type'), 'image/png')
const served = Buffer.from(await response.arrayBuffer())
assert.equal(served.toString('hex'), png.toString('hex'), 'image round trip')

result = await call(write, { add: [{ type: 'image', x: 0, y: 0, attachmentId: body.id, w: 100, h: 80, name: 'dot.png' }] })
assert.match(result.text, /4 elements/)

// ── persistence: a fresh store reads the same board ────────────────────────
const files = await readdir(dir)
assert.ok(files.includes('boards'), 'board directory created')

const second = fakeContext()
apply(second.ctx, {})
result = await second.tools.get('board_read').execute({}, { agent: { session: { id: sessionId } }, signal: new AbortController().signal })
assert.match(result.text, /4 elements/, 'a new mount reads the board back')

// ── SSE stream opens with the current revision ─────────────────────────────
const events = routes.get('/api/board/events')
const controller = new AbortController()
response = await events.fetch(new Request(`http://x/api/board/events?sessionId=${encodeURIComponent(sessionId)}`, { signal: controller.signal }))
assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8')
const reader = response.body.getReader()
const first = new TextDecoder().decode((await reader.read()).value)
assert.match(first, /retry: 3000/)
assert.match(first, /"rev":5/)
controller.abort()

// ── two processes over one home see each other's writes ────────────────────
// A second mount models a second Harness process sharing $DSH_HOME: it must not
// answer from a stale cache after the first one writes.
const sharedOp = routes.get('/api/board/op')
await sharedOp.fetch(new Request('http://x/api/board/op', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionId, ops: [{ op: 'add', elements: [{ type: 'text', x: 0, y: 0, text: 'written by process one' }] }] }),
}))
const third = fakeContext()
apply(third.ctx, {})
const fromSecond = await third.tools.get('board_read').execute({}, { agent: { session: { id: sessionId } }, signal: new AbortController().signal })
assert.match(fromSecond.text, /written by process one/, 'a second process reads the first process\'s write')

// ── board_ask: the agent blocks until the user answers ─────────────────────
assert.ok(tools.has('board_ask'), 'board_ask registered')

// A blocking ask publishes the wait, so the browser can raise the board. The
// seam is held open until the test settles it, exactly like a real user.
let settleAsk
askAnswer = () => new Promise((resolve, reject) => {
  settleAsk = { resolve, reject }
})
const askPending = call(tools.get('board_ask'), { prompt: 'Mark the layout you want' })
await new Promise((resolve) => setTimeout(resolve, 60))
assert.equal(asked.length, 1, 'the question reached the seam')
assert.equal(asked[0].questions.length, 1, 'one question')
assert.equal(asked[0].questions[0].question, 'Mark the layout you want')
assert.equal(asked[0].wait.callId !== undefined, true, 'the wait is keyed by the tool call')

let waiting = await (await routes.get('/api/board/ask').fetch(new Request(`http://x/api/board/ask?sessionId=${encodeURIComponent(sessionId)}`))).json()
assert.equal(waiting.waiting, true, 'the ask endpoint reports the wait')
assert.match(waiting.prompt, /Mark the layout/)

// A dismissed panel is reported, not thrown.
settleAsk.reject(new Error('ASK_CANCELLED'))
const dismissed = await askPending
assert.match(dismissed.text, /closed without an answer/)
waiting = await (await routes.get('/api/board/ask').fetch(new Request(`http://x/api/board/ask?sessionId=${encodeURIComponent(sessionId)}`))).json()
assert.equal(waiting.waiting, false, 'the wait is cleared when it ends')

// A real answer comes back with the option and the note.
askAnswer = () => ({ answers: [{ id: 'board', selected: ['Option A'], custom: 'moved the box' }] })
const answered = await call(tools.get('board_ask'), { prompt: 'Pick one', answers: [{ label: 'Option A' }] })
assert.match(answered.text, /answered on the board/)
assert.match(answered.text, /Chosen: Option A/)
assert.match(answered.text, /moved the box/)

// `wait: false` returns immediately and leaves the question open.
const before = asked.length
const immediate = await call(tools.get('board_ask'), { prompt: 'Look at this', wait: false })
assert.match(immediate.text, /Board opened at rev/)
assert.equal(asked.length, before, 'wait:false never asks the seam')

// ── image reclaim ──────────────────────────────────────────────────────────
// A detached image must survive the edit that detaches it, so undo can restore
// the element, and be reclaimed later — without the sweep ever touching a file
// a board still references.
const upload = async () => {
  const res = await imageRoute.fetch(new Request('http://x/api/board/image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mediaType: 'image/png', data: png.toString('base64') }),
  }))
  return (await res.json()).id
}
const imagesOnDisk = async () => {
  try {
    return (await readdir(path.join(dir, 'boards', 'images'))).sort()
  } catch {
    return []
  }
}

const baseline = (await imagesOnDisk()).length
const keptId = await upload()
const droppedId = await upload()
assert.equal((await imagesOnDisk()).length, baseline + 2, 'both uploads are stored')

await call(write, { add: [
  { type: 'image', x: 0, y: 0, attachmentId: keptId, w: 40, h: 40 },
  { type: 'image', x: 60, y: 0, attachmentId: droppedId, w: 40, h: 80 },
] })
const withImages = await (await routes.get('/api/board/state').fetch(new Request(`http://x/api/board/state?sessionId=${encodeURIComponent(sessionId)}`))).json()
const droppedElement = withImages.elements.find((element) => element.attachmentId === droppedId)
await call(write, { remove: [droppedElement.id] })
assert.equal((await imagesOnDisk()).length, baseline + 2, 'a detached image survives the edit itself, so undo can bring it back')

// An upload that never became an element is unreferenced from the start.
const strayId = await upload()
assert.ok((await imagesOnDisk()).includes(`${strayId}.png`), 'the stray upload is on disk')

// A fresh mount rebuilds the queue from disk, which is what makes a restart
// reclaim what the previous process stranded.
const reclaim = fakeContext()
apply(reclaim.ctx, {})
await new Promise((resolve) => setTimeout(resolve, 200))
assert.ok(reclaim.store !== undefined, 'a fresh mount exposes its store')
await reclaim.store.recover()
const queued = [...reclaim.store.orphans.keys()]
assert.ok(queued.includes(strayId), 'the unreferenced upload is queued')
assert.ok(queued.includes(droppedId), 'the detached image is queued')
assert.ok(!queued.includes(keptId), 'a referenced image is never queued')

// Pretend the grace period elapsed, then sweep.
for (const id of queued) reclaim.store.orphans.set(id, Date.now() - 60 * 60 * 1000)
const removed = await reclaim.store.sweep(Date.now())
assert.equal(removed, 2, 'both orphans were deleted')
const remaining = await imagesOnDisk()
assert.ok(remaining.includes(`${keptId}.png`), 'the referenced image remains')
assert.ok(!remaining.includes(`${droppedId}.png`), 'the detached image is gone')
assert.ok(!remaining.includes(`${strayId}.png`), 'the stray upload is gone')

// The cache is bounded: many boards must not grow memory without limit.
for (let index = 0; index < 40; index += 1) {
  await reclaim.store.get(`bulk:${index}`)
}
assert.ok(reclaim.store.docs.size <= 24, `board cache stays bounded (${reclaim.store.docs.size})`)
assert.ok(reclaim.store.locks.size <= 64, `lock map stays bounded (${reclaim.store.locks.size})`)

// ── abandoned board files ──────────────────────────────────────────────────
// A board nobody has opened for the TTL goes, but a live one never does.
await reclaim.store.get('abandoned:one')
const abandonedFile = reclaim.store.fileOf('abandoned:one')
await writeFile(abandonedFile, JSON.stringify({ sessionId: 'abandoned:one', rev: 0, elements: [] }), 'utf8')
const longAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000)
await utimes(abandonedFile, longAgo, longAgo)
// Drop it from the cache so it counts as cold.
reclaim.store.docs.delete('abandoned:one')

const liveFile = reclaim.store.fileOf('live:one')
await reclaim.store.get('live:one')
await writeFile(liveFile, JSON.stringify({ sessionId: 'live:one', rev: 0, elements: [] }), 'utf8')
await utimes(liveFile, longAgo, longAgo)

const ttl = 90 * 24 * 60 * 60 * 1000
const reclaimed = await reclaim.store.sweepBoards(Date.now(), ttl)
assert.ok(reclaimed >= 1, 'the abandoned board was reclaimed')
assert.ok(!(await exists(abandonedFile)), 'the abandoned file is gone')
assert.ok(await exists(liveFile), 'a board still cached survives even when old')

// ── per-session isolation ──────────────────────────────────────────────────
result = await call(read, { sessionId: 'session:other' })
assert.match(result.text, /Board \(empty\)/, 'another session has its own board')

await rm(dir, { recursive: true, force: true })
console.log('host tests passed')
