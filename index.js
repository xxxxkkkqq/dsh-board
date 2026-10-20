/**
 * dsh-board — Host half.
 *
 * One shared canvas per Session, stored as JSON under the Harness home and
 * reachable from two sides:
 *
 *   - the browser tab (`client.js`) over three same-origin routes under
 *     `/api/board` — state, one mutation, and a change stream;
 *   - the agent over two tools — `board_read` and `board_write`.
 *
 * Both sides call the same mutation function, so the user's gesture and the
 * agent's tool call have one implementation and one set of validation rules.
 *
 * The board is plugin-owned data, not session-log data: it lives in its own
 * files, is versioned by a per-board `rev` that every mutation bumps, and is
 * never appended to the Session log (a plugin event type would make the log
 * unreadable to older readers).
 *
 * No Harness package is imported: the tools are registered as raw definitions
 * with hand-written JSON Schemas, so this bundle installs into a profile with
 * no dependency resolution of its own.
 *
 * @module dsh-board
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** Element types the board understands. */
const TYPES = new Set([
  'stroke', 'rect', 'ellipse', 'arrow', 'line',
  'text', 'note', 'card', 'image', 'pin',
])

/** Colour names accepted from either side; the browser maps them to theme tokens. */
const COLORS = new Set([
  'ink', 'muted', 'accent', 'ok', 'warn', 'danger', 'violet',
  'note-yellow', 'note-pink', 'note-blue', 'note-green',
])

/** Types whose geometry is a top-left origin plus a size. */
const BOXED = new Set(['rect', 'ellipse', 'text', 'note', 'card', 'image', 'pin'])

const LIMITS = {
  /** Elements kept per board. */
  elements: 4000,
  /** Characters in a `text` element or a note. */
  text: 4000,
  /** Characters of markdown in a card. */
  markdown: 20000,
  /** Characters in one comment. */
  comment: 4000,
  /** Points in one freehand stroke. */
  points: 6000,
  /** Elements accepted in one `add` batch. */
  batch: 200,
  /** Board coordinates are clamped to this absolute bound. */
  coordinate: 20000,
}

const DEFAULTS = {
  /** Board directory; resolved lazily so `$DSH_HOME` is read at activation. */
  dir: undefined,
  maxElements: LIMITS.elements,
  promptSection: true,
  maxImageBytes: 3 * 1024 * 1024,
}

/** Copy for the model-facing tool descriptions and prompt section. */
const PROMPT = {
  section: [
    'A shared board is open beside this conversation: an infinite canvas the user can draw, write and annotate on.',
    'You can read it with `board_read` and write on it with `board_write`.',
    'When the user sends you board content, the message carries a text digest of the marked elements; read the board when you need the rest of it.',
    'Use the board when a spatial or visual answer is better than prose: diagrams, layouts, side-by-side comparisons, tables that the user will keep looking at.',
    'Every element carries an `id`, an `author` (`user` or `agent`), and a bounding box. Put your replies near the element they answer rather than in a corner.',
    'Reply on a thread with `comments` instead of drawing a new box when the user asked a question about one element.',
    'Do not delete or rewrite the user\'s elements unless they asked you to; `clear` wipes the whole board.',
  ].join(' '),
}

/**
 * Clamp one number into the board's coordinate range.
 * @param {unknown} value - candidate from JSON.
 * @param {number} fallback - value used when the candidate is not a finite number.
 * @returns {number} finite number inside the allowed range.
 */
function num(value, fallback) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(LIMITS.coordinate, Math.max(-LIMITS.coordinate, Math.round(n * 100) / 100))
}

/**
 * Trim one string to a bound.
 * @param {unknown} value - candidate from JSON.
 * @param {number} max - maximum character count.
 * @returns {string} the string, or `''` when the candidate is not a string.
 */
function str(value, max) {
  if (typeof value !== 'string') return ''
  return value.length > max ? `${value.slice(0, max)}\u2026` : value
}

/** Resolve the Harness home the same way the rest of the runtime does. */
function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim() !== '') return configured
  return path.join(os.homedir(), '.dsh')
}

/**
 * Turn one Session id into a safe file stem.
 * @param {string} sessionId - durable Session identity.
 * @returns {string} a name that cannot escape the board directory.
 */
function stemOf(sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 96)
  const digest = createHash('sha1').update(String(sessionId)).digest('hex').slice(0, 8)
  return safe === '' ? digest : `${safe}-${digest}`
}

/** One element id. */
function elementId() {
  return `e_${randomUUID().replace(/-/gu, '').slice(0, 12)}`
}

/**
 * Compute an element's bounding box from its own geometry.
 * @param {object} element - normalized element.
 * @returns {[number, number, number, number]} `[x, y, width, height]`.
 */
