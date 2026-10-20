/**
 * Renders the board tab body in a real React tree against stubbed Client
 * services, so a crash, a bad hook order or a missing prop shows up here
 * instead of blanking the slot entry in the page.
 */
import React from 'react'
import TestRenderer from 'react-test-renderer'
import { readFileSync } from 'node:fs'

// ── minimal DOM the component touches ───────────────────────────────────────
class FakeClassList {
  add() {}
  remove() {}
}
class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase()
    this.style = {}
    this.dataset = {}
    this.children = []
    this.classList = new FakeClassList()
    this.value = ''
    this.className = ''
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }
  }
  setAttribute() {}
  removeAttribute() {}
  appendChild(child) {
    this.children.push(child)
  }
  remove() {}
  focus() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() {
    return false
  }
  addEventListener() {}
  removeEventListener() {}
  getContext() {
    return {
      fillRect() {}, strokeRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
      arc() {}, ellipse() {}, rect() {}, fill() {}, stroke() {}, save() {}, restore() {},
      scale() {}, translate() {}, closePath() {}, drawImage() {}, fillText() {}, measureText: () => ({ width: 10 }),
      set fillStyle(value) {}, set strokeStyle(value) {}, set lineWidth(value) {}, set font(value) {},
      set textAlign(value) {}, set textBaseline(value) {}, set globalAlpha(value) {}, set lineCap(value) {}, set lineJoin(value) {},
    }
  }
  toDataURL() {
    return 'data:image/png;base64,iVBORw0KGgo='
  }
  querySelector() {
    return null
  }
  closest() {
    return null
  }
}

globalThis.HTMLElement = FakeElement
globalThis.Image = class {
  set src(value) {
    this._src = value
    setTimeout(() => this.onerror?.(), 0)
  }
  get src() {
    return this._src
  }
}
globalThis.FileReader = class {
  readAsDataURL() {
    setTimeout(() => {
      this.result = 'data:image/png;base64,AAAA'
      this.onload?.()
    }, 0)
  }
}
globalThis.window = {
  confirm: () => true,
  getComputedStyle: () => ({ getPropertyValue: () => '#123456' }),
}
globalThis.getComputedStyle = globalThis.window.getComputedStyle
const documentListeners = new Map()
globalThis.document = {
  documentElement: new FakeElement('html'),
  createElement: (tag) => (tag === 'canvas' ? new FakeElement('canvas') : new FakeElement(tag)),
  addEventListener(type, handler) {
    const set = documentListeners.get(type) ?? new Set()
    set.add(handler)
    documentListeners.set(type, set)
  },
  removeEventListener(type, handler) {
    documentListeners.get(type)?.delete(handler)
  },
}
globalThis.dispatchDocumentKey = (event) => {
  for (const handler of documentListeners.get('keydown') ?? []) handler(event)
}
globalThis.EventSource = class {
  constructor() {
    this.readyState = 0
  }
  close() {}
}
globalThis.fetch = async () => new Response(JSON.stringify({ rev: 0, elements: [] }), { headers: { 'content-type': 'application/json' } })

// ── load the bundle ─────────────────────────────────────────────────────────
let registered
globalThis.window.__ModuleLoader__ = {
  load({ id, factory }) {
    registered = { id, factory }
  },
}
globalThis.window.__ModuleLoader__ = {
  load(definition) {
    registered = definition
  },
}
new Function('window', readFileSync(new URL('../client.js', import.meta.url), 'utf8'))(globalThis.window)

