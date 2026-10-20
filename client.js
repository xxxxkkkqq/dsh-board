/**
 * dsh-board — browser half.
 *
 * A shared canvas in a right-Sidebar tab: the user draws, writes, pastes and
 * annotates; the agent reads the same board through its `board_read` tool and
 * answers on it with `board_write`, and the change arrives here over one
 * Server-Sent-Events stream.
 *
 * Hand-written ModuleLoader bundle: no build step, no dependency beyond the
 * `react` the shell already provides, no Harness Client package imported. Every
 * chrome colour is a theme token; sticky paper and the one accent the palette
 * lacks stay literal, as the host's own artwork does, so the page follows a
 * scheme switch.
 */
window.__ModuleLoader__.load({
  id: 'dsh-board',
  factory: require => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback, useMemo } = React

    const NS = 'board'
    const KIND = 'board'
    const ID = 'dsh-board'
    const API = 'api/board'

    // ── palette ───────────────────────────────────────────────────────────────
    /** Theme-token colours; these follow the host scheme. */
    const TOKEN_COLORS = {
      ink: '--dsw-alias-label-primary',
      muted: '--dsw-alias-label-secondary',
      accent: '--dsw-alias-brand-primary',
      ok: '--dsw-alias-state-success-primary',
      warn: '--dsw-alias-state-warn-primary',
      danger: '--dsw-alias-state-error-primary',
    }
    /** Literal artwork colours: sticky paper, plus the one accent the palette lacks. */
    const LITERAL_COLORS = {
      violet: '#8b5cf6',
      'note-yellow': '#f6e3a1',
      'note-pink': '#f8cfe0',
      'note-blue': '#c3ddf9',
      'note-green': '#c9ecc9',
    }
    const SWATCHES = ['ink', 'accent', 'ok', 'warn', 'danger', 'violet']
    const NOTE_SWATCHES = ['note-yellow', 'note-pink', 'note-blue', 'note-green']
    const STICKY_TEXT = '#2b2b2b'

    /**
     * Resolve a palette name to a CSS colour usable in DOM and SVG.
     * @returns {string} CSS colour.
     */
    function cssColor(name) {
      const token = TOKEN_COLORS[name]
      if (token !== undefined) return `var(${token})`
      return LITERAL_COLORS[name] ?? 'var(--dsw-alias-label-primary)'
    }

    /**
     * Resolve a palette name to a concrete colour for canvas drawing, where a
     * CSS variable does not apply.
     * @returns {string} concrete CSS colour.
     */
    function flatColor(name) {
      const token = TOKEN_COLORS[name]
      if (token !== undefined) {
        const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
        if (value !== '') return value
      }
      return LITERAL_COLORS[name] ?? '#1f2328'
    }

    // ── copy ──────────────────────────────────────────────────────────────────
    const DICT = {
      zh: {
        title: '看板',
        guide: '画、写、批注，和 AI 一起在画布上讨论',
        open: '打开看板',
        close: '关闭',
        loading: '正在加载看板…',
        loadFailed: '看板加载失败',
        retry: '重试',
        empty: '空白看板',
        emptyHint: '画点什么，或者写一张卡片。选中的元素可以直接发给 AI。',
        tools: '工具',
        toolSelect: '选择（V）',
        toolPan: '平移（H）',
        toolPen: '画笔（P）',
        toolRect: '矩形（R）',
        toolEllipse: '椭圆（O）',
        toolArrow: '箭头（A）',
        toolLine: '直线（L）',
        toolText: '文字（T）',
        toolNote: '便签（N）',
        toolCard: 'Markdown 卡片（M）',
        toolPin: '批注钉（K）',
        toolEraser: '橡皮擦（E）',
        askTitle: 'AI 在看板这边等你',
        askReply: '回答并继续',
        askAnswerHint: '改完看板后，在下方卡片回答',
        askDetailToggle: '看要求',
        undo: '撤销（Ctrl+Z）',
        redo: '重做（Ctrl+Shift+Z）',
        modeHint: '{tool} · Esc 退出',
        erasedCount: '擦掉 {n} 个元素',
        color: '颜色',
        zoomIn: '放大',
        zoomOut: '缩小',
        zoomFit: '适应内容',
        more: '更多',
        exportPng: '导出 PNG',
        exportMarkdown: '导出 Markdown',
        clear: '清空看板',
        clearConfirm: '清空整块看板？这个操作不能撤销。',
        help: '看板里画的东西和批注都留在这个会话里。选中元素后点「发送给 AI」，它就能看到；它也能自己写回看板。',
        send: '发送给 AI',
        sending: '发送中…',
        sent: '已发送给 AI',
        sendFailed: '发送失败',
        selected: '已选',
        elements: '个元素',
        nothingSelected: '未选中元素',
        thread: '批注',
        noComments: '还没有批注',
        commentPlaceholder: '写下你的批注…',
        addComment: '添加批注',
        delete: '删除',
        group: '组合',
        ungroup: '取消组合',
        alignLeft: '左对齐',
        alignCenterX: '水平居中',
        alignRight: '右对齐',
        alignTop: '顶对齐',
        alignCenterY: '垂直居中',
        alignBottom: '底对齐',
        edit: '编辑',
        authorUser: '我',
        authorAgent: 'AI',
        noSession: '还没有会话',
        sendIntro: '我在看板上标记了这些内容：',
        sendOutro: '请根据这些标记回复我。如果要在看板上回答，用 board_write 工具。',
        sendWhole: '（整块看板，共 {n} 个元素）',
        sendSelected: '（已选中 {n} 个元素）',
        moreOnBoard: '（看板还有 {n} 个元素，需要时用 board_read 查看。）',
        commentLine: '批注 {who}：{text}',
        confirmDelete: '删除选中的 {n} 个元素？',
        pasteFailed: '粘贴图片失败',
        cardPlaceholder: '# 标题\n\n- 要点\n\n| 列 | 列 |\n| --- | --- |\n| 值 | 值 |',
        notePlaceholder: '便签',
        textPlaceholder: '文字',
        exportEmpty: '看板是空的，没有可导出的内容',
        exported: '已导出',
      },
      en: {
        title: 'Board',
        guide: 'Draw, write and annotate on a canvas you share with the agent',
        open: 'Open board',
        close: 'Close',
        loading: 'Loading board…',
        loadFailed: 'The board could not be loaded',
        retry: 'Retry',
        empty: 'Empty board',
        emptyHint: 'Draw something, or write a card. Selected elements can go straight to the agent.',
        tools: 'Tools',
        toolSelect: 'Select (V)',
        toolPan: 'Pan (H)',
        toolPen: 'Pen (P)',
        toolRect: 'Rectangle (R)',
        toolEllipse: 'Ellipse (O)',
        toolArrow: 'Arrow (A)',
        toolLine: 'Line (L)',
        toolText: 'Text (T)',
        toolNote: 'Sticky note (N)',
        toolCard: 'Markdown card (M)',
        toolPin: 'Annotation pin (K)',
        toolEraser: 'Eraser (E)',
        askTitle: 'The agent is waiting on this board',
        askReply: 'Reply and continue',
        askAnswerHint: 'edit the board, then answer in the card below',
        askDetailToggle: 'What it wants',
        undo: 'Undo (Ctrl+Z)',
        redo: 'Redo (Ctrl+Shift+Z)',
        modeHint: '{tool} · Esc to exit',
        erasedCount: 'Erased {n} elements',
        color: 'Colour',
        zoomIn: 'Zoom in',
        zoomOut: 'Zoom out',
        zoomFit: 'Fit content',
        more: 'More',
        exportPng: 'Export PNG',
        exportMarkdown: 'Export Markdown',
        clear: 'Clear board',
        clearConfirm: 'Clear the whole board? This cannot be undone.',
        help: 'What you draw and annotate here stays with this conversation. Select elements and press "Send to agent"; the agent can write back too.',
        send: 'Send to agent',
        sending: 'Sending…',
        sent: 'Sent to the agent',
        sendFailed: 'Send failed',
        selected: 'Selected',
        elements: 'elements',
        nothingSelected: 'No element selected',
        thread: 'Thread',
        noComments: 'No comments yet',
        commentPlaceholder: 'Write a comment…',
        addComment: 'Add comment',
        delete: 'Delete',
        group: 'Group',
        ungroup: 'Ungroup',
        alignLeft: 'Align left',
        alignCenterX: 'Centre horizontally',
        alignRight: 'Align right',
        alignTop: 'Align top',
        alignCenterY: 'Centre vertically',
        alignBottom: 'Align bottom',
        edit: 'Edit',
        authorUser: 'me',
        authorAgent: 'agent',
        noSession: 'No session yet',
        sendIntro: 'I marked these on the board:',
        sendOutro: 'Reply to this. If the answer belongs on the board, use the board_write tool.',
        sendWhole: '(the whole board, {n} elements)',
        sendSelected: '({n} selected elements)',
        moreOnBoard: '({n} more elements on the board; use board_read when you need them.)',
        commentLine: 'Comment {who}: {text}',
        confirmDelete: 'Delete {n} selected elements?',
        pasteFailed: 'Could not paste the image',
        cardPlaceholder: '# Title\n\n- Point\n\n| A | B |\n| --- | --- |\n| 1 | 2 |',
        notePlaceholder: 'Note',
        textPlaceholder: 'Text',
        exportEmpty: 'The board is empty',
        exported: 'Exported',
      },
    }

    // ── geometry ──────────────────────────────────────────────────────────────
    /** @param {object} el - element. @returns {number[]} `[x, y, w, h]`. */
    function boxOf(el) {
      if (Array.isArray(el.box) && el.box.length === 4) return el.box
      if (el.type === 'arrow' || el.type === 'line') {
        const x2 = el.x2 ?? el.x
        const y2 = el.y2 ?? el.y
        return [Math.min(el.x, x2), Math.min(el.y, y2), Math.abs(x2 - el.x), Math.abs(y2 - el.y)]
      }
      if (el.type === 'stroke') {
        const points = el.points ?? []
        if (points.length === 0) return [el.x, el.y, 0, 0]
        const xs = points.map(([px]) => px)
        const ys = points.map(([, py]) => py)
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
      }
      return [el.x, el.y, el.w, el.h]
    }

    /** @param {object} a - rect. @param {object} b - rect. @returns {boolean} overlap. */
    function overlaps(a, b) {
      return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
    }

    /** @param {object} p - point. @param {number[]} a - segment start. @param {number[]} b - segment end. @returns {number} distance. */
    function distToSegment(p, a, b) {
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const lengthSquared = dx * dx + dy * dy
      if (lengthSquared === 0) return Math.hypot(p.x - a[0], p.y - a[1])
      let t = ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / lengthSquared
      t = Math.max(0, Math.min(1, t))
      return Math.hypot(p.x - (a[0] + t * dx), p.y - (a[1] + t * dy))
    }

    /**
     * Whether an eraser trail segment touches one element.
     *
     * Follows Excalidraw's split: freehand strokes are hit by distance to their
     * points, lines and arrows by distance to the segment, everything else by
     * its bounding box. The tolerance grows as the view zooms out so the eraser
     * feels the same size on screen at any scale.
     * @param {{x: number, y: number}} from - segment start, world coordinates.
     * @param {{x: number, y: number}} to - segment end.
     * @param {number} scale - current zoom.
     * @returns {boolean} whether the trail touches the element.
     */
    function eraserHits(from, to, element, scale) {
      const tolerance = Math.max(6, 10 / Math.max(0.2, scale))
      if (element.type === 'arrow' || element.type === 'line') {
        const x2 = element.x2 ?? element.x
        const y2 = element.y2 ?? element.y
        return distToSegment({ x: from.x, y: from.y }, [element.x, element.y], [x2, y2]) <= tolerance
          || distToSegment({ x: to.x, y: to.y }, [element.x, element.y], [x2, y2]) <= tolerance
      }
      if (element.type === 'stroke') {
        const points = element.points ?? []
        for (let index = 1; index < points.length; index += 1) {
          if (distToSegment(from, points[index - 1], points[index]) <= tolerance) return true
          if (distToSegment(to, points[index - 1], points[index]) <= tolerance) return true
        }
        // A single-point trail still erases what it sits on.
        return points.some(([px, py]) => Math.hypot(px - from.x, py - from.y) <= tolerance)
      }
      const box = boxOf(element)
      return overlaps(
        { x0: Math.min(from.x, to.x) - tolerance, y0: Math.min(from.y, to.y) - tolerance, x1: Math.max(from.x, to.x) + tolerance, y1: Math.max(from.y, to.y) + tolerance },
        { x0: box[0], y0: box[1], x1: box[0] + box[2], y1: box[1] + box[3] },
      )
    }

    /**
     * Bounding box of a set of elements.    /**
     * Bounding box of a set of elements.
     * @param {object[]} elements - elements.
     * @returns {{x0: number, y0: number, x1: number, y1: number}} content bounds.
     */
    function contentBounds(elements) {
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const element of elements) {
        const box = boxOf(element)
        x0 = Math.min(x0, box[0])
        y0 = Math.min(y0, box[1])
        x1 = Math.max(x1, box[0] + box[2])
        y1 = Math.max(y1, box[1] + box[3])
      }
      if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 800, y1: 600 }
      return { x0, y0, x1, y1 }
    }

    // ── markdown ──────────────────────────────────────────────────────────────
    /**
     * Render inline markdown spans: code, bold, italic, strike and links.
     * @param {string} text - source text.
     * @param {string} keyPrefix - React key prefix.
     * @returns {Array} React children.
     */
    function inline(text, keyPrefix) {
      const out = []
      const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(~~[^~]+~~)|(\[[^\]]+\]\([^)]+\))/u
      let rest = text
      let index = 0
      while (rest.length > 0) {
        const match = pattern.exec(rest)
        if (match === null) {
          out.push(rest)
          break
        }
        if (match.index > 0) out.push(rest.slice(0, match.index))
        const token = match[0]
        const key = `${keyPrefix}-${index}`
        index += 1
        if (token.startsWith('`')) out.push(h('code', { key, className: 'dsb-md-code' }, token.slice(1, -1)))
        else if (token.startsWith('**')) out.push(h('strong', { key }, token.slice(2, -2)))
        else if (token.startsWith('~~')) out.push(h('del', { key }, token.slice(2, -2)))
        else if (token.startsWith('[')) {
          const label = token.slice(1, token.indexOf(']'))
          const href = token.slice(token.indexOf('](') + 2, -1)
          out.push(h('a', { key, href, target: '_blank', rel: 'noreferrer' }, label))
        } else out.push(h('em', { key }, token.slice(1, -1)))
        rest = rest.slice(match.index + token.length)
      }
      return out
    }

    /**
     * Parse one markdown document into React blocks.
     *
     * Covers what a board card needs: headings, lists, tables, fenced code,
     * quotes, rules and paragraphs. Output is React elements, never HTML, so a
     * card cannot inject markup.
     * @param {string} source - markdown text.
     * @returns {Array} React children.
     */
    function renderMarkdown(source) {
      const lines = String(source ?? '').replace(/\r\n/gu, '\n').split('\n')
      const blocks = []
      let i = 0
      let key = 0
      const nextKey = () => {
        key += 1
        return `md-${key}`
      }
      while (i < lines.length) {
        const line = lines[i]
        if (line.trim() === '') {
          i += 1
          continue
        }
        const fence = /^\s*```(\w*)\s*$/u.exec(line)
        if (fence !== null) {
          const body = []
          i += 1
          while (i < lines.length && !/^\s*```\s*$/u.test(lines[i])) {
            body.push(lines[i])
            i += 1
          }
          i += 1
          blocks.push(h('pre', { key: nextKey(), className: 'dsb-md-pre' }, h('code', null, body.join('\n'))))
          continue
        }
        const heading = /^(#{1,6})\s+(.*)$/u.exec(line)
        if (heading !== null) {
          blocks.push(h(`h${heading[1].length}`, { key: nextKey(), className: 'dsb-md-h' }, inline(heading[2], nextKey())))
          i += 1
          continue
        }
        if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) {
          blocks.push(h('hr', { key: nextKey(), className: 'dsb-md-hr' }))
          i += 1
          continue
        }
        if (/^\s*>/u.test(line)) {
          const body = []
          while (i < lines.length && /^\s*>/u.test(lines[i])) {
            body.push(lines[i].replace(/^\s*>\s?/u, ''))
            i += 1
          }
          blocks.push(h('blockquote', { key: nextKey(), className: 'dsb-md-quote' }, inline(body.join(' '), nextKey())))
          continue
        }
        if (/^\s*\|/u.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/u.test(lines[i + 1])) {
          const split = (row) => row.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|').map((cell) => cell.trim())
          const head = split(line)
          i += 2
          const rows = []
          while (i < lines.length && /^\s*\|/u.test(lines[i])) {
            rows.push(split(lines[i]))
            i += 1
          }
          blocks.push(h('div', { key: nextKey(), className: 'dsb-md-tablewrap' },
            h('table', { className: 'dsb-md-table' },
              h('thead', null, h('tr', null, head.map((cell, column) => h('th', { key: `h-${column}` }, inline(cell, nextKey()))))),
              h('tbody', null, rows.map((row, rowIndex) => h('tr', { key: `r-${rowIndex}` }, row.map((cell, column) => h('td', { key: `c-${column}` }, inline(cell, nextKey())))))))))
          continue
        }
        const bullet = /^\s*[-*+]\s+(.*)$/u.exec(line)
        const ordered = /^\s*(\d+)[.)]\s+(.*)$/u.exec(line)
        if (bullet !== null || ordered !== null) {
          const isOrdered = ordered !== null
          const items = []
          while (i < lines.length) {
            const current = lines[i]
            const match = isOrdered ? /^\s*(\d+)[.)]\s+(.*)$/u.exec(current) : /^\s*[-*+]\s+(.*)$/u.exec(current)
            if (match === null) break
            items.push(isOrdered ? match[2] : match[1])
            i += 1
          }
          const children = items.map((item, index) => h('li', { key: `li-${index}` }, inline(item, nextKey())))
          blocks.push(h(isOrdered ? 'ol' : 'ul', { key: nextKey(), className: 'dsb-md-list' }, children))
          continue
        }
        const paragraph = []
        while (i < lines.length && lines[i].trim() !== '' && !/^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```)/u.test(lines[i])) {
          paragraph.push(lines[i])
          i += 1
        }
        if (paragraph.length === 0) {
          paragraph.push(lines[i])
          i += 1
        }
        blocks.push(h('p', { key: nextKey(), className: 'dsb-md-p' }, inline(paragraph.join(' '), nextKey())))
      }
      return blocks
    }

    // ── snapshot rendering (PNG export and the image sent to the agent) ───────
    /**
     * Strip markdown markers for the plain-text projection a snapshot draws.
     * @param {string} source - markdown.
     * @returns {string[]} plain lines.
     */
    function markdownLines(source) {
      return String(source ?? '')
        .replace(/\r\n/gu, '\n')
        .split('\n')
        .map((line) => line
          .replace(/^\s*```.*$/u, '')
          .replace(/^\s*#{1,6}\s+/u, '')
          .replace(/^\s*[-*+]\s+/u, '· ')
          .replace(/^\s*\d+[.)]\s+/u, '· ')
          .replace(/^\s*>\s?/u, '')
          .replace(/^\s*\|/u, '')
          .replace(/\|/gu, '  ')
          .replace(/`/gu, '')
          .replace(/\*\*|~~|__/gu, '')
          .replace(/^\s*-{3,}\s*$/u, '————'))
        .filter((line) => line.trim() !== '')
    }

    /**
     * Draw wrapped text and return the next baseline.
     * @param {CanvasRenderingContext2D} g - context.
     * @param {string} text - text.
     * @param {number} x - left.
     * @param {number} y - top.
     * @param {number} maxWidth - wrap width.
     * @param {number} lineHeight - line height.
     * @param {number} maxHeight - clip height.
     * @returns {number} the y after the last drawn line.
     */
    function wrapText(g, text, x, y, maxWidth, lineHeight, maxHeight) {
      const paragraphs = String(text).split('\n')
      let cursor = y
      for (const paragraph of paragraphs) {
        if (cursor - y > maxHeight) break
        let line = ''
        for (const word of paragraph.split(/(\s+)/u)) {
          const candidate = line + word
          if (g.measureText(candidate).width > maxWidth && line !== '') {
            g.fillText(line, x, cursor)
            cursor += lineHeight
            line = word.trimStart()
            if (cursor - y > maxHeight) break
          } else {
            line = candidate
          }
        }
        if (line !== '' && cursor - y <= maxHeight) {
          g.fillText(line, x, cursor)
          cursor += lineHeight
        }
      }
      return cursor
    }

    /**
     * Preload the images a snapshot needs.
     * @param {object[]} elements - elements.
     * @returns {Promise<Map<string, HTMLImageElement>>} loaded images by attachment id.
     */
    async function loadImages(elements) {
      const ids = [...new Set(elements.filter((element) => element.type === 'image').map((element) => element.attachmentId))]
      const loaded = new Map()
      await Promise.all(ids.map((id) => new Promise((resolve) => {
        const image = new Image()
        image.onload = () => {
          loaded.set(id, image)
          resolve()
        }
        image.onerror = () => resolve()
        image.src = imageUrl(id)
      })))
      return loaded
    }

    /**
     * Draw one element onto a 2D context.
     * @param {CanvasRenderingContext2D} g - context.
     * @param {object} element - element.
     * @param {Map<string, HTMLImageElement>} images - preloaded images.
     */
    function drawElement(g, element, images) {
      const color = flatColor(element.color)
      const size = element.size ?? 15
      g.save()
      g.strokeStyle = color
      g.fillStyle = color
      g.lineWidth = Math.max(1.5, size / 8)
      g.lineCap = 'round'
      g.lineJoin = 'round'
      if (element.type === 'stroke') {
        const points = element.points ?? []
        if (points.length > 1) {
          g.beginPath()
          g.moveTo(points[0][0], points[0][1])
          for (let index = 1; index < points.length; index += 1) g.lineTo(points[index][0], points[index][1])
          g.stroke()
        }
      } else if (element.type === 'rect' || element.type === 'ellipse') {
        g.beginPath()
        if (element.type === 'rect') g.rect(element.x, element.y, element.w, element.h)
        else g.ellipse(element.x + element.w / 2, element.y + element.h / 2, Math.abs(element.w / 2), Math.abs(element.h / 2), 0, 0, Math.PI * 2)
        g.stroke()
      } else if (element.type === 'arrow' || element.type === 'line') {
        const x2 = element.x2 ?? element.x
        const y2 = element.y2 ?? element.y
        g.beginPath()
        g.moveTo(element.x, element.y)
        g.lineTo(x2, y2)
        g.stroke()
        if (element.type === 'arrow') {
          const angle = Math.atan2(y2 - element.y, x2 - element.x)
          const head = Math.max(8, size * 0.9)
          g.beginPath()
          g.moveTo(x2, y2)
          g.lineTo(x2 - head * Math.cos(angle - 0.4), y2 - head * Math.sin(angle - 0.4))
          g.lineTo(x2 - head * Math.cos(angle + 0.4), y2 - head * Math.sin(angle + 0.4))
          g.closePath()
          g.fill()
        }
      } else if (element.type === 'image') {
        const image = images.get(element.attachmentId)
        if (image !== undefined) g.drawImage(image, element.x, element.y, element.w, element.h)
        else g.strokeRect(element.x, element.y, element.w, element.h)
      } else if (element.type === 'text' || element.type === 'note') {
        if (element.type === 'note') {
          g.fillStyle = LITERAL_COLORS[element.color] ?? '#f6e3a1'
          g.fillRect(element.x, element.y, element.w, element.h)
          g.strokeStyle = 'rgba(0,0,0,0.12)'
          g.lineWidth = 1
          g.strokeRect(element.x, element.y, element.w, element.h)
        }
        g.fillStyle = element.type === 'note' ? STICKY_TEXT : color
        g.font = `${size}px ui-sans-serif, system-ui, sans-serif`
        g.textBaseline = 'top'
        wrapText(g, element.text ?? '', element.x + 8, element.y + 8, element.w - 16, size * 1.45, element.h - 16)
      } else if (element.type === 'card') {
        g.fillStyle = flatColor('muted')
        g.globalAlpha = 0.07
        g.fillRect(element.x, element.y, element.w, element.h)
        g.globalAlpha = 1
        g.strokeStyle = flatColor('muted')
        g.lineWidth = 1
        g.strokeRect(element.x, element.y, element.w, element.h)
        let y = element.y + 12
        if (element.title) {
          g.fillStyle = color
          g.font = `600 ${Math.round(size * 1.1)}px ui-sans-serif, system-ui, sans-serif`
          g.textBaseline = 'top'
          y = wrapText(g, element.title, element.x + 12, y, element.w - 24, size * 1.5, element.h - 24) + 6
        }
        g.fillStyle = color
        g.font = `${size}px ui-sans-serif, system-ui, sans-serif`
        for (const line of markdownLines(element.markdown)) {
          if (y > element.y + element.h - size) break
          y = wrapText(g, line, element.x + 12, y, element.w - 24, size * 1.45, element.y + element.h - size) + 2
        }
      } else if (element.type === 'pin') {
        const count = (element.comments ?? []).length
        g.fillStyle = flatColor('accent')
        g.beginPath()
        g.arc(element.x + 14, element.y + 14, 12, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = '#ffffff'
        g.font = '600 12px ui-sans-serif, system-ui, sans-serif'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(String(count), element.x + 14, element.y + 14)
      }
      g.restore()
    }

    /**
     * Render a set of elements to a canvas.
     * @param {object[]} elements - elements to draw.
     * @param {object} rect - world rect `{x0,y0,x1,y1}`.
     * @param {object} options - `width`, `background`.
     * @returns {Promise<HTMLCanvasElement>} the rendered canvas.
     */
    async function snapshot(elements, rect, options = {}) {
      const width = options.width ?? 1200
      const worldWidth = Math.max(1, rect.x1 - rect.x0)
      const worldHeight = Math.max(1, rect.y1 - rect.y0)
      const scale = width / worldWidth
      const height = Math.max(80, Math.round(worldHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(width)
      canvas.height = height
      const g = canvas.getContext('2d')
      g.fillStyle = options.background ?? '#ffffff'
      g.fillRect(0, 0, canvas.width, canvas.height)
      g.save()
      g.scale(scale, scale)
      g.translate(-rect.x0, -rect.y0)
      const images = await loadImages(elements)
      for (const element of elements) drawElement(g, element, images)
      g.restore()
      return canvas
    }

    /** @param {string} id - image attachment id. @returns {string} same-origin URL. */
    function imageUrl(id) {
      return `${API}/image?id=${encodeURIComponent(id)}`
    }

    // ── network ───────────────────────────────────────────────────────────────
    /**
     * Read one board.
     * @param {string} sessionId - board identity.
     * @returns {Promise<object>} `{ rev, updatedAt, elements }`.
     */
    async function fetchState(sessionId) {
      const response = await fetch(`${API}/state?sessionId=${encodeURIComponent(sessionId)}`, { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`board state: HTTP ${response.status}`)
      return response.json()
    }

    /**
     * Apply one batch of operations.
     * @param {string} sessionId - board identity.
     * @param {object[]} ops - operations.
     * @param {number} baseRev - revision the caller saw.
     * @returns {Promise<object>} the new state, `{ conflict: true }`, or `{ error }`.
     */
    async function postOps(sessionId, ops, baseRev) {
      const response = await fetch(`${API}/op`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, ops, baseRev }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok && body.error === undefined) throw new Error(`board op: HTTP ${response.status}`)
      return body
    }

    /**
     * Read whether the agent is blocked on this board.
     * @param {string} sessionId - board identity.
     * @returns {Promise<object>} `{ waiting }` plus the prompt when it is.
     */
    async function fetchAsk(sessionId) {
      const response = await fetch(`${API}/ask?sessionId=${encodeURIComponent(sessionId)}`, { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) return { waiting: false }
      return response.json()
    }

    /**
     * Upload one pasted image.
     * @param {string} data - base64 payload.
     * @param {string} mediaType - image media type.
     * @returns {Promise<string>} the attachment id.
     */
    async function uploadImage(data, mediaType) {
      const response = await fetch(`${API}/image`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data, mediaType }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? `board image: HTTP ${response.status}`)
      return body.id
    }

    // ── icons ─────────────────────────────────────────────────────────────────
    const PATHS = {
      select: 'M6 3l12 7-5.2 1.4L10 19z',
      pan: 'M12 3v8M12 21v-8M3 12h8M21 12h-8M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
      pen: 'M4 20l1.5-4.5L15 6l3 3-9.5 9.5z',
      eraser: 'M8 20H4l-1-3L14 6l5 5-9 9zM9 11l5 5',
      undo: 'M9 7L4 12l5 5M4 12h9a5 5 0 010 10h-2',
      redo: 'M15 7l5 5-5 5M20 12h-9a5 5 0 000 10h2',
      rect: 'M4 6h16v12H4z',
      ellipse: 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z',
      arrow: 'M5 19L19 5M19 5h-6M19 5v6',
      line: 'M5 19L19 5',
      text: 'M6 6h12M12 6v12',
      note: 'M5 4h14v10l-4 6H5zM15 20v-6h4',
      card: 'M4 5h16v14H4zM4 9.5h16',
      pin: 'M12 3a4 4 0 014 4c0 3.2-4 9-4 9S8 10.2 8 7a4 4 0 014-4zM12 7.2v.1',
      plus: 'M12 5v14M5 12h14',
      minus: 'M5 12h14',
      fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
      more: 'M6 12h.01M12 12h.01M18 12h.01',
      trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
      send: 'M4 12l16-8-6 16-3-6z',
      comment: 'M4 5h16v11H9l-5 4z',
      download: 'M12 4v11M8 11l4 4 4-4M5 20h14',
      help: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9.5a2.5 2.5 0 115 0c0 1.5-2.5 2-2.5 3.5M12 17h.01',
      group: 'M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5M9 9h6v6H9z',
      close: 'M6 6l12 12M18 6L6 18',
      board: 'M3 4h18v14H3zM3 18l5-6 4 4 3-3 6 5M15.5 8.5h.01',
    }

    /**
     * One line icon.
     * @param {object} props - `name`, `size`.
     * @returns {object} SVG element.
     */
    function Icon({ name, size = 16 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        className: 'dsb-icon',
      }, h('path', { d: PATHS[name] ?? PATHS.board }))
    }

    /**
     * A toolbar button.
     * @param {object} props - `title`, `active`, `onClick`, `name`, `disabled`.
     * @returns {object} button element.
     */
    function ToolButton({ title, active, onClick, name, disabled }) {
      return h('button', {
        type: 'button',
        className: `dsb-btn${active === true ? ' dsb-btn-active' : ''}`,
        title,
        'aria-label': title,
        'aria-pressed': active === true,
        disabled: disabled === true,
        onClick,
        onPointerDown: (event) => event.stopPropagation(),
      }, h(Icon, { name }))
    }

    // ── styles ────────────────────────────────────────────────────────────────
    const CSS = `
.dsb-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden;container-type:inline-size}
@container (max-width: 420px){.dsb-send-label{display:none}.dsb-zoom{min-width:30px}}
.dsb-bar{display:flex;align-items:center;gap:3px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);flex:0 0 auto;min-width:0}
.dsb-tools{display:flex;align-items:center;gap:3px;flex:1 1 auto;min-width:0;overflow-x:auto;scrollbar-width:none}
.dsb-tools::-webkit-scrollbar{display:none}
.dsb-actions{display:flex;align-items:center;gap:3px;flex:0 0 auto;padding-left:4px;border-left:1px solid var(--dsw-alias-border-l1);margin-left:4px}
.dsb-sep{width:1px;height:18px;background:var(--dsw-alias-border-l1);margin:0 3px;flex:0 0 auto}
.dsb-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-width:26px;height:26px;padding:0 5px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;line-height:1;flex:0 0 auto}
.dsb-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsb-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsb-btn[disabled]{opacity:.45;cursor:default}
.dsb-btn-active{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-border-l2)}
.dsb-icon{display:block;flex:0 0 auto}
.dsb-swatches{display:flex;align-items:center;gap:3px;flex:0 0 auto}
.dsb-swatch{width:15px;height:15px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);cursor:pointer;padding:0;flex:0 0 auto}
.dsb-swatch-on{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1),0 0 0 3px var(--dsw-alias-brand-primary)}
.dsb-zoom{font-size:11px;color:var(--dsw-alias-label-secondary);min-width:36px;text-align:center;font-variant-numeric:tabular-nums;flex:0 0 auto}
.dsb-stage{position:relative;flex:1 1 auto;min-height:0;overflow:hidden;touch-action:none;cursor:default;background-image:radial-gradient(var(--dsw-alias-border-l1) 1px,transparent 1px);background-size:22px 22px;outline:none}
.dsb-stage-tool-pen,.dsb-stage-tool-rect,.dsb-stage-tool-ellipse,.dsb-stage-tool-arrow,.dsb-stage-tool-line,.dsb-stage-tool-text,.dsb-stage-tool-note,.dsb-stage-tool-card,.dsb-stage-tool-pin{cursor:crosshair}
.dsb-stage-tool-pan{cursor:grab}
.dsb-stage-panning{cursor:grabbing}
.dsb-world{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0}
.dsb-layer{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible}
.dsb-el{position:absolute;box-sizing:border-box}
.dsb-el-text{white-space:pre-wrap;word-break:break-word;overflow:hidden;line-height:1.35;padding:2px 4px}
.dsb-el-note{border-radius:8px;padding:8px;white-space:pre-wrap;word-break:break-word;overflow:hidden;color:#2b2b2b;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.dsb-el-card{border-radius:10px;padding:10px 12px;overflow:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 1px 2px rgba(0,0,0,.05);scrollbar-width:thin}
.dsb-el-card-title{font-weight:600;margin-bottom:4px}
.dsb-el-image{border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.dsb-el-image img{width:100%;height:100%;object-fit:cover;display:block}
.dsb-pin-body{position:absolute;inset:0;border-radius:50%;background:var(--dsw-alias-brand-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;box-shadow:0 2px 6px rgba(0,0,0,.25)}
.dsb-el-sel{outline:1.5px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsb-el-flash{animation:dsb-flash 1.4s ease-out}
@keyframes dsb-flash{0%{box-shadow:0 0 0 3px var(--dsw-alias-brand-primary)}100%{box-shadow:0 0 0 0 transparent}}
.dsb-handle{position:absolute;width:9px;height:9px;margin:-5px 0 0 -5px;border-radius:2px;background:var(--dsw-alias-bg-base);border:1.5px solid var(--dsw-alias-brand-primary)}
.dsb-marquee{position:absolute;border:1px dashed var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);pointer-events:none}
.dsb-editor{position:absolute;box-sizing:border-box;border:1.5px solid var(--dsw-alias-brand-primary);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:6px;resize:none;outline:none;box-shadow:0 4px 16px rgba(0,0,0,.15);z-index:4}
.dsb-hint{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;max-width:78%;color:var(--dsw-alias-label-secondary);pointer-events:none;line-height:1.6}
.dsb-hint-title{font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:4px;font-size:14px}
.dsb-sheet{position:absolute;left:0;right:0;bottom:0;max-height:56%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l1);box-shadow:0 -8px 24px rgba(0,0,0,.10);border-radius:12px 12px 0 0;z-index:6}
.dsb-sheet-head{display:flex;align-items:center;gap:4px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.dsb-sheet-title{font-weight:600;font-size:12px;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsb-sheet-body{overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:8px;min-height:0}
.dsb-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsb-muted{color:var(--dsw-alias-label-secondary);font-size:11px}
.dsb-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-size:10.5px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dsb-thread{display:flex;flex-direction:column;gap:6px}
.dsb-comment{display:flex;flex-direction:column;gap:1px;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsb-comment-agent{border-left:2px solid var(--dsw-alias-brand-primary)}
.dsb-comment-who{font-size:10px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.dsb-comment-text{white-space:pre-wrap;word-break:break-word;font-size:12px}
.dsb-input{width:100%;box-sizing:border-box;min-height:52px;max-height:120px;resize:vertical;padding:6px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;outline:none}
.dsb-input:focus{border-color:var(--dsw-alias-brand-primary)}
.dsb-primary{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border-radius:6px;border:1px solid transparent;background:var(--dsw-alias-brand-primary);color:#fff;font:inherit;font-weight:600;cursor:pointer;flex:0 0 auto}
.dsb-primary[disabled]{opacity:.5;cursor:default}
.dsb-ghost{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 7px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;flex:0 0 auto}
.dsb-ghost:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsb-ghost[disabled]{opacity:.45;cursor:default}
.dsb-danger{color:var(--dsw-alias-state-error-primary)}
.dsb-ask{position:relative;z-index:7;flex:0 0 auto;display:flex;align-items:center;gap:6px;margin:0;padding:5px 11px;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-brand-primary);box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary)}
.dsb-ask-head{display:flex;align-items:center;gap:6px}
.dsb-ask-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary);flex:0 0 auto}
.dsb-ask-title{font-weight:600;font-size:12px;color:var(--dsw-alias-brand-primary)}
.dsb-ask-prompt{font-size:13px;line-height:1.45}
.dsb-ask-detail{font-size:12px;color:var(--dsw-alias-label-secondary);max-height:160px;overflow:auto}
.dsb-ask-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.dsb-ask-hint{font-size:11px;color:var(--dsw-alias-label-secondary);margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsb-mode{position:absolute;left:8px;top:8px;z-index:5;display:flex;align-items:center;gap:6px;padding:3px 8px;border-radius:999px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 2px 8px rgba(0,0,0,.08);pointer-events:none;font-size:11px}
.dsb-mode-name{font-weight:600;color:var(--dsw-alias-brand-primary)}
.dsb-mode-hint{color:var(--dsw-alias-label-secondary)}
.dsb-mode-eraser .dsb-mode-name{color:var(--dsw-alias-state-warn-primary)}
.dsb-status{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);padding:4px 10px;border-radius:999px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-size:11px;box-shadow:0 4px 14px rgba(0,0,0,.12);z-index:8;pointer-events:none;max-width:90%}
.dsb-menu{position:absolute;right:8px;top:38px;z-index:9;min-width:180px;padding:4px;border-radius:10px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 10px 30px rgba(0,0,0,.18);display:flex;flex-direction:column;gap:1px}
.dsb-menu-item{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.dsb-menu-item:hover{background:var(--dsw-alias-bg-layer-2)}
.dsb-md-p,.dsb-md-list,.dsb-md-pre,.dsb-md-quote,.dsb-md-tablewrap{margin:0 0 6px}
.dsb-md-p:last-child,.dsb-md-list:last-child{margin-bottom:0}
.dsb-md-h{margin:2px 0 4px;font-weight:600;line-height:1.3}
h1.dsb-md-h{font-size:1.45em}
h2.dsb-md-h{font-size:1.28em}
h3.dsb-md-h{font-size:1.14em}
h4.dsb-md-h,h5.dsb-md-h,h6.dsb-md-h{font-size:1em}
.dsb-md-list{padding-left:18px}
.dsb-md-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;padding:1px 4px;border-radius:4px;background:var(--dsw-alias-bg-layer-2)}
.dsb-md-pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.45;padding:7px 9px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);overflow:auto;white-space:pre-wrap;word-break:break-word}
.dsb-md-quote{margin-left:0;padding-left:8px;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.dsb-md-hr{border:0;border-top:1px solid var(--dsw-alias-border-l1);margin:6px 0}
.dsb-md-tablewrap{overflow:auto}
.dsb-md-table{border-collapse:collapse;font-size:11.5px;width:100%}
.dsb-md-table th,.dsb-md-table td{border:1px solid var(--dsw-alias-border-l1);padding:3px 6px;text-align:left;vertical-align:top}
.dsb-md-table th{background:var(--dsw-alias-bg-layer-2);font-weight:600}
.dsb-md-p a{color:var(--dsw-alias-brand-primary)}
`

    // ── history ───────────────────────────────────────────────────────────────
    /** How many steps each direction keeps. A whole-board snapshot is cheap at the element cap. */
    const HISTORY_LIMIT = 60

    /**
     * Create one undo/redo stack pair over whole-board element snapshots.
     *
     * The unit of history is a *gesture*, not a mutation: a drag, a stroke, an
     * eraser pass or one committed edit is one step, because that is what a
     * person expects "undo" to reverse. Callers bracket a gesture with
     * `begin()`/`end()`; `record()` pushes the state that was in force before it.
     * @returns {object} the stack pair.
     */
    function createHistory() {
      const undo = []
      const redo = []
      return {
        /** Push the pre-gesture elements and drop the redo branch. */
        record(elements) {
          undo.push(elements)
          if (undo.length > HISTORY_LIMIT) undo.shift()
          redo.length = 0
        },
        /** @returns {object[]|undefined} the elements to restore, or undefined when nothing to undo. */
        undo(elements) {
          if (undo.length === 0) return undefined
          const previous = undo.pop()
          redo.push(elements)
          if (redo.length > HISTORY_LIMIT) redo.shift()
          return previous
        },
        /** @returns {object[]|undefined} the elements to restore, or undefined when nothing to redo. */
        redo(elements) {
          if (redo.length === 0) return undefined
          const next = redo.pop()
          undo.push(elements)
          if (undo.length > HISTORY_LIMIT) undo.shift()
          return next
        },
        /** @returns {{undo: number, redo: number}} stack depths, for button state. */
        depth() {
          return { undo: undo.length, redo: redo.length }
        },
      }
    }

    // ── board ─────────────────────────────────────────────────────────────────
    const EMPTY = { rev: 0, elements: [] }

    /**
     * The board tab body.
     * @param {object} props - standard tab props plus `useTabInfo` and `t`.
     * @returns {object} the board.
     */
    function BoardTab(props) {
      const { sessionId, useTabInfo } = props
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const { tab } = useTabInfo()

      const [doc, setDoc] = useState(EMPTY)
      const [phase, setPhase] = useState('loading')
      const [error, setError] = useState(null)
      const [reloadKey, setReloadKey] = useState(0)
      const [view, setView] = useState({ x: 32, y: 32, scale: 1 })
      const [tool, setTool] = useState('select')
      const [color, setColor] = useState('ink')
      const [selection, setSelection] = useState([])
      const [draft, setDraft] = useState(null)
      const [move, setMove] = useState(null)
      const [resize, setResize] = useState(null)
      const [marquee, setMarquee] = useState(null)
      const [eraser, setEraser] = useState(null)
      const [editing, setEditing] = useState(null)
      const [flash, setFlash] = useState([])
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState(false)
      const [menu, setMenu] = useState(false)
      const [commentDraft, setCommentDraft] = useState('')
      const [showHelp, setShowHelp] = useState(false)
      const [ask, setAsk] = useState(null)

      const stageRef = useRef(null)
      const docRef = useRef(doc)
      const viewRef = useRef(view)
      const toolRef = useRef(tool)
      const colorRef = useRef(color)
      const selectionRef = useRef(selection)
      const editingRef = useRef(editing)
      const dragRef = useRef(null)
      const historyRef = useRef(null)
      if (historyRef.current === null) historyRef.current = createHistory()
      // A gesture in flight forbids undo: reversing a half-drawn stroke or a
      // drag in progress would leave the pointer and the document disagreeing.
      const gestureRef = useRef(null)
      const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 })
      const spaceRef = useRef(false)
      const flashTimer = useRef(null)
      const statusTimer = useRef(null)

      docRef.current = doc
      viewRef.current = view
      toolRef.current = tool
      colorRef.current = color
      selectionRef.current = selection
      editingRef.current = editing

      const say = useCallback((message) => {
        setStatus(message)
        if (statusTimer.current !== null) clearTimeout(statusTimer.current)
        statusTimer.current = setTimeout(() => setStatus(null), 2800)
      }, [])

      const flashIds = useCallback((ids) => {
        if (ids.length === 0) return
        setFlash(ids)
        if (flashTimer.current !== null) clearTimeout(flashTimer.current)
        flashTimer.current = setTimeout(() => setFlash([]), 1500)
      }, [])

      /**
       * Replace local state from a server payload and flash whatever the agent
       * just touched.
       * @param {object} payload - `{ rev, elements }`.
       */
      const adopt = useCallback((payload) => {
        const elements = Array.isArray(payload.elements) ? payload.elements : []
        const previous = new Map(docRef.current.elements.map((element) => [element.id, element]))
        const changed = elements
          .filter((element) => {
            if (element.author !== 'agent') return false
            const before = previous.get(element.id)
            return before === undefined || before.at !== element.at
          })
          .map((element) => element.id)
        setDoc({ rev: payload.rev ?? 0, elements })
        flashIds(changed)
      }, [flashIds])

      useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '') {
          setPhase('empty-session')
          return undefined
        }
        let alive = true
        setPhase('loading')
        fetchState(sessionId)
          .then((payload) => {
            if (!alive) return
            setDoc({ rev: payload.rev ?? 0, elements: payload.elements ?? [] })
            setPhase('ready')
            setError(null)
          })
          .catch((cause) => {
            if (!alive) return
            setError(cause instanceof Error ? cause.message : String(cause))
            setPhase('error')
          })
        let source
        try {
          source = new EventSource(`${API}/events?sessionId=${encodeURIComponent(sessionId)}`)
          source.onmessage = (event) => {
            if (!alive) return
            let payload
            try {
              payload = JSON.parse(event.data)
            } catch {
              return
            }
            if (typeof payload?.rev !== 'number' || payload.rev === docRef.current.rev) return
            fetchState(sessionId).then((state) => {
              if (!alive) return
              adopt(state)
              setPhase('ready')
            }).catch(() => {})
          }
        } catch {
          source = undefined
        }
        return () => {
          alive = false
          if (source !== undefined) source.close()
        }
      }, [sessionId, adopt, reloadKey])

      // While the agent is blocked on this board, say so: the banner is what
      // turns a docked tab into a board the user knows they are being asked on.
      useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '') return undefined
        let alive = true
        let opened = false
        const raise = (state) => {
          if (state?.waiting !== true || opened) return
          // Bring the tab forward once per wait: the point of the wait is that
          // the user sees the board, not that a hidden tab is asking.
          opened = true
          try {
            services.current?.sidebarRight?.openTab(KIND)
            // Open the column but stay docked: the answer itself is submitted
            // from the composer card, and a fullscreen board would cover it.
            services.current?.layout?.openRightbar(true, false)
          } catch {
            // No Sidebar in this frame; the banner still appears once opened.
          }
        }
        const tick = () => {
          fetchAsk(sessionId)
            .then((next) => {
              if (!alive) return
              const state = next?.waiting === true ? next : null
              setAsk(state)
              raise(state)
            })
            .catch(() => {})
        }
        tick()
        const timer = setInterval(tick, 1500)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [sessionId, reloadKey])

      useEffect(() => () => {
        if (flashTimer.current !== null) clearTimeout(flashTimer.current)
        if (statusTimer.current !== null) clearTimeout(statusTimer.current)
      }, [])

      /**
       * Commit one batch of operations, retrying once on a revision conflict.
       * @param {object[]} ops - operations.
       * @returns {Promise<object|null>} the new payload, or `null` on failure.
       */
      const commit = useCallback(async (ops, options = {}) => {
        if (typeof sessionId !== 'string' || sessionId === '') return null
        // Record the pre-edit document so one gesture is one undo step. Undo and
        // redo themselves pass `history: false`, or they would feed the stack.
        if (options.history !== false) {
          historyRef.current.record(docRef.current.elements.map((element) => ({ ...element })))
          setHistoryDepth(historyRef.current.depth())
        }
        setBusy(true)
        try {
          let result = await postOps(sessionId, ops, docRef.current.rev)
          if (result.conflict === true) {
            setDoc({ rev: result.rev, elements: result.elements })
            result = await postOps(sessionId, ops, result.rev)
          }
          if (result.error !== undefined) {
            say(result.error)
            return null
          }
          if (result.conflict === true) {
            say(t('loadFailed'))
            return null
          }
          adopt(result)
          return result
        } catch (cause) {
          say(cause instanceof Error ? cause.message : String(cause))
          return null
        } finally {
          setBusy(false)
        }
      }, [adopt, say, sessionId, t])

      /**
       * Replace the whole board with one snapshot in a single commit.
       * @param {object[]} elements - the document to restore.
       * @returns {Promise<object|null>} the commit result.
       */
      const restoreSnapshot = useCallback(async (elements) => {
        // One op batch: clear then add, so the board never shows a half-restored
        // document and the change costs exactly one revision.
        return commit([{ op: 'clear' }, { op: 'add', elements }], { history: false })
      }, [commit])

      /** Undo the last gesture. @returns {Promise<void>} after the commit settles. */
      const undo = useCallback(async () => {
        if (gestureRef.current !== null) return
        const previous = historyRef.current.undo(docRef.current.elements.map((element) => ({ ...element })))
        if (previous === undefined) return
        setSelection([])
        await restoreSnapshot(previous)
        setHistoryDepth(historyRef.current.depth())
      }, [restoreSnapshot])

      /** Redo the last undone gesture. @returns {Promise<void>} after the commit settles. */
      const redo = useCallback(async () => {
        if (gestureRef.current !== null) return
        const next = historyRef.current.redo(docRef.current.elements.map((element) => ({ ...element })))
        if (next === undefined) return
        setSelection([])
        await restoreSnapshot(next)
        setHistoryDepth(historyRef.current.depth())
      }, [restoreSnapshot])

      /**
       * The stage's visible area in world coordinates.
       * @returns {{x0: number, y0: number, x1: number, y1: number}|null} the rect, or null before layout.
       */
      const visibleWorldRect = useCallback(() => {
        const stage = stageRef.current
        if (stage === null) return null
        const rect = stage.getBoundingClientRect()
        const current = viewRef.current
        if (rect.width === 0 || rect.height === 0) return null
        return {
          x0: (0 - current.x) / current.scale,
          y0: (0 - current.y) / current.scale,
          x1: (rect.width - current.x) / current.scale,
          y1: (rect.height - current.y) / current.scale,
        }
      }, [])

      /** @returns {{x: number, y: number}} a client point in world coordinates. */
      const toWorld = useCallback((clientX, clientY) => {
        const stage = stageRef.current
        const rect = stage === null ? { left: 0, top: 0 } : stage.getBoundingClientRect()
        const current = viewRef.current
        return {
          x: (clientX - rect.left - current.x) / current.scale,
          y: (clientY - rect.top - current.y) / current.scale,
        }
      }, [])

      /**
       * Topmost element under a world point.
       * @param {{x: number, y: number}} point - world point.
       * @returns {object|null} the element, or null.
       */
      const hitTest = useCallback((point) => {
        const elements = docRef.current.elements
        const tolerance = 6 / viewRef.current.scale
        for (let index = elements.length - 1; index >= 0; index -= 1) {
          const element = elements[index]
          if (element.type === 'arrow' || element.type === 'line') {
            if (distToSegment(point, [element.x, element.y], [element.x2 ?? element.x, element.y2 ?? element.y]) <= Math.max(tolerance, 8)) return element
            continue
          }
          if (element.type === 'stroke') {
            for (const [px, py] of element.points ?? []) {
              if (Math.hypot(px - point.x, py - point.y) <= Math.max(tolerance, 8)) return element
            }
            continue
          }
          const box = boxOf(element)
          if (point.x >= box[0] - tolerance && point.x <= box[0] + box[2] + tolerance && point.y >= box[1] - tolerance && point.y <= box[1] + box[3] + tolerance) return element
        }
        return null
      }, [])

      /**
       * One click target's ids: the element alone, or its whole group.
       * @param {object} element - hit element.
       * @returns {string[]} ids to select.
       */
      const targetIds = useCallback((element) => {
        if (typeof element.groupId !== 'string') return [element.id]
        return docRef.current.elements.filter((candidate) => candidate.groupId === element.groupId).map((candidate) => candidate.id)
      }, [])

      const selectedElements = useMemo(
        () => doc.elements.filter((element) => selection.includes(element.id)),
        [doc.elements, selection],
      )

      /** Geometry patch that moves one element by a delta. */
      const movedPatch = (element, dx, dy) => {
        const patch = { x: element.x + dx, y: element.y + dy }
        if (element.type === 'arrow' || element.type === 'line') {
          patch.x2 = (element.x2 ?? element.x) + dx
          patch.y2 = (element.y2 ?? element.y) + dy
        }
        if (Array.isArray(element.points)) patch.points = element.points.map(([px, py]) => [px + dx, py + dy])
        return patch
      }

      // ── pointer handling ────────────────────────────────────────────────────
      const onPointerDown = useCallback((event) => {
        if (event.button !== 0 && event.button !== 1) return
        const stage = stageRef.current
        if (stage === null) return
        stage.focus({ preventScroll: true })
        setMenu(false)
        const panning = event.button === 1 || spaceRef.current || toolRef.current === 'pan'
        if (panning) {
          event.preventDefault()
          dragRef.current = { mode: 'pan', startX: event.clientX, startY: event.clientY, origin: { ...viewRef.current } }
          stage.setPointerCapture(event.pointerId)
          return
        }
        const point = toWorld(event.clientX, event.clientY)
        const hit = hitTest(point)
        const currentTool = toolRef.current

        if (currentTool === 'select') {
          if (hit !== null) {
            const ids = targetIds(hit)
            const base = event.shiftKey ? selectionRef.current : (selectionRef.current.includes(hit.id) ? selectionRef.current : [])
            const next = [...new Set([...base, ...ids])]
            setSelection(next)
            setEditing(null)
            dragRef.current = {
              mode: 'move',
              startX: event.clientX,
              startY: event.clientY,
              origin: docRef.current.elements.filter((element) => next.includes(element.id)),
            }
            stage.setPointerCapture(event.pointerId)
            return
          }
          setSelection(event.shiftKey ? selectionRef.current : [])
          setEditing(null)
          dragRef.current = { mode: 'marquee', x0: point.x, y0: point.y, x1: point.x, y1: point.y }
          setMarquee({ x0: point.x, y0: point.y, x1: point.x, y1: point.y })
          stage.setPointerCapture(event.pointerId)
          return
        }

        if (currentTool === 'pen') {
          gestureRef.current = 'stroke'
          dragRef.current = { mode: 'stroke', points: [[point.x, point.y]] }
          setDraft({ type: 'stroke', points: [[point.x, point.y]], color: colorRef.current, size: 15, x: point.x, y: point.y, w: 0, h: 0 })
          stage.setPointerCapture(event.pointerId)
          return
        }

        if (currentTool === 'eraser') {
          // Preview only: the elements the trail touches turn translucent and
          // nothing is committed until the pointer lifts, so one pass is one
          // undoable step.
          gestureRef.current = 'erase'
          dragRef.current = { mode: 'erase', trail: [[point.x, point.y]], hits: new Set() }
          setEraser({ trail: [[point.x, point.y]], hits: [] })
          stage.setPointerCapture(event.pointerId)
          return
        }

        if (currentTool === 'pin') {
          dragRef.current = null
          // A pin annotates whatever sits under it, so the thread it opens is
          // the target's, not its own.
          const target = hit
          commit([{ op: 'add', elements: [{ type: 'pin', x: point.x - 14, y: point.y - 14, text: '', targetId: target === null ? undefined : target.id }] }]).then((result) => {
            if (result === null) return
            const added = (result.touched ?? []).find((id) => (result.elements ?? []).some((element) => element.id === id && element.type === 'pin'))
            if (added !== undefined) setSelection([added])
          })
          return
        }

        if (currentTool === 'text' || currentTool === 'note' || currentTool === 'card') {
          const base = currentTool === 'card'
            ? { w: 300, h: 200 }
            : currentTool === 'note'
              ? { w: 200, h: 140 }
              : { w: 220, h: 32 }
          // Keep the whole new element inside the visible stage: a click near
          // the right edge would otherwise open it mostly off-screen.
          const room = visibleWorldRect()
          if (room !== null) {
            point.x = Math.min(point.x, room.x1 - base.w - 8)
            point.y = Math.min(point.y, room.y1 - base.h - 8)
          }
          dragRef.current = null
          setSelection([])
          commit([{
            op: 'add',
            elements: [{
              type: currentTool,
              x: point.x,
              y: point.y,
              w: base.w,
              h: base.h,
              color: currentTool === 'note' ? 'note-yellow' : colorRef.current,
              size: 15,
              text: '',
              markdown: '',
            }],
          }]).then((result) => {
            if (result === null) return
            const added = (result.touched ?? []).find((id) => (result.elements ?? []).some((element) => element.id === id))
            if (added === undefined) return
            setSelection([added])
            setEditing({ id: added, value: '' })
          })
          return
        }

        dragRef.current = { mode: 'shape', tool: currentTool, x0: point.x, y0: point.y, color: colorRef.current }
        setDraft({ type: currentTool, x: point.x, y: point.y, w: 0, h: 0, x2: point.x, y2: point.y, color: colorRef.current, size: 15 })
        stage.setPointerCapture(event.pointerId)
      }, [commit, hitTest, targetIds, toWorld])

      const onPointerMove = useCallback((event) => {
        const drag = dragRef.current
        if (drag === null) return
        if (drag.mode === 'pan') {
          setView({
            x: drag.origin.x + (event.clientX - drag.startX),
            y: drag.origin.y + (event.clientY - drag.startY),
            scale: drag.origin.scale,
          })
          return
        }
        const point = toWorld(event.clientX, event.clientY)
        if (drag.mode === 'marquee') {
          drag.x1 = point.x
          drag.y1 = point.y
          setMarquee({ x0: drag.x0, y0: drag.y0, x1: point.x, y1: point.y })
          return
        }
        if (drag.mode === 'move') {
          const dx = (event.clientX - drag.startX) / viewRef.current.scale
          const dy = (event.clientY - drag.startY) / viewRef.current.scale
          drag.dx = dx
          drag.dy = dy
          setMove({ dx, dy, ids: drag.origin.map((element) => element.id) })
          return
        }
        if (drag.mode === 'resize') {
          const start = drag.start
          const dx = point.x - start.x
          const dy = point.y - start.y
          const [x, y, w, hgt] = drag.box
          let next
          if (drag.corner === 'se') next = [x, y, Math.max(8, w + dx), Math.max(8, hgt + dy)]
          else if (drag.corner === 'sw') next = [x + Math.min(dx, w - 8), y, Math.max(8, w - dx), Math.max(8, hgt + dy)]
          else if (drag.corner === 'ne') next = [x, y + Math.min(dy, hgt - 8), Math.max(8, w + dx), Math.max(8, hgt - dy)]
          else next = [x + Math.min(dx, w - 8), y + Math.min(dy, hgt - 8), Math.max(8, w - dx), Math.max(8, hgt - dy)]
          drag.next = next
          setResize({ id: drag.id, box: next })
          return
        }
        if (drag.mode === 'stroke') {
          const points = drag.points
          const last = points[points.length - 1]
          if (Math.hypot(point.x - last[0], point.y - last[1]) < 1.5 / viewRef.current.scale) return
          points.push([point.x, point.y])
          setDraft({ type: 'stroke', points: points.slice(), color: colorRef.current, size: 15, x: 0, y: 0, w: 0, h: 0 })
          return
        }
        if (drag.mode === 'erase') {
          const last = drag.trail[drag.trail.length - 1]
          const scale = viewRef.current.scale
          if (Math.hypot(point.x - last[0], point.y - last[1]) < 2 / scale) return
          drag.trail.push([point.x, point.y])
          const from = { x: last[0], y: last[1] }
          for (const element of docRef.current.elements) {
            if (drag.hits.has(element.id)) continue
            if (eraserHits(from, point, element, scale)) drag.hits.add(element.id)
          }
          setEraser({ trail: drag.trail.slice(), hits: [...drag.hits] })
          return
        }
        if (drag.mode === 'shape') {
          drag.end = point
          if (drag.tool === 'arrow' || drag.tool === 'line') {
            setDraft({ type: drag.tool, x: drag.x0, y: drag.y0, x2: point.x, y2: point.y, w: 0, h: 0, color: drag.color, size: 15 })
          } else {
            setDraft({
              type: drag.tool,
              x: Math.min(drag.x0, point.x),
              y: Math.min(drag.y0, point.y),
              w: Math.abs(point.x - drag.x0),
              h: Math.abs(point.y - drag.y0),
              color: drag.color,
              size: 15,
            })
          }
        }
      }, [toWorld])

      const onPointerUp = useCallback((event) => {
        const drag = dragRef.current
        dragRef.current = null
        if (drag === null) return
        const stage = stageRef.current
        if (stage !== null && stage.hasPointerCapture?.(event.pointerId) === true) stage.releasePointerCapture(event.pointerId)
        if (drag.mode === 'pan') return

        if (drag.mode === 'marquee') {
          setMarquee(null)
          const bounds = {
            x0: Math.min(drag.x0, drag.x1),
            y0: Math.min(drag.y0, drag.y1),
            x1: Math.max(drag.x0, drag.x1),
            y1: Math.max(drag.y0, drag.y1),
          }
          if (bounds.x1 - bounds.x0 < 3 && bounds.y1 - bounds.y0 < 3) return
          const picked = docRef.current.elements.filter((element) => {
            const box = boxOf(element)
            return overlaps(bounds, { x0: box[0], y0: box[1], x1: box[0] + box[2], y1: box[1] + box[3] })
          }).map((element) => element.id)
          setSelection(picked)
          return
        }

        if (drag.mode === 'move') {
          setMove(null)
          const dx = drag.dx ?? 0
          const dy = drag.dy ?? 0
          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
          commit(drag.origin.map((element) => ({ op: 'update', id: element.id, patch: movedPatch(element, dx, dy) })))
          return
        }

        if (drag.mode === 'resize') {
          setResize(null)
          const next = drag.next
          if (next === undefined) return
          commit([{ op: 'update', id: drag.id, patch: { x: next[0], y: next[1], w: next[2], h: next[3] } }])
          return
        }

        if (drag.mode === 'stroke') {
          setDraft(null)
          gestureRef.current = null
          if (drag.points.length < 2) return
          commit([{ op: 'add', elements: [{ type: 'stroke', points: drag.points, color: colorRef.current, size: 15, x: 0, y: 0, w: 0, h: 0 }] }])
          return
        }
        if (drag.mode === 'erase') {
          setEraser(null)
          gestureRef.current = null
          const ids = [...drag.hits]
          if (ids.length === 0) return
          commit([{ op: 'remove', ids }])
          return
        }

        if (drag.mode === 'shape') {
          setDraft(null)
          const end = drag.end
          if (end === undefined) return
          if (drag.tool === 'arrow' || drag.tool === 'line') {
            if (Math.hypot(end.x - drag.x0, end.y - drag.y0) < 6) return
            commit([{ op: 'add', elements: [{ type: drag.tool, x: drag.x0, y: drag.y0, x2: end.x, y2: end.y, color: drag.color, size: 15 }] }])
              .then((result) => { if (result !== null) setTool('select') })
            return
          }
          const w = Math.abs(end.x - drag.x0)
          const hgt = Math.abs(end.y - drag.y0)
          if (w < 4 && hgt < 4) return
          commit([{
            op: 'add',
            elements: [{
              type: drag.tool,
              x: Math.min(drag.x0, end.x),
              y: Math.min(drag.y0, end.y),
              w,
              h: hgt,
              color: drag.color,
              size: 15,
            }],
          }]).then((result) => { if (result !== null) setTool('select') })
        }
      }, [commit, movedPatch])

      const onDoubleClick = useCallback((event) => {
        const point = toWorld(event.clientX, event.clientY)
        const hit = hitTest(point)
        if (hit === null) return
        setSelection([hit.id])
        if (hit.type === 'text' || hit.type === 'note' || hit.type === 'card') {
          setEditing({ id: hit.id, value: hit.type === 'card' ? (hit.markdown ?? '') : (hit.text ?? '') })
        }
      }, [hitTest, toWorld])

      const onWheel = useCallback((event) => {
        event.preventDefault()
        const current = viewRef.current
        if (event.ctrlKey || event.metaKey) {
          const stage = stageRef.current
          if (stage === null) return
          const rect = stage.getBoundingClientRect()
          const factor = Math.exp(-event.deltaY * 0.0016)
          const scale = Math.min(4, Math.max(0.15, current.scale * factor))
          const px = event.clientX - rect.left
          const py = event.clientY - rect.top
          const worldX = (px - current.x) / current.scale
          const worldY = (py - current.y) / current.scale
          setView({ x: px - worldX * scale, y: py - worldY * scale, scale })
          return
        }
        setView({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY })
      }, [])

      const onKeyDown = useCallback((event) => {
        const target = event.target
        const typing = target instanceof HTMLElement && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)
        if (typing) return
        if (event.key === ' ') {
          spaceRef.current = true
          event.preventDefault()
          return
        }
        if (event.key === 'Escape') {
          setEditing(null)
          setSelection([])
          setTool('select')
          setMenu(false)
          return
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          const ids = selectionRef.current
          if (ids.length === 0) return
          event.preventDefault()
          setSelection([])
          commit([{ op: 'remove', ids }])
          return
        }
        const shortcuts = { v: 'select', h: 'pan', p: 'pen', r: 'rect', o: 'ellipse', a: 'arrow', l: 'line', t: 'text', n: 'note', m: 'card', k: 'pin' }
        const next = shortcuts[event.key.toLowerCase()]
        if (next !== undefined && !event.metaKey && !event.ctrlKey) {
          setTool(next)
          if (next !== 'select') setSelection([])
        }
      }, [commit])

      // Undo/redo listen on the document: the shortcuts are global to the board
      // panel, and requiring the canvas to hold focus would make them feel
      // broken right after a toolbar click.
      useEffect(() => {
        const onDocumentKey = (event) => {
          const target = event.target
          const typing = target instanceof HTMLElement && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)
          if (typing) return
          if (!(event.metaKey || event.ctrlKey)) return
          if (event.key === 'z' || event.key === 'Z') {
            event.preventDefault()
            if (event.shiftKey) void redo()
            else void undo()
            return
          }
          if (event.key === 'y' || event.key === 'Y') {
            event.preventDefault()
            void redo()
          }
        }
        document.addEventListener('keydown', onDocumentKey)
        return () => document.removeEventListener('keydown', onDocumentKey)
      }, [undo, redo])

      const onKeyUp = useCallback((event) => {
        if (event.key === ' ') spaceRef.current = false
      }, [])

      // ── editing ────────────────────────────────────────────────────────────
      const finishEditing = useCallback((value) => {
        const current = editingRef.current
        setEditing(null)
        if (current === null) return
        const element = docRef.current.elements.find((candidate) => candidate.id === current.id)
        if (element === undefined) return
        const patch = element.type === 'card' ? { markdown: value } : { text: value }
        // A note is paper around its text: grow it to fit what was typed rather
        // than clipping the last line.
        if (element.type === 'note' && value !== '') {
          const charsPerLine = Math.max(8, Math.floor((element.w - 16) / ((element.size ?? 15) * 0.6)))
          const lines = value.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0)
          patch.h = Math.max(60, Math.round(lines * (element.size ?? 15) * 1.5 + 24))
        }
        commit([{ op: 'update', id: current.id, patch }])
      }, [commit])

      // ── operations ─────────────────────────────────────────────────────────
      const deleteSelection = useCallback(() => {
        const ids = selectionRef.current
        if (ids.length === 0) return
        if (!window.confirm(t('confirmDelete').replace('{n}', String(ids.length)))) return
        setSelection([])
        commit([{ op: 'remove', ids }])
      }, [commit, t])

      const addComment = useCallback((text) => {
        const ids = selectionRef.current
        if (ids.length !== 1 || text.trim() === '') return
        commit([{ op: 'comment', id: ids[0], text }]).then((result) => {
          if (result !== null) setCommentDraft('')
        })
      }, [commit])

      const groupSelection = useCallback(() => {
        const ids = selectionRef.current
        if (ids.length < 2) return
        const groupId = `g_${Math.random().toString(36).slice(2, 9)}`
        commit(ids.map((id) => ({ op: 'update', id, patch: { groupId } })))
      }, [commit])

      const ungroupSelection = useCallback(() => {
        const ids = selectionRef.current
        if (ids.length === 0) return
        commit(ids.map((id) => ({ op: 'update', id, patch: { groupId: null } })))
      }, [commit])

      const align = useCallback((mode) => {
        if (selectedElements.length < 2) return
        const boxes = selectedElements.map((element) => ({ element, box: boxOf(element) }))
        const x0 = Math.min(...boxes.map((entry) => entry.box[0]))
        const x1 = Math.max(...boxes.map((entry) => entry.box[0] + entry.box[2]))
        const y0 = Math.min(...boxes.map((entry) => entry.box[1]))
        const y1 = Math.max(...boxes.map((entry) => entry.box[1] + entry.box[3]))
        const updates = boxes.map(({ element, box }) => {
          let dx = 0
          let dy = 0
          if (mode === 'left') dx = x0 - box[0]
          if (mode === 'right') dx = x1 - (box[0] + box[2])
          if (mode === 'centerX') dx = (x0 + x1) / 2 - (box[0] + box[2] / 2)
          if (mode === 'top') dy = y0 - box[1]
          if (mode === 'bottom') dy = y1 - (box[1] + box[3])
          if (mode === 'centerY') dy = (y0 + y1) / 2 - (box[1] + box[3] / 2)
          return { op: 'update', id: element.id, patch: movedPatch(element, dx, dy) }
        })
        commit(updates)
      }, [commit, movedPatch, selectedElements])

      const fitView = useCallback(() => {
        const stage = stageRef.current
        if (stage === null) return
        const rect = stage.getBoundingClientRect()
        const elements = docRef.current.elements
        if (elements.length === 0) {
          setView({ x: 32, y: 32, scale: 1 })
          return
        }
        const bounds = contentBounds(elements)
        const width = Math.max(1, bounds.x1 - bounds.x0)
        const height = Math.max(1, bounds.y1 - bounds.y0)
        const scale = Math.min(2, Math.max(0.15, Math.min((rect.width - 48) / width, (rect.height - 48) / height)))
        setView({
          scale,
          x: (rect.width - width * scale) / 2 - bounds.x0 * scale,
          y: (rect.height - height * scale) / 2 - bounds.y0 * scale,
        })
      }, [])

      // Fit the view once per mount, after the first load: a board whose content
      // sits far from the origin would otherwise open on empty canvas.
      const fittedRef = useRef(false)
      useEffect(() => {
        if (phase !== 'ready' || fittedRef.current) return
        fittedRef.current = true
        if (docRef.current.elements.length === 0) return
        fitView()
      }, [phase, fitView])

      const zoomBy = useCallback((factor) => {
        const stage = stageRef.current
        if (stage === null) return
        const rect = stage.getBoundingClientRect()
        const current = viewRef.current
        const scale = Math.min(4, Math.max(0.15, current.scale * factor))
        const cx = rect.width / 2
        const cy = rect.height / 2
        const worldX = (cx - current.x) / current.scale
        const worldY = (cy - current.y) / current.scale
        setView({ x: cx - worldX * scale, y: cy - worldY * scale, scale })
      }, [])

      // ── paste ──────────────────────────────────────────────────────────────
      const onPaste = useCallback(async (event) => {
        const items = event.clipboardData?.items ?? []
        for (const item of items) {
          if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
          const file = item.getAsFile()
          if (file === null) continue
          event.preventDefault()
          try {
            const dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(String(reader.result))
              reader.onerror = () => reject(new Error('read failed'))
              reader.readAsDataURL(file)
            })
            const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
            const id = await uploadImage(base64, file.type)
            const size = await new Promise((resolve) => {
              const image = new Image()
              image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
              image.onerror = () => resolve({ width: 320, height: 220 })
              image.src = dataUrl
            })
            const scale = Math.min(1, 420 / Math.max(1, size.width))
            const stage = stageRef.current
            const box = stage === null ? { left: 0, top: 0 } : stage.getBoundingClientRect()
            const origin = toWorld(box.left + 40, box.top + 40)
            await commit([{
              op: 'add',
              elements: [{
                type: 'image',
                x: origin.x,
                y: origin.y,
                w: Math.round(size.width * scale),
                h: Math.round(size.height * scale),
                attachmentId: id,
                name: file.name || 'pasted image',
              }],
            }])
          } catch (cause) {
            say(`${t('pasteFailed')}: ${cause instanceof Error ? cause.message : String(cause)}`)
          }
          return
        }
      }, [commit, say, t, toWorld])

      // ── send to the agent ──────────────────────────────────────────────────
      const buildDigest = useCallback((elements, whole) => {
        const lines = []
        lines.push(t('sendIntro'))
        lines.push(whole ? t('sendWhole').replace('{n}', String(elements.length)) : t('sendSelected').replace('{n}', String(elements.length)))
        for (const element of elements) {
          const box = boxOf(element).map((value) => Math.round(value)).join(',')
          const who = element.author === 'agent' ? t('authorAgent') : t('authorUser')
          lines.push('')
          lines.push(`- ${element.id} · ${element.type} · ${who} · box ${box}`)
          if (element.title) lines.push(`  title: ${element.title}`)
          if (element.text) lines.push(`  text: ${element.text}`)
          if (element.markdown) lines.push(`  markdown:\n${element.markdown.split('\n').map((line) => `    ${line}`).join('\n')}`)
          if (element.name) lines.push(`  image: ${element.name}`)
          for (const comment of element.comments ?? []) {
            lines.push(`  ${t('commentLine').replace('{who}', comment.author === 'agent' ? t('authorAgent') : t('authorUser')).replace('{text}', comment.text)}`)
          }
        }
        const rest = docRef.current.elements.length - elements.length
        if (rest > 0) lines.push('', t('moreOnBoard').replace('{n}', String(rest)))
        lines.push('', t('sendOutro'))
        return lines.join('\n')
      }, [t])

      const sendToAgent = useCallback(async () => {
        if (typeof sessionId !== 'string' || sessionId === '') return
        const selected = docRef.current.elements.filter((element) => selectionRef.current.includes(element.id))
        const whole = selected.length === 0
        const chosen = whole ? docRef.current.elements : selected
        if (chosen.length === 0) {
          say(t('empty'))
          return
        }
        const text = buildDigest(chosen, whole)
        setBusy(true)
        try {
          const binding = services.current?.sessions?.binding(sessionId)
          const session = binding?.session
          if (session === undefined || session === null) throw new Error(t('noSession'))
          let base64 = null
          let previewUrl = null
          try {
            const bounds = contentBounds(chosen)
            const padded = { x0: bounds.x0 - 24, y0: bounds.y0 - 24, x1: bounds.x1 + 24, y1: bounds.y1 + 24 }
            const canvas = await snapshot(chosen, padded, { width: 1100 })
            const dataUrl = canvas.toDataURL('image/png')
            base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
            previewUrl = dataUrl
          } catch {
            base64 = null
          }
          const attachments = base64 === null ? [] : [{ type: 'image', value: { previewUrl, name: 'board.png' } }]
          const withImage = base64 === null
            ? [{ type: 'text', text }]
            : [{ type: 'image', mediaType: 'image/png', data: base64 }, { type: 'text', text }]
          const handle = session.beginSubmission({ mode: 'queue', text, attachments })
          let result = await session.prompt(withImage, 'queue', undefined, handle.requestId)
          if (result.ok !== true && base64 !== null) {
            // The route refused the image — a model without image input, most
            // often. Send the same digest as text rather than failing the send.
            const retry = session.beginSubmission({ mode: 'queue', text, attachments: [] })
            result = await session.prompt([{ type: 'text', text }], 'queue', undefined, retry.requestId)
          }
          if (result.ok !== true) throw new Error(result.error?.message ?? t('sendFailed'))
          say(t('sent'))
        } catch (cause) {
          say(`${t('sendFailed')}: ${cause instanceof Error ? cause.message : String(cause)}`)
        } finally {
          setBusy(false)
        }
      }, [buildDigest, say, sessionId, t])

      // ── export ─────────────────────────────────────────────────────────────
      const exportPng = useCallback(async () => {
        const elements = docRef.current.elements
        if (elements.length === 0) {
          say(t('exportEmpty'))
          return
        }
        const bounds = contentBounds(elements)
        const padded = { x0: bounds.x0 - 32, y0: bounds.y0 - 32, x1: bounds.x1 + 32, y1: bounds.y1 + 32 }
        const canvas = await snapshot(elements, padded, { width: 1600 })
        const link = document.createElement('a')
        link.href = canvas.toDataURL('image/png')
        link.download = 'board.png'
        link.click()
        say(t('exported'))
      }, [say, t])

      const exportMarkdown = useCallback(() => {
        const elements = docRef.current.elements
        if (elements.length === 0) {
          say(t('exportEmpty'))
          return
        }
        const lines = [`# ${t('title')}`, '', `_rev ${docRef.current.rev}_`, '']
        for (const element of elements) {
          if (element.type === 'card' || element.type === 'note' || element.type === 'text') {
            const body = element.type === 'card' ? element.markdown : element.text
            lines.push(`## ${element.title ?? element.type} (${element.id})`, '', body ?? '', '')
          }
          for (const comment of element.comments ?? []) {
            lines.push(`> **${comment.author === 'agent' ? t('authorAgent') : t('authorUser')}**: ${comment.text}`, '')
          }
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = 'board.md'
        link.click()
        setTimeout(() => URL.revokeObjectURL(link.href), 4000)
        say(t('exported'))
      }, [say, t])

      const clearBoard = useCallback(() => {
        if (!window.confirm(t('clearConfirm'))) return
        setSelection([])
        commit([{ op: 'clear' }])
      }, [commit, t])

      // ── render ─────────────────────────────────────────────────────────────
      const displayed = useMemo(() => {
        let elements = doc.elements
        if (move !== null) {
          const ids = new Set(move.ids)
          elements = elements.map((element) => (ids.has(element.id) ? { ...element, ...movedPatch(element, move.dx, move.dy) } : element))
        }
        if (resize !== null) {
          elements = elements.map((element) => (element.id === resize.id ? { ...element, x: resize.box[0], y: resize.box[1], w: resize.box[2], h: resize.box[3] } : element))
        }
        return elements
      }, [doc.elements, move, resize])

      const stageClass = `dsb-stage dsb-stage-tool-${tool}`
      const selectionSet = new Set(selection)
      const flashSet = new Set(flash)
      const children = []
      children.push(h('style', { key: 'css' }, CSS))

      const tools = [
        ['select', 'toolSelect'],
        ['pan', 'toolPan'],
        ['pen', 'toolPen'],
        ['eraser', 'toolEraser'],
        ['rect', 'toolRect'],
        ['ellipse', 'toolEllipse'],
        ['arrow', 'toolArrow'],
        ['line', 'toolLine'],
        ['text', 'toolText'],
        ['note', 'toolNote'],
        ['card', 'toolCard'],
        ['pin', 'toolPin'],
      ]
      children.push(h('div', { key: 'bar', className: 'dsb-bar', role: 'toolbar', 'aria-label': t('tools') },
        h('div', { key: 'tools', className: 'dsb-tools' },
          tools.map(([name, label]) => h(ToolButton, {
            key: name,
            name,
            title: t(label),
            active: tool === name,
            onClick: () => {
              // Clicking the tool already in force leaves that mode, so a mode is
              // never a trap the user has to hunt for an exit from.
              const next = tool === name && name !== 'select' ? 'select' : name
              setTool(next)
              if (next !== 'select') setSelection([])
            },
          })),
          h('span', { key: 'sep1', className: 'dsb-sep' }),
          h('div', { key: 'swatches', className: 'dsb-swatches' },
            (tool === 'note' ? NOTE_SWATCHES : SWATCHES).map((name) => h('button', {
              key: name,
              type: 'button',
              className: `dsb-swatch${color === name ? ' dsb-swatch-on' : ''}`,
              style: { background: cssColor(name) },
              title: name,
              'aria-label': `${t('color')}: ${name}`,
              onClick: () => setColor(name),
              onPointerDown: (event) => event.stopPropagation(),
            }))),
          h('span', { key: 'sep2', className: 'dsb-sep' }),
          h(ToolButton, { key: 'out', name: 'minus', title: t('zoomOut'), onClick: () => zoomBy(1 / 1.2) }),
          h('span', { key: 'zoom', className: 'dsb-zoom' }, `${Math.round(view.scale * 100)}%`),
          h(ToolButton, { key: 'in', name: 'plus', title: t('zoomIn'), onClick: () => zoomBy(1.2) }),
          h(ToolButton, { key: 'fit', name: 'fit', title: t('zoomFit'), onClick: fitView })),
        h('div', { key: 'actions', className: 'dsb-actions' },
          h(ToolButton, { key: 'undo', name: 'undo', title: t('undo'), disabled: historyDepth.undo === 0, onClick: () => void undo() }),
          h(ToolButton, { key: 'redo', name: 'redo', title: t('redo'), disabled: historyDepth.redo === 0, onClick: () => void redo() }),
          h('button', {
            key: 'send',
            type: 'button',
            className: 'dsb-primary',
            disabled: busy === true || phase !== 'ready',
            title: t('send'),
            onClick: sendToAgent,
            onPointerDown: (event) => event.stopPropagation(),
          }, h(Icon, { name: 'send' }), h('span', { className: 'dsb-send-label' }, busy === true ? t('sending') : t('send'))),
          h(ToolButton, { key: 'more', name: 'more', title: t('more'), onClick: () => setMenu((open) => !open) })),
      ))

      if (menu) {
        children.push(h('div', { key: 'menu', className: 'dsb-menu', onPointerDown: (event) => event.stopPropagation() },
          h('button', { type: 'button', className: 'dsb-menu-item', disabled: historyDepth.undo === 0, onClick: () => { setMenu(false); void undo() } }, h(Icon, { name: 'undo' }), t('undo')),
          h('button', { type: 'button', className: 'dsb-menu-item', disabled: historyDepth.redo === 0, onClick: () => { setMenu(false); void redo() } }, h(Icon, { name: 'redo' }), t('redo')),
          h('button', { type: 'button', className: 'dsb-menu-item', onClick: () => { setMenu(false); void exportPng() } }, h(Icon, { name: 'download' }), t('exportPng')),
          h('button', { type: 'button', className: 'dsb-menu-item', onClick: () => { setMenu(false); exportMarkdown() } }, h(Icon, { name: 'download' }), t('exportMarkdown')),
          h('button', { type: 'button', className: 'dsb-menu-item', onClick: () => { setMenu(false); setShowHelp((open) => !open) } }, h(Icon, { name: 'help' }), t('help')),
          h('button', { type: 'button', className: 'dsb-menu-item dsb-danger', onClick: () => { setMenu(false); clearBoard() } }, h(Icon, { name: 'trash' }), t('clear')),
        ))
      }

      const worldChildren = []
      const svgShapes = []
      for (const element of displayed) {
        const isSelected = selectionSet.has(element.id)
        const flashing = flashSet.has(element.id)
        const className = [
          'dsb-el',
          `dsb-el-${element.type}`,
          isSelected ? 'dsb-el-sel' : '',
          flashing ? 'dsb-el-flash' : '',
        ].filter((part) => part !== '').join(' ')
        const color = cssColor(element.color)
        const width = Math.max(1.5, (element.size ?? 15) / 8)

        if (element.type === 'stroke') {
          svgShapes.push(h('polyline', {
            key: element.id,
            points: (element.points ?? []).map(([px, py]) => `${px},${py}`).join(' '),
            fill: 'none',
            stroke: color,
            strokeWidth: width,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            style: isSelected ? { outline: 'none', filter: 'drop-shadow(0 0 1.5px var(--dsw-alias-brand-primary))' } : undefined,
          }))
          continue
        }
        if (element.type === 'rect') {
          svgShapes.push(h('rect', { key: element.id, x: element.x, y: element.y, width: element.w, height: element.h, rx: 4, fill: 'none', stroke: color, strokeWidth: width }))
          if (isSelected) svgShapes.push(h('rect', { key: `${element.id}-sel`, x: element.x - 3, y: element.y - 3, width: element.w + 6, height: element.h + 6, rx: 6, fill: 'none', stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 1.5, strokeDasharray: '4 3' }))
          continue
        }
        if (element.type === 'ellipse') {
          svgShapes.push(h('ellipse', { key: element.id, cx: element.x + element.w / 2, cy: element.y + element.h / 2, rx: Math.abs(element.w / 2), ry: Math.abs(element.h / 2), fill: 'none', stroke: color, strokeWidth: width }))
          if (isSelected) svgShapes.push(h('ellipse', { key: `${element.id}-sel`, cx: element.x + element.w / 2, cy: element.y + element.h / 2, rx: Math.abs(element.w / 2) + 3, ry: Math.abs(element.h / 2) + 3, fill: 'none', stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 1.5, strokeDasharray: '4 3' }))
          continue
        }
        if (element.type === 'arrow' || element.type === 'line') {
          const x2 = element.x2 ?? element.x
          const y2 = element.y2 ?? element.y
          svgShapes.push(h('line', { key: element.id, x1: element.x, y1: element.y, x2, y2, stroke: color, strokeWidth: width, strokeLinecap: 'round' }))
          if (element.type === 'arrow') {
            const angle = Math.atan2(y2 - element.y, x2 - element.x)
            const head = Math.max(9, (element.size ?? 15) * 0.95)
            const p1 = [x2 - head * Math.cos(angle - 0.42), y2 - head * Math.sin(angle - 0.42)]
            const p2 = [x2 - head * Math.cos(angle + 0.42), y2 - head * Math.sin(angle + 0.42)]
            svgShapes.push(h('polygon', { key: `${element.id}-head`, points: `${x2},${y2} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`, fill: color }))
          }
          if (isSelected) svgShapes.push(h('line', { key: `${element.id}-sel`, x1: element.x, y1: element.y, x2, y2, stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: width + 5, strokeLinecap: 'round', opacity: 0.25 }))
          continue
        }

        const box = boxOf(element)
        const style = {
          left: box[0],
          top: box[1],
          width: Math.max(4, box[2]),
          height: Math.max(4, box[3]),
        }
        if (element.type === 'text') {
          worldChildren.push(h('div', { key: element.id, className, style: { ...style, fontSize: element.size ?? 15, color } }, element.text ?? ''))
        } else if (element.type === 'note') {
          worldChildren.push(h('div', { key: element.id, className, style: { ...style, fontSize: element.size ?? 15, background: LITERAL_COLORS[element.color] ?? '#f6e3a1' } }, element.text ?? ''))
        } else if (element.type === 'card') {
          worldChildren.push(h('div', {
            key: element.id,
            className,
            style: { ...style, color },
            onWheel: (event) => event.stopPropagation(),
            onPointerDown: (event) => {
              // A card scrolls; only a drag that leaves it starts a move.
              const target = event.target
              if (target instanceof HTMLElement && target.closest('.dsb-md-tablewrap') !== null) event.stopPropagation()
            },
          },
          element.title ? h('div', { className: 'dsb-el-card-title' }, element.title) : null,
          h('div', { style: { fontSize: element.size ?? 15 } }, renderMarkdown(element.markdown ?? ''))))
        } else if (element.type === 'image') {
          worldChildren.push(h('div', { key: element.id, className, style },
            h('img', { src: imageUrl(element.attachmentId), alt: element.name ?? '', draggable: false })))
        } else if (element.type === 'pin') {
          const target = element.targetId === undefined ? undefined : doc.elements.find((candidate) => candidate.id === element.targetId)
          const count = ((target?.comments ?? element.comments) ?? []).length
          // An empty thread is invisible: a marker with nothing to say only adds
          // noise to the drawing, so it appears once someone comments.
          worldChildren.push(h('div', {
            key: element.id,
            className,
            style: { ...style, opacity: count === 0 ? 0.35 : 1 },
          }, h('div', { className: 'dsb-pin-body' }, count === 0 ? '+' : String(count))))
        }
      }

      if (draft !== null) {
        const color = cssColor(draft.color)
        if (draft.type === 'stroke') {
          svgShapes.push(h('polyline', { key: 'draft', points: (draft.points ?? []).map(([px, py]) => `${px},${py}`).join(' '), fill: 'none', stroke: color, strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }))
        } else if (draft.type === 'rect' || draft.type === 'ellipse') {
          if (draft.type === 'rect') {
            svgShapes.push(h('rect', { key: 'draft', x: draft.x, y: draft.y, width: draft.w, height: draft.h, rx: 4, fill: 'none', stroke: color, strokeWidth: 1.9, strokeDasharray: '5 4' }))
          } else {
            svgShapes.push(h('ellipse', { key: 'draft', cx: draft.x + draft.w / 2, cy: draft.y + draft.h / 2, rx: Math.abs(draft.w / 2), ry: Math.abs(draft.h / 2), fill: 'none', stroke: color, strokeWidth: 1.9, strokeDasharray: '5 4' }))
          }
        } else if (draft.type === 'arrow' || draft.type === 'line') {
          svgShapes.push(h('line', { key: 'draft', x1: draft.x, y1: draft.y, x2: draft.x2 ?? draft.x, y2: draft.y2 ?? draft.y, stroke: color, strokeWidth: 1.9, strokeLinecap: 'round', strokeDasharray: '5 4' }))
        }
      }

      if (eraser !== null) {
        // A wide translucent ribbon reads as a physical tool, and the elements
        // it is about to take fade under it.
        if (eraser.trail.length > 1) {
          svgShapes.push(h('polyline', {
            key: 'eraser-trail',
            points: eraser.trail.map(([px, py]) => `${px},${py}`).join(' '),
            fill: 'none',
            stroke: 'var(--dsw-alias-label-secondary)',
            strokeWidth: 14,
            strokeOpacity: 0.18,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }))
        }
        const doomed = new Set(eraser.hits)
        for (const [index, child] of worldChildren.entries()) {
          if (child !== null && child.props !== undefined && doomed.has(child.key)) {
            worldChildren[index] = React.cloneElement(child, { style: { ...child.props.style, opacity: 0.25 } })
          }
        }
        for (const [index, shape] of svgShapes.entries()) {
          if (shape !== null && doomed.has(shape.key)) {
            svgShapes[index] = React.cloneElement(shape, { opacity: 0.25 })
          }
        }
      }

      if (marquee !== null) {
        const rect = {
          x0: Math.min(marquee.x0, marquee.x1),
          y0: Math.min(marquee.y0, marquee.y1),
          x1: Math.max(marquee.x0, marquee.x1),
          y1: Math.max(marquee.y0, marquee.y1),
        }
        worldChildren.push(h('div', {
          key: 'marquee',
          className: 'dsb-marquee',
          style: { left: rect.x0, top: rect.y0, width: Math.max(1, rect.x1 - rect.x0), height: Math.max(1, rect.y1 - rect.y0) },
        }))
      }

      if (selection.length === 1 && tool === 'select') {
        const element = doc.elements.find((candidate) => candidate.id === selection[0])
        if (element !== undefined && element.type !== 'stroke' && element.type !== 'arrow' && element.type !== 'line') {
          const box = boxOf(element)
          const corners = [
            ['nw', box[0], box[1]],
            ['ne', box[0] + box[2], box[1]],
            ['sw', box[0], box[1] + box[3]],
            ['se', box[0] + box[2], box[1] + box[3]],
          ]
          for (const [corner, x, y] of corners) {
            worldChildren.push(h('div', {
              key: `handle-${corner}`,
              className: 'dsb-handle',
              style: { left: x, top: y, cursor: `${corner}-resize` },
              onPointerDown: (event) => {
                event.stopPropagation()
                const stage = stageRef.current
                if (stage !== null) stage.setPointerCapture(event.pointerId)
                dragRef.current = {
                  mode: 'resize',
                  id: element.id,
                  corner,
                  box: [box[0], box[1], box[2], box[3]],
                  start: toWorld(event.clientX, event.clientY),
                }
              },
            }))
          }
        }
      }

      if (editing !== null) {
        const element = doc.elements.find((candidate) => candidate.id === editing.id)
        if (element !== undefined) {
          const box = boxOf(element)
          worldChildren.push(h('textarea', {
            key: 'editor',
            className: 'dsb-editor',
            autoFocus: true,
            value: editing.value,
            spellCheck: false,
            style: {
              left: box[0],
              top: box[1],
              width: Math.max(160, box[2]),
              height: Math.max(56, box[3]),
              fontSize: element.size ?? 15,
              fontFamily: element.type === 'card' ? 'ui-monospace,SFMono-Regular,Menlo,monospace' : 'inherit',
            },
            placeholder: element.type === 'card' ? t('cardPlaceholder') : element.type === 'note' ? t('notePlaceholder') : t('textPlaceholder'),
            onChange: (event) => setEditing({ id: editing.id, value: event.target.value }),
            onBlur: () => finishEditing(editingRef.current?.value ?? ''),
            onPointerDown: (event) => event.stopPropagation(),
            onKeyDown: (event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setEditing(null)
              }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                finishEditing(editingRef.current?.value ?? '')
              }
            },
          }))
        }
      }

      // The agent is blocked on this board. This is a strip in the column, not an
      // overlay: the user has to be able to draw on the canvas it asks about.
      if (ask !== null) {
        // One line, not a second copy of the question: the composer card below
        // already carries the full prompt and the answer controls. This strip
        // only says which board the wait belongs to and how to leave it.
        children.push(h('div', { key: 'ask', className: 'dsb-ask', role: 'status', 'aria-label': t('askTitle') },
          h('span', { className: 'dsb-ask-dot', 'aria-hidden': true }),
          h('span', { className: 'dsb-ask-title' }, t('askTitle')),
          h('span', { className: 'dsb-ask-hint' }, t('askAnswerHint'))))
      }

      // A mode is visible while it is in force: what it is, and how to leave it.
      if (tool !== 'select') {
        const labels = {
          pan: 'toolPan', pen: 'toolPen', eraser: 'toolEraser', rect: 'toolRect',
          ellipse: 'toolEllipse', arrow: 'toolArrow', line: 'toolLine',
          text: 'toolText', note: 'toolNote', card: 'toolCard', pin: 'toolPin',
        }
        const label = t(labels[tool] ?? 'toolSelect').replace(/（[A-Z]）$/u, '').replace(/ \([A-Z]\)$/u, '')
        children.push(h('div', {
          key: 'mode',
          className: `dsb-mode${tool === 'eraser' ? ' dsb-mode-eraser' : ''}`,
          role: 'status',
        }, h('span', { className: 'dsb-mode-name' }, label), h('span', { className: 'dsb-mode-hint' }, t('modeHint').replace('{tool}', '').replace(/^ · /u, ''))))
      }

      children.push(h('div', {
        key: 'stage',
        className: stageClass,
        ref: stageRef,
        tabIndex: 0,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel: onPointerUp,
        onDoubleClick,
        onWheel,
        onKeyDown,
        onKeyUp,
        onPaste,
        onBlur: () => { spaceRef.current = false },
        'data-dsb-stage': true,
      },
      h('div', {
        key: 'world',
        className: 'dsb-world',
        style: { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` },
      },
      h('svg', { key: 'svg', className: 'dsb-layer', width: 1, height: 1 }, svgShapes),
      worldChildren),
      phase === 'loading' ? h('div', { key: 'loading', className: 'dsb-hint' }, h('div', { className: 'dsb-hint-title' }, t('loading'))) : null,
      phase === 'error' ? h('div', { key: 'error', className: 'dsb-hint' },
        h('div', { className: 'dsb-hint-title' }, t('loadFailed')),
        h('div', { className: 'dsb-muted', style: { marginBottom: 8 } }, error ?? '')) : null,
      phase === 'empty-session' ? h('div', { key: 'nosession', className: 'dsb-hint' }, h('div', { className: 'dsb-hint-title' }, t('noSession'))) : null,
      phase === 'ready' && doc.elements.length === 0 && editing === null
        ? h('div', { key: 'empty', className: 'dsb-hint' },
          h('div', { className: 'dsb-hint-title' }, t('empty')),
          h('div', null, t('emptyHint')))
        : null,
      ))

      if (phase === 'error') {
        children.push(h('div', { key: 'retry', style: { position: 'absolute', left: '50%', top: '58%', transform: 'translateX(-50%)', zIndex: 5 } },
          h('button', { type: 'button', className: 'dsb-ghost', onClick: () => setReloadKey((key) => key + 1) }, t('retry'))))
      }

      if (selection.length > 0) {
        const picked = selectedElements.length === 1 ? selectedElements[0] : null
        // A pin carries no thread of its own: it shows the thread of the
        // element it marks, so annotating a card and annotating its pin are one
        // conversation.
        const single = picked !== null && picked.type === 'pin' && picked.targetId !== undefined
          ? (doc.elements.find((candidate) => candidate.id === picked.targetId) ?? picked)
          : picked
        const comments = single === null ? [] : (single.comments ?? [])
        children.push(h('div', { key: 'sheet', className: 'dsb-sheet', onPointerDown: (event) => event.stopPropagation() },
          h('div', { className: 'dsb-sheet-head' },
            h('span', { className: 'dsb-sheet-title' },
              single === null
                ? `${t('selected')} ${selectedElements.length} ${t('elements')}`
                : picked !== null && picked.type === 'pin'
                  ? `${t('pinTarget')} · ${single.type}`
                  : `${single.type} · ${single.author === 'agent' ? t('authorAgent') : t('authorUser')}`),
            single !== null ? h('span', { className: 'dsb-chip' }, single.id) : null,
            h('span', { style: { flex: '1 1 auto' } }),
            single !== null && (single.type === 'text' || single.type === 'note' || single.type === 'card')
              ? h('button', {
                type: 'button',
                className: 'dsb-ghost',
                onClick: () => setEditing({ id: single.id, value: single.type === 'card' ? (single.markdown ?? '') : (single.text ?? '') }),
              }, h(Icon, { name: 'pen' }), t('edit'))
              : null,
            selection.length > 1 ? h('button', { type: 'button', className: 'dsb-ghost', onClick: groupSelection }, h(Icon, { name: 'group' }), t('group')) : null,
            single !== null && typeof single.groupId === 'string' ? h('button', { type: 'button', className: 'dsb-ghost', onClick: ungroupSelection }, t('ungroup')) : null,
            h('button', { type: 'button', className: 'dsb-ghost dsb-danger', onClick: deleteSelection, title: t('delete'), 'aria-label': t('delete') }, h(Icon, { name: 'trash' })),
            h('button', { type: 'button', className: 'dsb-ghost', onClick: () => setSelection([]), title: t('close'), 'aria-label': t('close') }, h(Icon, { name: 'close' }))),
          h('div', { className: 'dsb-sheet-body' },
            selection.length > 1 ? h('div', { className: 'dsb-row' },
              h('button', { type: 'button', className: 'dsb-ghost', onClick: () => align('left'), title: t('alignLeft') }, '⇤'),
              h('button', { type: 'button', className: 'dsb-ghost', onClick: () => align('centerX'), title: t('alignCenterX') }, '↔'),
              h('button', { type: 'button', className: 'dsb-ghost', onClick: () => align('right'), title: t('alignRight') }, '⇥'),
              h('button', { type: 'button', className: 'dsb-ghost', onClick: () => align('top'), title: t('alignTop') }, '⇧'),
              h('button', { type: 'button', className: 'dsb-ghost', onClick: () => align('centerY'), title: t('alignCenterY') }, '↕'),
              h('button', { type: 'button', className: 'dsb-ghost', onClick: () => align('bottom'), title: t('alignBottom') }, '⇩')) : null,
            single !== null ? h('div', { className: 'dsb-row dsb-muted' },
              h('span', null, `${t('thread')} · ${comments.length}`)) : null,
            comments.length > 0
              ? h('div', { className: 'dsb-thread' },
                comments.map((comment) => h('div', { key: comment.id, className: `dsb-comment${comment.author === 'agent' ? ' dsb-comment-agent' : ''}` },
                  h('span', { className: 'dsb-comment-who' }, comment.author === 'agent' ? t('authorAgent') : t('authorUser')),
                  h('span', { className: 'dsb-comment-text' }, comment.text))))
              : (single !== null ? h('div', { className: 'dsb-muted' }, t('noComments')) : null),
            single !== null ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              h('textarea', {
                className: 'dsb-input',
                placeholder: t('commentPlaceholder'),
                value: commentDraft,
                onChange: (event) => setCommentDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    addComment(commentDraft)
                  }
                },
              }),
              h('div', { className: 'dsb-row' },
                h('button', { type: 'button', className: 'dsb-ghost', disabled: commentDraft.trim() === '', onClick: () => addComment(commentDraft) }, h(Icon, { name: 'comment' }), t('addComment')),
                h('button', { type: 'button', className: 'dsb-primary', disabled: busy === true, onClick: sendToAgent }, h(Icon, { name: 'send' }), t('send')))) : null)))
      }

      if (showHelp) {
        children.push(h('div', { key: 'help', className: 'dsb-status', style: { bottom: 12, maxWidth: '92%' } }, t('help')))
      }
      if (status !== null) {
        children.push(h('div', { key: 'status', className: 'dsb-status', role: 'status' }, status))
      }

      return h('div', { className: 'dsb-root', 'data-dsb-tab': tab.id }, children)
    }

    /** Client services, captured at apply time so a component can reach them. */    /** Client services, captured at apply time so a component can reach them. */
    const services = { current: null }

    /**
     * Session-header button that opens the board tab.
     * @param {object} props - standard props plus `openBoard` and `t`.
     * @returns {object} button element.
     */
    function BoardHeaderButton({ openBoard, t }) {
      return h('button', {
        type: 'button',
        className: 'dsb-btn',
        title: typeof t === 'function' ? t('open') : 'Board',
        'aria-label': typeof t === 'function' ? t('open') : 'Board',
        onClick: openBoard,
      }, h(Icon, { name: 'board', size: 17 }))
    }

    /** Guide artwork for the right Sidebar's guide page. */
    function BoardGuideIcon() {
      return h(Icon, { name: 'board', size: 18 })
    }

    const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'sessions', 'remote', 'remote.userQuestions', 'layout']

    /**
     * Client plugin body.
     * @param {object} ctx - Client Cordis context.
     */
    function apply(ctx) {
      services.current = ctx
      ctx.effect(() => ctx.locale.register(NS, DICT), 'dsh-board: dictionaries')

      /** @param {string} key - copy key. @returns {string} the text in the current language. */
      const t = (key) => {
        try {
          const value = ctx.locale.bind(NS)(key)
          return typeof value === 'string' && value !== '' ? value : key
        } catch {
          return key
        }
      }

      // One page-type tab: reached from the Sidebar guide and from the Session
      // header button. `extension` is the band a type from outside the product
      // declares, which is what this is.
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: ID,
        kind: KIND,
        priority: 'extension',
        keepMounted: true,
        title: () => t('title'),
        guide: [{
          id: 'board',
          order: 30,
          title: () => t('title'),
          description: () => t('guide'),
          icon: BoardGuideIcon,
        }],
      }), 'dsh-board: tab type')

      ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: ID,
        locale: NS,
      }, BoardTab))

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: ID,
        order: -6,
        locale: NS,
        inject: () => ({
          openBoard: () => {
            try {
              ctx.sidebarRight.openTab(KIND)
            } catch {
              // The Sidebar is not mounted in this frame; there is nothing to
              // open and nothing worth telling the user.
            }
          },
        }),
      }, BoardHeaderButton))
    }

    return { inject, apply }
  },
})