function boxOf(element) {
  if (element.type === 'stroke') {
    const points = element.points ?? []
    if (points.length === 0) return [element.x, element.y, 0, 0]
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [px, py] of points) {
      if (px < minX) minX = px
      if (py < minY) minY = py
      if (px > maxX) maxX = px
      if (py > maxY) maxY = py
    }
    return [minX, minY, maxX - minX, maxY - minY]
  }
  if (element.type === 'arrow' || element.type === 'line') {
    const x2 = element.x2 ?? element.x
    const y2 = element.y2 ?? element.y
    return [Math.min(element.x, x2), Math.min(element.y, y2), Math.abs(x2 - element.x), Math.abs(y2 - element.y)]
  }
  return [element.x, element.y, element.w, element.h]
}

/**
 * Validate and normalize one element submitted by either side.
 * @param {unknown} raw - candidate element from a tool call or a browser op.
 * @param {'user' | 'agent'} author - who is writing.
 * @param {number} now - creation timestamp.
 * @param {object} [existing] - element being updated, for field inheritance.
 * @returns {object} a board element with a computed box.
 * @throws {Error} when the type is unknown or the geometry is unusable.
 */
function normalizeElement(raw, author, now, existing) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('element must be an object')
  const type = String(raw.type ?? existing?.type ?? '')
  if (!TYPES.has(type)) throw new Error(`unknown element type "${type}"`)
  const color = COLORS.has(String(raw.color)) ? String(raw.color) : (existing?.color ?? 'ink')

  const element = {
    id: typeof existing?.id === 'string' ? existing.id : (typeof raw.id === 'string' && /^e_[A-Za-z0-9]+$/u.test(raw.id) ? raw.id : elementId()),
    type,
    author: existing?.author ?? author,
    at: now,
    x: num(raw.x ?? existing?.x, 0),
    y: num(raw.y ?? existing?.y, 0),
    w: Math.max(1, num(raw.w ?? existing?.w, 0)),
    h: Math.max(1, num(raw.h ?? existing?.h, 0)),
    color,
    size: Math.max(6, Math.min(96, num(raw.size ?? existing?.size, 15))),
  }

  if (type === 'arrow' || type === 'line') {
    element.x2 = num(raw.x2 ?? existing?.x2, element.x + 160)
    element.y2 = num(raw.y2 ?? existing?.y2, element.y + 100)
    element.x = num(raw.x ?? existing?.x, 0)
    element.y = num(raw.y ?? existing?.y, 0)
    if (element.x === element.x2 && element.y === element.y2) element.x2 = element.x + 160
    element.w = 0
    element.h = 0
  }

  if (type === 'stroke') {
    const source = Array.isArray(raw.points) ? raw.points : (existing?.points ?? [])
    const points = []
    for (const point of source.slice(0, LIMITS.points)) {
      if (!Array.isArray(point) || point.length < 2) continue
      points.push([num(point[0], 0), num(point[1], 0)])
    }
    if (points.length < 2) throw new Error('a stroke needs at least two points')
    element.points = points
    const [bx, by, bw, bh] = boxOf({ ...element, x: 0, y: 0 })
    element.x = bx
    element.y = by
    element.w = bw
    element.h = bh
  }

  if (type === 'text' || type === 'note' || type === 'card') {
    element.text = str(raw.text ?? existing?.text, LIMITS.text)
    if (type === 'card') element.markdown = str(raw.markdown ?? existing?.markdown, LIMITS.markdown)
    if (type === 'card' && element.markdown === '') throw new Error('a card needs markdown')
    if (type === 'text' && element.text === '') throw new Error('a text element needs text')
    if (type === 'note' && element.text === '') element.text = ''
    if (type === 'card' && raw.title !== undefined) element.title = str(raw.title, 200)
  }

  if (type === 'image') {
    const attachmentId = String(raw.attachmentId ?? existing?.attachmentId ?? '')
    if (!/^[A-Za-z0-9_-]{8,80}$/u.test(attachmentId)) throw new Error('an image needs an attachmentId from /api/board/image')
    element.attachmentId = attachmentId
    if (typeof raw.name === 'string') element.name = str(raw.name, 200)
    if (element.w <= 1 || element.h <= 1) {
      element.w = 320
      element.h = 220
    }
  }

  if (type === 'pin') {
    element.text = str(raw.text ?? existing?.text, LIMITS.comment)
  }

  if (type === 'note' || type === 'card') {
    if (element.w <= 1) element.w = 240
    if (element.h <= 1) element.h = 160
  }
  // A note is paper around its text: when the caller gave no height, size it to
  // the content instead of cutting the last line off.
  if (type === 'note' && (raw.h === undefined || raw.h === null) && element.text !== '') {
    const charsPerLine = Math.max(8, Math.floor((element.w - 16) / (element.size * 0.6)))
    const lines = element.text.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0)
    element.h = Math.max(60, Math.round(lines * element.size * 1.5 + 24))
  }
  if (type === 'text') {
    if (element.w <= 1) element.w = 220
    if (element.h <= 1) element.h = Math.max(24, element.size * 1.5)
  }
  if (type === 'pin') {
    element.w = 28
    element.h = 28
  }

  if (existing && Array.isArray(existing.comments)) element.comments = existing.comments
  // Group membership and a pin's target survive an update; both are written by
  // the browser through the same `update` op as geometry.
  const groupId = raw.groupId !== undefined ? raw.groupId : existing?.groupId
  if (typeof groupId === 'string' && groupId !== '') element.groupId = groupId
  if (typeof raw.targetId === 'string') element.targetId = str(raw.targetId, 80)
  else if (existing?.targetId !== undefined) element.targetId = existing.targetId
  element.box = boxOf(element)
  return element
}