const module = registered.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require(${name})`)
})

// ── stub Client services ────────────────────────────────────────────────────
const dictionaries = []
const slotRegistrations = []
const tabTypes = []
const openedTabs = []
const locale = {
  register(ns, dicts) {
    dictionaries.push({ ns, dicts })
    return () => {}
  },
  bind(ns) {
    const dict = dictionaries.find((entry) => entry.ns === ns)?.dicts
    return (key) => dict?.zh?.[key] ?? dict?.en?.[key] ?? key
  },
}
const ctx = {
  effect(callback) {
    callback()
    return () => {}
  },
  locale,
  slots: {
    inject(key, callback) {
      const dispose = callback()
      slotRegistrations.push({ key, dispose })
      return () => {}
    },
    register(options, component) {
      slotRegistrations.push({ key: options.name, options, component })
      return () => {}
    },
  },
  sidebarRightTabs: {
    register(definition) {
      tabTypes.push(definition)
      return () => {}
    },
  },
  sidebarRight: {
    openTab(kind) {
      openedTabs.push(kind)
    },
  },
  sessions: {
    binding: () => undefined,
  },
}

module.apply(ctx)

// ── assertions ──────────────────────────────────────────────────────────────
const assert = (condition, message) => {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exitCode = 1
  } else {
    console.log(`ok  ${message}`)
  }
}

assert(dictionaries.length === 1, 'dictionaries registered once')
assert(dictionaries[0].dicts.zh !== undefined && dictionaries[0].dicts.en !== undefined, 'zh and en dictionaries present')
assert(tabTypes.length === 1, 'one tab type registered')
assert(tabTypes[0].kind === 'board', 'tab kind is board')
assert(tabTypes[0].priority === 'extension', 'extension band')
assert(typeof tabTypes[0].title() === 'string' && tabTypes[0].title() !== 'title', 'tab title resolves from copy')
assert(Array.isArray(tabTypes[0].guide) && tabTypes[0].guide.length === 1, 'one guide entry')

const body = slotRegistrations.find((entry) => entry.key === 'sidebar.right.pane.tab')
assert(body !== undefined, 'tab body registered into sidebar.right.pane.tab')
assert(body.options.key === 'dsh-board', 'body keyed by the definition id')
const header = slotRegistrations.find((entry) => entry.key === 'conversation.session.header.utilities')
assert(header !== undefined, 'header button registered')

// ── render the body ────────────────────────────────────────────────────────
const t = locale.bind('board')
const tab = { id: 'tab-1', kind: 'board', contentId: 'board', navigation: { address: 'board', params: undefined, revision: 0 } }

let renderer
await TestRenderer.act(async () => {
  renderer = TestRenderer.create(
    React.createElement(body.component, {
      sessionId: 'session:test',
      useTabInfo: () => ({ sidebar: { expanded: true, fullscreen: false }, panel: { id: 'p1' }, tab }),
      t,
    }),
  )
  await new Promise((resolve) => setTimeout(resolve, 30))
})

const json = renderer.toJSON()
const text = JSON.stringify(json)
assert(text.length > 100, 'board rendered a tree')
assert(text.includes('dsb-root'), 'root class present')
assert(text.includes('dsb-bar'), 'toolbar present')
assert(text.includes('dsb-stage'), 'stage present')

const svgCount = renderer.root.findAll((node) => node.type === 'svg', { deep: true }).length
assert(svgCount > 10, `tool icons rendered (${svgCount} svg)`)

// ── the header button renders and opens the tab ────────────────────────────
let headerRenderer
await TestRenderer.act(async () => {
  headerRenderer = TestRenderer.create(React.createElement(header.component, {
    useSession: (selector) => selector({ openState: 'open' }),
    openBoard: () => ctx.sidebarRight.openTab('board'),
    t,
  }))
})
assert(headerRenderer.toJSON() !== null, 'header button rendered')
await TestRenderer.act(async () => {
  headerRenderer.root.findByType('button').props.onClick()
})
assert(openedTabs.includes('board'), 'header button opens the board tab')

// ── unmount cleanly ────────────────────────────────────────────────────────
await TestRenderer.act(async () => {
  renderer.unmount()
  headerRenderer.unmount()
})

console.log(process.exitCode === 1 ? 'client tests FAILED' : 'client tests passed')
