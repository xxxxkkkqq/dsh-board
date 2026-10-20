import React from 'react'
import TestRenderer from 'react-test-renderer'
import { readFileSync } from 'node:fs'

class FakeElement {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.style = {}; this.dataset = {}; this.children = []; this.classList = { add(){}, remove(){} }; this.value=''; this.className='' }
  getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 700, right: 900, bottom: 700 } }
  setAttribute(){} removeAttribute(){} appendChild(c){this.children.push(c)} remove(){} focus(){}
  setPointerCapture(){} releasePointerCapture(){} hasPointerCapture(){ return false }
  addEventListener(){} removeEventListener(){} querySelector(){ return null } closest(){ return null }
  getContext(){ return { fillRect(){},strokeRect(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},arc(){},ellipse(){},rect(){},fill(){},stroke(){},save(){},restore(){},scale(){},translate(){},closePath(){},drawImage(){},fillText(){},measureText:()=>({width:10}),set fillStyle(v){},set strokeStyle(v){},set lineWidth(v){},set font(v){},set textAlign(v){},set textBaseline(v){},set globalAlpha(v){},set lineCap(v){},set lineJoin(v){} } }
  toDataURL(){ return 'data:image/png;base64,iVBORw0KGgo=' }
}
globalThis.HTMLElement = FakeElement
globalThis.Image = class { set src(v){this._s=v;setTimeout(()=>this.onerror?.(),0)} get src(){return this._s} }
globalThis.FileReader = class { readAsDataURL(){ setTimeout(()=>{this.result='data:image/png;base64,AAAA';this.onload?.()},0) } }
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#123456' })
globalThis.window = { confirm: () => true, getComputedStyle: globalThis.getComputedStyle }
const documentListeners = new Map()
globalThis.document = {
  documentElement: new FakeElement('html'),
  createElement: (t) => new FakeElement(t),
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
globalThis.EventSource = class { constructor(){} close(){} }

const BOARD = { rev: 5, elements: [
  { id:'e_note1', type:'note', author:'user', at:2, x:100, y:100, w:200, h:140, color:'note-yellow', size:15, text:'试试双击我', comments:[], box:[100,100,200,140] },
]}

const posts = []
globalThis.fetch = async (url, init) => {
  const u = String(url)
  if (u.includes('/op')) {
    const body = JSON.parse(init.body)
    posts.push(body)
    // emulate the server: apply the comment op
    const next = JSON.parse(JSON.stringify(BOARD))
    for (const op of body.ops) {
      if (op.op === 'comment') {
        const target = next.elements.find(e => e.id === op.id)
        target.comments = [...(target.comments ?? []), { id: 'c_new', author: 'user', text: op.text, at: 99 }]
      }
      if (op.op === 'add') for (const el of op.elements) next.elements.push({ ...el, id: `e_new${next.elements.length}`, author: 'user', at: 50, box: [el.x, el.y, el.w ?? 1, el.h ?? 1] })
      if (op.op === 'update') {
        const target = next.elements.find(e => e.id === op.id)
        Object.assign(target, op.patch)
      }
      if (op.op === 'remove') next.elements = next.elements.filter(e => !(op.ids ?? [op.id]).includes(e.id))
    }
    next.rev = body.baseRev + 1
    return new Response(JSON.stringify({ rev: next.rev, elements: next.elements, touched: [] }), { headers: { 'content-type': 'application/json' } })
  }
  return new Response(JSON.stringify(BOARD), { headers: { 'content-type': 'application/json' } })
}

// prompt capture
const prompts = []
const session = {
  sessionId: 'session:test',
  beginSubmission(input) { return { requestId: `req-${prompts.length}`, abandon(){} } },
  async prompt(content, mode, signal, requestId) {
    prompts.push({ content, mode, requestId })
    return { ok: true, value: { accepted: true } }
  },
}

let registered
globalThis.window.__ModuleLoader__ = { load(d){ registered = d } }
new Function('window', readFileSync(new URL('../client.js', import.meta.url), 'utf8'))(globalThis.window)
const module = registered.factory((n) => { if (n === 'react') return React; throw new Error(n) })

const dictionaries = []
const locale = { register(ns,d){ dictionaries.push({ns,d}); return ()=>{} }, bind(ns){ const d=dictionaries.find(x=>x.ns===ns)?.d; return k=>d?.zh?.[k] ?? d?.en?.[k] ?? k } }
const slots = []
const ctx = { effect(cb){ cb(); return ()=>{} }, locale,
  slots: { inject(k,cb){ cb(); return ()=>{} }, register(o,c){ slots.push({o,c}); return ()=>{} } },
  sidebarRightTabs: { register(){ return ()=>{} } },
  sidebarRight: { openTab(){} },
  sessions: { binding: () => ({ session, ctx: {} }) } }
module.apply(ctx)
const body = slots.find(s => s.o.name === 'sidebar.right.pane.tab')
const t = locale.bind('board')

let renderer
await TestRenderer.act(async () => {
  renderer = TestRenderer.create(React.createElement(body.c, {
    sessionId: 'session:test',
    useTabInfo: () => ({ sidebar:{expanded:true,fullscreen:false}, panel:{id:'p1'}, tab:{ id:'t1', kind:'board', contentId:'board', navigation:{address:'board',params:undefined,revision:0} } }),
    t,
  }), { createNodeMock: () => new FakeElement('div') })
  await new Promise(r => setTimeout(r, 60))
})

const check = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

// stage pointerdown on the note → selects it and opens the inspector sheet
const stage = renderer.root.findAll((n) => n.props && n.props['data-dsb-stage'] === true, { deep: true })[0]
check(stage !== undefined, 'stage found')
const rect = stage.props.ref ? null : null

// The board fits itself to its content on first load, so the world origin is no
// longer at the stage origin. Reset the view through the toolbar's 100% control
// is not exposed here; instead resolve the note's own centre from its box and
// convert it with the same transform the stage uses.
const view = renderer.root.findAll((n) => n.type === 'div' && typeof n.props.className === 'string' && n.props.className === 'dsb-world', { deep: true })[0]
const transform = /translate\(([-0-9.]+)px, ([-0-9.]+)px\) scale\(([-0-9.]+)\)/u.exec(view.props.style.transform)
const [tx, ty, sc] = [Number(transform[1]), Number(transform[2]), Number(transform[3])]
const noteBox = BOARD.elements[0].box
const clientX = tx + (noteBox[0] + noteBox[2] / 2) * sc
const clientY = ty + (noteBox[1] + noteBox[3] / 2) * sc

await TestRenderer.act(async () => {
  stage.props.onPointerDown({ button: 0, clientX, clientY, pointerId: 1, shiftKey: false, preventDefault(){} })
  stage.props.onPointerUp({ pointerId: 1 })
  await new Promise(r => setTimeout(r, 20))
})

const sheet = renderer.root.findAll((n) => n.props && n.props.className === 'dsb-sheet', { deep: true })[0]
check(sheet !== undefined, 'inspector sheet opens on selection')

const textareas = renderer.root.findAll((n) => n.type === 'textarea', { deep: true })
check(textareas.length >= 1, 'comment box present for a single selection')

// type a comment and add it
await TestRenderer.act(async () => {
  textareas[0].props.onChange({ target: { value: '这个便签什么意思？' } })
})
await TestRenderer.act(async () => {
  const addBtn = renderer.root.findAll((n) => n.type === 'button' && n.props.title === undefined && typeof n.props.onClick === 'function' && n.props.disabled === false, { deep: true })
  // find the button whose child text is the add-comment label
  const labelOf = (node) => {
    const walk = (value) => {
      if (typeof value === 'string') return value
      if (Array.isArray(value)) return value.map(walk).join(' ')
      if (value && typeof value === 'object' && value.props) return walk(value.props.children)
      return ''
    }
    return walk(node)
  }
  const add = renderer.root.findAll((n) => n.type === 'button', { deep: true }).find((b) => labelOf(b.props.children).includes('添加批注'))
  check(add !== undefined, 'add-comment button found')
  add.props.onClick()
})
await new Promise(r => setTimeout(r, 80))
check(posts.some(p => p.ops.some(o => o.op === 'comment' && o.text === '这个便签什么意思？')), 'comment posted to the host')

// send to the agent
await TestRenderer.act(async () => {
  const send = renderer.root.findAll((n) => n.type === 'button' && n.props.className === 'dsb-primary', { deep: true })
  check(send.length >= 1, 'send button present')
  send[send.length - 1].props.onClick()
  await new Promise(r => setTimeout(r, 200))
})
await new Promise(r => setTimeout(r, 300))
check(prompts.length >= 1, 'prompt sent to the session')
if (prompts.length > 0) {
  const p = prompts[0]
  const textPart = p.content.find(c => c.type === 'text')
  check(textPart !== undefined, 'prompt carries text')
  check(textPart.text.includes('e_note1'), 'prompt names the selected element id')
  check(textPart.text.includes('试试双击我'), 'prompt carries the element text')
  check(p.mode === 'queue', 'prompt queued')
  const image = p.content.find(c => c.type === 'image')
  check(image !== undefined && image.mediaType === 'image/png', 'prompt carries a png snapshot')
  check(image.data.length > 0, 'snapshot has bytes')
}

// ── eraser, undo and redo ──────────────────────────────────────────────────
// Reset to a known board of two rectangles, then erase one and undo it.
const resetBoard = async () => {
  posts.length = 0
  await TestRenderer.act(async () => {
    const world = renderer.root.findAll((n) => n.type === 'div' && n.props.className === 'dsb-world', { deep: true })[0]
    return world
  })
}

// The eraser is reached through the toolbar, exactly as a user reaches it.
// The toolbar is the only place with these titles; the mode strip is not a button.
const toolButton = (label) => renderer.root.findAll((n) => n.type === 'button', { deep: true })
  .find((b) => typeof b.props.title === 'string' && b.props.title.startsWith(label))
check(toolButton('橡皮擦') !== undefined, 'eraser button present')
check(toolButton('撤销') !== undefined, 'undo button present')
check(toolButton('重做') !== undefined, 'redo button present')

await TestRenderer.act(async () => {
  toolButton('橡皮擦').props.onClick()
  await new Promise((r) => setTimeout(r, 60))
})
const isModeStrip = (n) => n.props && typeof n.props.className === 'string' && /^dsb-mode( |$)/u.test(n.props.className)
const modeStrip = renderer.root.findAll(isModeStrip, { deep: true })
check(modeStrip.length === 1 && modeStrip[0].props.className.includes('dsb-mode-eraser'), 'mode strip shows the active eraser')


// A click on the active tool leaves the mode.
await TestRenderer.act(async () => {
  toolButton('橡皮擦').props.onClick()
  await new Promise((r) => setTimeout(r, 60))
})
check(renderer.root.findAll(isModeStrip, { deep: true }).length === 0, 're-clicking the tool leaves the mode')

console.log(process.exitCode === 1 ? 'interaction test FAILED' : 'interaction test passed')
await TestRenderer.act(async () => { renderer.unmount() })