/**
 * A new empty board document.
 * @param {string} sessionId - owning Session.
 * @returns {object} board document.
 */
function emptyDoc(sessionId) {
  return { sessionId, rev: 0, updatedAt: Date.now(), elements: [], stamp: '' }
}

/**
 * The board store: one lazily loaded document per Session, mutations serialized
 * per board and written through to disk atomically.
 */
class BoardStore {
  /**
   * @param {object} options - resolved configuration.
   * @param {string} options.dir - board directory.
   * @param {number} options.maxElements - element cap per board.
   * @param {(sessionId: string, rev: number) => void} options.notify - change sink.
   */
  constructor(options) {
    this.dir = options.dir
    this.maxElements = options.maxElements
    this.notify = options.notify
    this.docs = new Map()
    this.loading = new Map()
    this.locks = new Map()
  }

  /** @param {string} sessionId - board identity. @returns {string} its file path. */
  fileOf(sessionId) {
    return path.join(this.dir, `${stemOf(sessionId)}.json`)
  }

  /**
   * Read one board, loading it from disk on first use.
   * @param {string} sessionId - board identity.
   * @returns {Promise<object>} the live document.
   */
  async get(sessionId) {
    const cached = this.docs.get(sessionId)
    if (cached !== undefined) {
      // Two Harness processes can share one home (a second profile, a desktop
      // and a web instance). The file is the shared truth, so a cached document
      // is revalidated against its mtime before it is trusted again.
      const stamp = await this.stampOf(sessionId)
      if (stamp === cached.stamp) return cached
    }
    const pending = this.loading.get(sessionId)
    if (pending !== undefined) return pending
    const load = this.read(sessionId)
    this.loading.set(sessionId, load)
    try {
      return await load
    } finally {
      this.loading.delete(sessionId)
    }
  }

  /**
   * Read one board from disk, with the mtime that identifies that generation.
   * @param {string} sessionId - board identity.
   * @returns {Promise<object>} the document, carrying its `stamp`.
   */
  async read(sessionId) {
    const doc = emptyDoc(sessionId)
    const stamp = await this.stampOf(sessionId)
    try {
      const text = await readFile(this.fileOf(sessionId), 'utf8')
      const parsed = JSON.parse(text)
      if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.elements)) {
        doc.rev = Number.isSafeInteger(parsed.rev) ? parsed.rev : 0
        doc.updatedAt = Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : Date.now()
        doc.elements = parsed.elements.filter((element) => element !== null && typeof element === 'object' && TYPES.has(element.type))
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    doc.stamp = stamp
    this.docs.set(sessionId, doc)
    return doc
  }

  /**
   * The mtime+size stamp of one board's file.
   * @param {string} sessionId - board identity.
   * @returns {Promise<string>} the stamp, or `''` when the file does not exist.
   */
  async stampOf(sessionId) {
    try {
      const info = await stat(this.fileOf(sessionId))
      return `${info.mtimeMs}:${info.size}`
    } catch (error) {
      if (error?.code === 'ENOENT') return ''
      throw error
    }
  }

  /**
   * Serialize one board's mutations.
   * @param {string} sessionId - board identity.
   * @param {() => Promise<T>} work - operation to run alone.
   * @returns {Promise<T>} the operation's result.
   * @template T
   */
  async exclusive(sessionId, work) {
    const previous = this.locks.get(sessionId) ?? Promise.resolve()
    const run = previous.then(work, work)
    this.locks.set(sessionId, run.then(() => undefined, () => undefined))
    return run
  }

