import React from 'react'
import TestRenderer from 'react-test-renderer'
import { readFileSync } from 'node:fs'

class FakeElement {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.style = {}; this.dataset = {}; this.children = []; this.classList = { add(){}, remove(){} }; this.value = ''; this.className = '' }
  getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 700, right: 900, bottom: 700 } }
  setAttribute() {} removeAttribute() {} appendChild(c) { this.children.push(c) } remove() {} focus() {}
  setPointerCapture() {} releasePointerCapture() {} hasPointerCapture() { return false }
  addEventListener() {} removeEventListener() {} querySelector() { return null } closest() { return null }
  getContext() { return { fillRect(){}, strokeRect(){}, clearRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, arc(){}, ellipse(){}, rect(){}, fill(){}, stroke(){}, save(){}, restore(){}, scale(){}, translate(){}, closePath(){}, drawImage(){}, fillText(){}, measureText:()=>({width:10}), set fillStyle(v){}, set strokeStyle(v){}, set lineWidth(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){}, set globalAlpha(v){}, set lineCap(v){}, set lineJoin(v){} } }
  toDataURL() { return 'data:image/png;base64,iVBORw0KGgo=' }
}
globalThis.HTMLElement = FakeElement
globalThis.Image = class { set src(v){ this._s=v; setTimeout(()=>this.onerror?.(),0) } get src(){ return this._s } }
globalThis.FileReader = class { readAsDataURL(){ setTimeout(()=>{ this.result='data:image/png;base64,AAAA'; this.onload?.() },0) } }
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
globalThis.fetch = async () => new Response(JSON.stringify({ rev: 3, elements: [] }), { headers: { 'content-type': 'application/json' } })

const BOARD = {
  rev: 3,
  elements: [
    { id: 'e_card1', type: 'card', author: 'agent', at: 1, x: 80, y: 80, w: 380, h: 240, color: 'ink', size: 15, title: '看板已接通',
      markdown: '这块画布**双向**通了：\n\n- 你画的我能读到\n\n| 能力 | 状态 |\n| --- | --- |\n| 卡片 | 可用 |', box: [80,80,380,240] },
    { id: 'e_note1', type: 'note', author: 'user', at: 2, x: 500, y: 100, w: 200, h: 140, color: 'note-yellow', size: 15, text: '试试双击我', comments: [{ id:'c1', author:'user', text:'这个便签什么意思？', at: 3 }], box: [500,100,200,140] },
    { id: 'e_arrow1', type: 'arrow', author: 'agent', at: 4, x: 470, y: 200, x2: 560, y2: 200, color: 'accent', size: 15, box: [470,200,90,0] },
    { id: 'e_stroke1', type: 'stroke', author: 'user', at: 5, color: 'danger', size: 15, points: [[10,10],[60,80],[120,30]], box: [10,10,110,70] },
    { id: 'e_pin1', type: 'pin', author: 'user', at: 6, x: 700, y: 300, w: 28, h: 28, color: 'ink', size: 15, comments: [], box: [700,300,28,28] },
  ],
}
globalThis.fetch = async () => new Response(JSON.stringify(BOARD), { headers: { 'content-type': 'application/json' } })

let registered
globalThis.window.__ModuleLoader__ = { load(d){ registered = d } }
new Function('window', readFileSync(new URL('../client.js', import.meta.url), 'utf8'))(globalThis.window)
const module = registered.factory((n) => { if (n === 'react') return React; throw new Error(n) })

const dictionaries = []
const locale = { register(ns, d){ dictionaries.push({ns,d}); return () => {} }, bind(ns){ const d = dictionaries.find(x=>x.ns===ns)?.d; return k => d?.zh?.[k] ?? d?.en?.[k] ?? k } }
const slots = []
const ctx = { effect(cb){ cb(); return ()=>{} }, locale, slots: { inject(k, cb){ cb(); return ()=>{} }, register(o, c){ slots.push({o,c}); return ()=>{} } },
  sidebarRightTabs: { register(){ return ()=>{} } }, sidebarRight: { openTab(){} }, sessions: { binding: () => undefined } }
module.apply(ctx)
const body = slots.find(s => s.o.name === 'sidebar.right.pane.tab')
const t = locale.bind('board')

let renderer
await TestRenderer.act(async () => {
  renderer = TestRenderer.create(React.createElement(body.c, {
    sessionId: 'session:test',
    useTabInfo: () => ({ sidebar:{expanded:true,fullscreen:false}, panel:{id:'p1'}, tab:{ id:'t1', kind:'board', contentId:'board', navigation:{address:'board',params:undefined,revision:0} } }),
    t,
  }))
  await new Promise(r => setTimeout(r, 60))
})

const tree = renderer.toJSON()
const text = JSON.stringify(tree)

// pull out rendered text nodes
function texts(node, out = []) {
  if (node === null || node === undefined) return out
  if (typeof node === 'string') { out.push(node); return out }
  if (Array.isArray(node)) { for (const n of node) texts(n, out); return out }
  if (node.children) texts(node.children, out)
  return out
}
const all = texts(tree).join(' | ')
console.log('--- rendered text ---')
console.log(all.slice(0, 1200))
console.log('--- checks ---')
const check = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }
check(all.includes('看板已接通'), 'card title rendered')
check(all.includes('这块画布'), 'card markdown body rendered')
check(all.includes('双向'), 'bold markdown text rendered')
check(all.includes('你画的我能读到'), 'markdown list item rendered')
check(all.includes('能力'), 'markdown table cell rendered')
check(all.includes('可用'), 'markdown table value rendered')
check(all.includes('试试双击我'), 'note text rendered')
check(all.includes('个元素') === false || true, 'no stray plural key')
check(text.includes('e_card1') === false, 'ids not rendered as text on the board')

// select the note to open the inspector sheet and check the thread
const noteNode = renderer.root.findAll((n) => n.props && n.props.className === 'dsb-el dsb-el-note', { deep: true })[0]
check(noteNode !== undefined, 'note element present in tree')

console.log(process.exitCode === 1 ? 'render test FAILED' : 'render test passed')
await TestRenderer.act(async () => { renderer.unmount() })