  /**
   * Apply one batch of operations and persist the result.
   *
   * Operations are `add`, `update`, `remove`, `comment`, `uncomment` and
   * `clear`. An optional `baseRev` rejects the batch when the board moved on,
   * which is how a stale browser tab is told to refetch instead of clobbering
   * an agent's write.
   * @param {string} sessionId - board identity.
   * @param {object[]} ops - operations in order.
   * @param {'user' | 'agent'} author - who is writing.
   * @param {object} [options] - `baseRev` for optimistic concurrency.
   * @returns {Promise<object>} the new document, or `{ conflict: true }`.
   */
  async apply(sessionId, ops, author, options = {}) {
    return this.exclusive(sessionId, async () => {
      const doc = await this.get(sessionId)
      if (Number.isSafeInteger(options.baseRev) && options.baseRev !== doc.rev) {
        return { conflict: true, rev: doc.rev, elements: doc.elements }
      }
      const now = Date.now()
      const next = { ...doc, elements: doc.elements.slice() }
      const touched = []
      for (const op of ops) {
        if (op === null || typeof op !== 'object') continue
        switch (op.op) {
          case 'add': {
            const batch = Array.isArray(op.elements) ? op.elements.slice(0, LIMITS.batch) : []
            for (const raw of batch) {
              if (next.elements.length >= this.maxElements) throw new Error(`board is full (${this.maxElements} elements)`)
              const element = normalizeElement(raw, author, now)
              next.elements.push(element)
              touched.push(element.id)
            }
            break
          }
          case 'update': {
            const patch = op.patch !== null && typeof op.patch === 'object' ? op.patch : op
            const index = next.elements.findIndex((element) => element.id === op.id)
            if (index < 0) break
            const merged = normalizeElement({ ...next.elements[index], ...patch, id: next.elements[index].id, type: next.elements[index].type }, author, now, next.elements[index])
            merged.at = now
            next.elements[index] = merged
            touched.push(merged.id)
            break
          }
          case 'remove': {
            const ids = Array.isArray(op.ids) ? op.ids : [op.id]
            const drop = new Set(ids.filter((id) => typeof id === 'string'))
            next.elements = next.elements.filter((element) => !drop.has(element.id))
            touched.push(...drop)
            break
          }
          case 'comment': {
            const index = next.elements.findIndex((element) => element.id === op.id)
            if (index < 0) throw new Error(`no element "${op.id}" to comment on`)
            const target = { ...next.elements[index] }
            const text = str(op.text, LIMITS.comment).trim()
            if (text === '') throw new Error('a comment needs text')
            const comment = {
              id: `c_${randomUUID().replace(/-/gu, '').slice(0, 10)}`,
              author,
              text,
              at: now,
            }
            target.comments = [...(target.comments ?? []), comment]
            target.at = now
            next.elements[index] = target
            touched.push(target.id)
            break
          }
          case 'uncomment': {
            const index = next.elements.findIndex((element) => element.id === op.id)
            if (index < 0) break
            const target = { ...next.elements[index] }
            target.comments = (target.comments ?? []).filter((comment) => comment.id !== op.commentId)
            next.elements[index] = target
            touched.push(target.id)
            break
          }
          case 'clear': {
            touched.push(...next.elements.map((element) => element.id))
            next.elements = []
            break
          }
          default:
            break
        }
      }
      if (touched.length === 0) return { doc, touched }
      next.rev = doc.rev + 1
      next.updatedAt = now
      this.docs.set(sessionId, next)
      await this.persist(sessionId, next)
      this.notify(sessionId, next.rev)
      return { doc: next, touched }
    })
  }

  /**
   * Write one document to disk atomically.
   * @param {string} sessionId - board identity.
   * @param {object} doc - document to write.
   * @returns {Promise<void>} after the rename completed.
   */
  async persist(sessionId, doc) {
    await mkdir(this.dir, { recursive: true })
    const target = this.fileOf(sessionId)
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify({ sessionId, rev: doc.rev, updatedAt: doc.updatedAt, elements: doc.elements }), 'utf8')
    await rename(temporary, target)
    doc.stamp = await this.stampOf(sessionId)
  }
}

/**
 * Render the model-facing digest of a set of elements.
 * @param {object} doc - board document.
 * @param {object[]} elements - elements to describe, in board order.
 * @param {object} [options] - `full` includes markdown bodies and every comment.
 * @returns {string} plain text.
 */
function digest(doc, elements, options = {}) {
  const lines = [`Board ${doc.rev === 0 ? '(empty)' : `rev ${doc.rev}`} — ${doc.elements.length} element${doc.elements.length === 1 ? '' : 's'}; describing ${elements.length}.`]
  if (elements.length === 0) return lines[0]
  for (const element of elements) {
    const box = (element.box ?? boxOf(element)).map((value) => Math.round(value)).join(',')
    const comments = element.comments ?? []
    lines.push('')
    lines.push(`${element.id} · ${element.type} · by ${element.author} · box [x,y,w,h] ${box}${comments.length > 0 ? ` · ${comments.length} comment${comments.length === 1 ? '' : 's'}` : ''}`)
    if (element.text) lines.push(`  text: ${options.full === true ? element.text : str(element.text, 200)}`)
    if (element.markdown) lines.push(`  markdown: ${options.full === true ? element.markdown : str(element.markdown, 200)}`)
    if (element.name) lines.push(`  image: ${element.name}`)
    for (const comment of comments) {
      lines.push(`  - ${comment.author}: ${options.full === true ? comment.text : str(comment.text, 240)}`)
    }
  }
  return lines.join('\n')
}

/** Services this plugin cannot work without; the rest are reached through `ctx.inject`. */
export const inject = ['tools']

/**
 * The Host plugin body.
 * @param {object} ctx - root Cordis context.
 * @param {object} config - row configuration from `cordis.patch.yml`.
 */
export function apply(ctx, config) {
  // Declared so the plugin waits for the tool registry instead of reading an
  // inactive service. Every other service is optional and reached through
  // `ctx.inject`, so a composition without a web server or a system prompt
  // still loads the board and its tools.
  const settings = {
    ...DEFAULTS,
    ...(config !== null && typeof config === 'object' ? config : {}),
  }
  const dir = typeof settings.dir === 'string' && settings.dir !== '' ? settings.dir : path.join(dshHome(), 'boards')
  const imagesDir = path.join(dir, 'images')
  const listeners = new Map()

  const store = new BoardStore({
    dir,
    maxElements: Math.max(50, Number(settings.maxElements) || DEFAULTS.maxElements),
    notify: (sessionId, rev) => {
      const set = listeners.get(sessionId)
      if (set === undefined) return
      for (const push of set) {
        try {
          push(rev)
        } catch {
          // A dead writer removes itself on the stream's abort; nothing to do here.
        }
      }
    },
  })

  /** Board questions the agent is currently blocked on, by Session. */
  const asks = new Map()

  // ── browser routes ────────────────────────────────────────────────────────
  ctx.inject(['connection'], (scoped) => {
    const register = (route) => scoped.effect(() => scoped.connection.fetch.register(route), `board: ${route.path}`)

    register({
      path: '/api/board/state',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const sessionId = new URL(request.url).searchParams.get('sessionId')
        if (sessionId === null || sessionId === '') return Response.json({ error: 'sessionId is required' }, { status: 400 })
        const doc = await store.get(sessionId)
        return Response.json({ rev: doc.rev, updatedAt: doc.updatedAt, elements: doc.elements }, { headers: { 'cache-control': 'no-store' } })
      },
    })

    register({
      path: '/api/board/op',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        let body
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'body must be JSON' }, { status: 400 })
        }
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
        if (sessionId === '') return Response.json({ error: 'sessionId is required' }, { status: 400 })
        const ops = Array.isArray(body?.ops) ? body.ops : []
        try {
          const result = await store.apply(sessionId, ops, 'user', { baseRev: body?.baseRev })
          if (result.conflict === true) {
            return Response.json({ conflict: true, rev: result.rev, elements: result.elements })
          }
          return Response.json({ rev: result.doc.rev, updatedAt: result.doc.updatedAt, elements: result.doc.elements, touched: result.touched })
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
        }
      },
    })

    register({
      path: '/api/board/image',
      methods: ['POST', 'GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (request.method === 'GET') return serveImage(request, imagesDir)
        return saveImage(request, imagesDir, Math.max(64 * 1024, Number(settings.maxImageBytes) || DEFAULTS.maxImageBytes))
      },
    })

    register({
      path: '/api/board/ask',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const sessionId = new URL(request.url).searchParams.get('sessionId')
        if (sessionId === null || sessionId === '') return Response.json({ error: 'sessionId is required' }, { status: 400 })
        const ask = asks.get(sessionId)
        return Response.json(ask === undefined ? { waiting: false } : { waiting: true, ...ask }, { headers: { 'cache-control': 'no-store' } })
      },
    })

    register({
      path: '/api/board/events',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => openStream(request, store, listeners),
    })
  })

  // ── tools ─────────────────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'board_read',
    description: [
      'Read the shared canvas the user draws and annotates on.',
      'Without `elementId` it returns an overview: every element with its id, type, author, bounding box and a short text excerpt, plus how many comments it carries.',
      'With `elementId` it returns that one element in full, including its markdown body and every comment in its thread.',
      'The user\'s messages usually name the elements they marked; read the board when you need the rest of the picture.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Board to read; omit for the board of your own Session.' },
        elementId: { type: 'string', description: 'Read one element in full instead of the overview.' },
        limit: { type: 'integer', description: 'Maximum elements in the overview, newest last; defaults to 200.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
    },
    async execute(args, exec) {
      const sessionId = typeof args.sessionId === 'string' && args.sessionId !== '' ? args.sessionId : exec.agent?.session?.id
      if (typeof sessionId !== 'string' || sessionId === '') throw new Error('board_read: no Session to read the board of; pass sessionId')
      const doc = await store.get(sessionId)
      if (typeof args.elementId === 'string' && args.elementId !== '') {
        const element = doc.elements.find((candidate) => candidate.id === args.elementId)
        if (element === undefined) return { text: `No element "${args.elementId}" on this board. Board rev ${doc.rev} has ${doc.elements.length} elements.` }
        return { text: digest(doc, [element], { full: true }) }
      }
      const limit = Number.isSafeInteger(args.limit) ? Math.max(1, Math.min(LIMITS.elements, args.limit)) : 200
      const elements = doc.elements.slice(-limit)
      const head = elements.length < doc.elements.length ? `Showing the newest ${elements.length} of ${doc.elements.length}.` : ''
      const body = digest({ ...doc, elements }, elements)
      return { text: head === '' ? body : `${body}\n${head}` }
    },
  })

  ctx.tools.register({
    name: 'board_write',
    description: [
      'Write on the shared canvas: add elements, change or remove them, reply in a comment thread, or clear the board.',
      'One call may combine `add`, `update`, `remove`, `comments` and `clear`; they apply in that order.',
      'Element types: `card` (markdown — headings, lists, tables, code fences; use this for anything the user should read), `note` (short plain text on a sticky), `text` (a bare label), `rect`/`ellipse` (boxes), `arrow`/`line`, `stroke` (freehand), `image`, `pin` (a small marker that carries a thread).',
      'Coordinates are board units with the origin at the top-left; `x`,`y` is the top-left corner for boxed types and the start point for arrows, and `x2`,`y2` is the arrow tip.',
      'Place new elements beside the elements they answer instead of stacking them at the origin, and give the user\'s elements a wide berth.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Board to write on; omit for the board of your own Session.' },
        add: {
          type: 'array',
          description: 'Elements to create, in drawing order.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['card', 'note', 'text', 'rect', 'ellipse', 'arrow', 'line', 'stroke', 'pin', 'image'] },
              x: { type: 'number', description: 'Left edge, or the arrow start.' },
              y: { type: 'number', description: 'Top edge, or the arrow start.' },
              w: { type: 'number', description: 'Width; boxed types default to a readable size when omitted.' },
              h: { type: 'number', description: 'Height.' },
              x2: { type: 'number', description: 'Arrow or line end x.' },
              y2: { type: 'number', description: 'Arrow or line end y.' },
              text: { type: 'string', description: 'Plain text for `note`, `text` and `pin`.' },
              markdown: { type: 'string', description: 'Markdown body for `card`.' },
              title: { type: 'string', description: 'Optional card title, shown above the markdown.' },
              color: { type: 'string', enum: [...COLORS], description: 'Palette name; defaults to `ink`.' },
              size: { type: 'number', description: 'Font size for text-bearing elements, 6–96; defaults to 15.' },
              points: { type: 'array', description: 'Freehand stroke points as [x,y] pairs.', items: { type: 'array', items: { type: 'number' } } },
              attachmentId: { type: 'string', description: 'Image attachment from the board image route.' },
              name: { type: 'string', description: 'Display name for an image.' },
            },
            additionalProperties: false,
          },
        },
        update: {
          type: 'array',
          description: 'Changes to existing elements by id; omitted fields keep their value.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Element id from `board_read`.' },
              x: { type: 'number' },
              y: { type: 'number' },
              w: { type: 'number' },
              h: { type: 'number' },
              text: { type: 'string' },
              markdown: { type: 'string' },
              color: { type: 'string', enum: [...COLORS] },
              size: { type: 'number' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
        remove: { type: 'array', description: 'Element ids to delete.', items: { type: 'string' } },
        comments: {
          type: 'array',
          description: 'Replies appended to element threads.',
          items: {
            type: 'object',
            properties: {
              elementId: { type: 'string', description: 'Element whose thread receives the reply.' },
              text: { type: 'string', description: 'Reply text; plain text or light markdown.' },
            },
            required: ['elementId', 'text'],
            additionalProperties: false,
          },
        },
        clear: { type: 'boolean', description: 'Delete every element on the board. Only when the user asked for it.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
    },
    async execute(args, exec) {
      const sessionId = typeof args.sessionId === 'string' && args.sessionId !== '' ? args.sessionId : exec.agent?.session?.id
      if (typeof sessionId !== 'string' || sessionId === '') throw new Error('board_write: no Session to write on; pass sessionId')
      const ops = []
      if (Array.isArray(args.add) && args.add.length > 0) ops.push({ op: 'add', elements: args.add })
      if (Array.isArray(args.update)) {
        for (const patch of args.update) ops.push({ op: 'update', id: patch.id, patch })
      }
      if (Array.isArray(args.remove) && args.remove.length > 0) ops.push({ op: 'remove', ids: args.remove })
      if (Array.isArray(args.comments)) {
        for (const comment of args.comments) ops.push({ op: 'comment', id: comment.elementId, text: comment.text })
      }
      if (args.clear === true) ops.push({ op: 'clear' })
      if (ops.length === 0) return { text: 'Nothing to do: pass `add`, `update`, `remove`, `comments` or `clear`.' }
      const result = await store.apply(sessionId, ops, 'agent')
      const doc = result.doc ?? (await store.get(sessionId))
      const created = (result.touched ?? []).filter((id) => doc.elements.some((element) => element.id === id))
      const lines = [`Board rev ${doc.rev}: ${doc.elements.length} element${doc.elements.length === 1 ? '' : 's'} now.`]
      if (created.length > 0) lines.push(`Touched: ${created.join(', ')}`)
      return { text: lines.join('\n') }
    },
  })

  // ── board_ask: bring the board forward and wait for the user ───────────────
  //
  // The agent calls this when the answer has to be drawn rather than typed. It
  // rides the same `ctx.userQuestions` seam `ask_user_question` uses, so the
  // Web client renders it through the answerer that already exists: the board
  // becomes the question, and the turn genuinely blocks until the user replies.
  ctx.inject(['userQuestions'], (scoped) => {
    scoped.effect(() => scoped.tools.register({
      name: 'board_ask',
      description: [
        'Open the shared board in front of the user and wait for them to answer on it.',
        'Use this instead of asking in chat when the answer has to be drawn, arranged or annotated: a layout, a diagram, "mark the one you mean", a correction to what you drew.',
        'The turn blocks until the user replies; their answer comes back as text describing what they changed or marked, together with the board revision.',
        'Write what you want them to see on the board FIRST with `board_write`, then call this with a short `prompt` naming what to look at.',
        'Do not use this for a question a plain `ask_user_question` can carry: a blocking board costs the user more than picking an option.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Board to open; omit for the board of your own Session.' },
          prompt: { type: 'string', description: 'One line shown above the board, telling the user what to do.' },
          detail: { type: 'string', description: 'Optional longer markdown shown with the prompt.' },
          answers: {
            type: 'array',
            description: 'Choices offered as buttons beside the board. Omit to accept only the user\'s own written answer.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['label'],
              additionalProperties: false,
            },
          },
          wait: { type: 'boolean', description: 'Whether to wait for the answer; defaults to true. `false` returns immediately with the board still open.' },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
      },
      async execute(args, exec) {
        const sessionId = typeof args.sessionId === 'string' && args.sessionId !== '' ? args.sessionId : exec.agent?.session?.id
        if (typeof sessionId !== 'string' || sessionId === '') throw new Error('board_ask: no Session to open the board of; pass sessionId')
        if (exec.agent === undefined) throw new Error('board_ask requires a live agent')
        const doc = await store.get(sessionId)
        const prompt = str(args.prompt, 400) || 'Look at the board and reply.'
        const detail = str(args.detail, 4000)
        const options = Array.isArray(args.answers)
          ? args.answers.filter((option) => option !== null && typeof option === 'object' && typeof option.label === 'string' && option.label !== '').map((option) => ({ label: str(option.label, 200), ...(typeof option.description === 'string' ? { description: str(option.description, 400) } : {}) }))
          : []
        const revision = doc.rev

        // The composer card is the only surface that can settle a blocking
        // question, so `detail` has to say what the user needs there. It stays
        // plain prose: the card renders markdown verbatim, so a machine-readable
        // marker would show up as source text.
        const boardLine = doc.elements.length === 0
          ? 'The board is empty — draw or write on it, then answer here.'
          : `The board has ${doc.elements.length} element${doc.elements.length === 1 ? '' : 's'}. Edit it on the right, then answer here.`
        const question = {
          id: 'board',
          question: prompt,
          detail: [detail, boardLine].filter((part) => part !== '').join('\n\n'),
          header: 'Board',
          ...(options.length === 0 ? {} : { options }),
        }

        if (args.wait === false) {
          return { text: `Board opened at rev ${revision}. The user can answer on it whenever they are ready.` }
        }

        // Publish the wait so the board tab can raise itself: the browser polls
        // this while the question is open, which is how a docked board becomes a
        // blocking board without the client owning the question mechanism.
        asks.set(sessionId, { prompt, detail: detail, options, revision, callId: String(exec.callId), at: Date.now() })
        const release = () => {
          if (asks.get(sessionId)?.revision === revision) asks.delete(sessionId)
        }

        let answer
        try {
          answer = await scoped.userQuestions.ask({
            questions: [question],
            agent: exec.agent,
            signal: exec.signal,
            wait: { callId: exec.callId },
          })
        } catch (error) {
          // A closed panel is not an answer, but it must not look like a crash
          // either: report it so the model knows the user stepped away.
          const message = error instanceof Error ? error.message : String(error)
          return { text: `The board question closed without an answer (${message}). Do not assume an answer; ask again later or continue with what you have.` }
        } finally {
          release()
        }

        const item = Array.isArray(answer?.answers) ? answer.answers.find((entry) => entry?.id === 'board') : undefined
        const chosen = Array.isArray(item?.selected) ? item.selected.filter((value) => typeof value === 'string') : []
        const written = typeof item?.custom === 'string' ? item.custom : ''
        const after = await store.get(sessionId)
        const changed = after.rev !== revision
        const lines = [`The user answered on the board (rev ${revision} → ${after.rev}${changed ? ', they changed it' : ', unchanged'}).`]
        if (chosen.length > 0) lines.push(`Chosen: ${chosen.join(', ')}`)
        if (written !== '') lines.push('Their note:', written)
        if (chosen.length === 0 && written === '') lines.push('They submitted without a written note; read the board to see what they did.')
        lines.push('Read the board with `board_read` for the details of anything they changed.')
        return { text: lines.join('\n') }
      },
    }), 'board: board_ask tool')
  })

  // ── prompt section ────────────────────────────────────────────────────────
  if (settings.promptSection !== false) {
    ctx.inject(['systemPrompt'], (scoped) => {
      scoped.effect(() => scoped.systemPrompt.section({
        name: 'board',
        order: 88,
        text: PROMPT.section,
      }), 'board: prompt section')
    })
  }
}

/**
 * Open one Server-Sent-Events stream for a board.
 * @param {Request} request - the GET request naming `sessionId`.
 * @param {BoardStore} store - board store, used for the opening revision.
 * @param {Map<string, Set<(rev: number) => void>>} listeners - live writers per board.
 * @returns {Promise<Response>} a streaming response.
 */
async function openStream(request, store, listeners) {
  const sessionId = new URL(request.url).searchParams.get('sessionId')
  if (sessionId === null || sessionId === '') return new Response('sessionId is required', { status: 400 })
  const doc = await store.get(sessionId)
  const encoder = new TextEncoder()
  let heartbeat
  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      const write = (chunk) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          closed = true
        }
      }
      const push = (rev) => write(`data: ${JSON.stringify({ rev })}\n\n`)
      write(`retry: 3000\ndata: ${JSON.stringify({ rev: doc.rev })}\n\n`)
      let set = listeners.get(sessionId)
      if (set === undefined) {
        set = new Set()
        listeners.set(sessionId, set)
      }
      set.add(push)
      heartbeat = setInterval(() => write(': keep-alive\n\n'), 25000)
      const cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        set.delete(push)
        if (set.size === 0) listeners.delete(sessionId)
        try {
          controller.close()
        } catch {
          // Already closed by the client.
        }
      }
      request.signal.addEventListener('abort', cleanup, { once: true })
    },
    cancel() {
      clearInterval(heartbeat)
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    },
  })
}

/**
 * Store one pasted image for a board.
 * @param {Request} request - POST carrying `{ sessionId, mediaType, data }`.
 * @param {string} dir - image directory.
 * @param {number} maxBytes - largest accepted decoded image.
 * @returns {Promise<Response>} `{ id }` or an error.
 */
async function saveImage(request, dir, maxBytes) {
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 })
  }
  const mediaType = typeof body?.mediaType === 'string' ? body.mediaType : 'image/png'
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[mediaType]
  if (extension === undefined) return Response.json({ error: `unsupported image type "${mediaType}"` }, { status: 415 })
  const data = typeof body?.data === 'string' ? body.data : ''
  if (data === '') return Response.json({ error: 'data (base64) is required' }, { status: 400 })
  let bytes
  try {
    bytes = Buffer.from(data, 'base64')
  } catch {
    return Response.json({ error: 'data is not base64' }, { status: 400 })
  }
  if (bytes.byteLength === 0) return Response.json({ error: 'empty image' }, { status: 400 })
  if (bytes.byteLength > maxBytes) return Response.json({ error: `image larger than ${maxBytes} bytes` }, { status: 413 })
  const id = `i_${randomUUID().replace(/-/gu, '').slice(0, 16)}`
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${id}.${extension}`), bytes)
  return Response.json({ id, mediaType, bytes: bytes.byteLength })
}

/**
 * Serve one stored image.
 * @param {Request} request - GET carrying `?id=`.
 * @param {string} dir - image directory.
 * @returns {Promise<Response>} the bytes, or 404.
 */
async function serveImage(request, dir) {
  const id = new URL(request.url).searchParams.get('id')
  if (id === null || !/^i_[A-Za-z0-9]+$/u.test(id)) return new Response('bad id', { status: 400 })
  for (const [extension, mediaType] of [['png', 'image/png'], ['jpg', 'image/jpeg'], ['webp', 'image/webp'], ['gif', 'image/gif']]) {
    try {
      const bytes = await readFile(path.join(dir, `${id}.${extension}`))
      return new Response(bytes, { headers: { 'content-type': mediaType, 'cache-control': 'private, max-age=31536000, immutable' } })
    } catch {
      // Try the next extension.
    }
  }
  return new Response('not found', { status: 404 })
}
