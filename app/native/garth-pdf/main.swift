// garth-pdf: reads PDFs (recognizing text on scanned pages) and fills them in. Mac only (PDFKit + Vision).
//
//   garth-pdf read <file.pdf> [--pages 1,3-5]   → JSON: text lines, blanks to fill, form fields (points, top-left origin)
//   garth-pdf fill <file.pdf> <out.pdf> <answers.json>
//        answers: { "fields": { "<field name>": "value" | true }, "marks": [{ "page": 1, "x":, "y":, "w":, "h":, "text":, "kind": "text"|"check" }] }
//   garth-pdf render <file.pdf> <page> <out.png>
import AppKit
import Foundation
import PDFKit
import Vision

struct Line: Codable { let t: String; let x, y, w, h: Double }
struct Blank: Codable { let x, y, w, h: Double; let kind: String }
struct Field: Codable { let name: String; let type: String; let value: String; let options: [String]?; let page: Int; let x, y, w, h: Double }
struct PageOut: Codable { let n: Int; let width, height: Double; let ocr: Bool; let lines: [Line]; let blanks: [Blank] }
struct ReadOut: Codable { let pageCount: Int; let pages: [PageOut]; let fields: [Field] }
struct Mark: Codable { let page: Int; let x, y, w, h: Double; let text: String; let kind: String }
struct Answers: Codable { let fields: [String: String]?; let marks: [Mark]? }

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
  exit(1)
}
func emit<T: Encodable>(_ v: T) {
  let e = JSONEncoder()
  e.outputFormatting = [.withoutEscapingSlashes]
  FileHandle.standardOutput.write(try! e.encode(v))
}
func r1(_ v: CGFloat) -> Double { (Double(v) * 10).rounded() / 10 }

func open(_ path: String) -> PDFDocument {
  guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else { fail("That file isn't a PDF Garth can open.") }
  if doc.isLocked { fail("This PDF is password-protected.") }
  return doc
}

/// Page as pixels, white background, `scale` pixels per point.
func bitmap(_ page: PDFPage, scale: CGFloat) -> (CGImage, [UInt8], Int, Int) {
  let box = page.bounds(for: .mediaBox)
  let w = Int(box.width * scale), h = Int(box.height * scale)
  var data = [UInt8](repeating: 255, count: w * h * 4)
  let ctx = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.setFillColor(.white)
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.scaleBy(x: scale, y: scale)
  ctx.translateBy(x: -box.minX, y: -box.minY)
  page.draw(with: .mediaBox, to: ctx)
  return (ctx.makeImage()!, data, w, h)
}

/// Text lines: the PDF's own text when it has some, otherwise recognized from the page image.
func textLines(_ page: PDFPage, image: CGImage, box: CGRect) -> ([Line], Bool) {
  let own = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  if own.count >= 20, let sel = page.selection(for: box) {
    var out: [Line] = []
    for s in sel.selectionsByLine() {
      let t = (s.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      if t.isEmpty { continue }
      let b = s.bounds(for: page)
      out.append(Line(t: t, x: r1(b.minX - box.minX), y: r1(box.maxY - b.maxY), w: r1(b.width), h: r1(b.height)))
    }
    if !out.isEmpty { return (out, false) }
  }
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = true
  try? VNImageRequestHandler(cgImage: image).perform([req])
  let lines = (req.results ?? []).compactMap { o -> Line? in
    guard let c = o.topCandidates(1).first else { return nil }
    let b = o.boundingBox
    return Line(t: c.string, x: r1(b.minX * box.width), y: r1((1 - b.maxY) * box.height), w: r1(b.width * box.width), h: r1(b.height * box.height))
  }
  return (lines, true)
}

/// Underlines to write on and small boxes to tick, found in the page image.
func findBlanks(_ px: [UInt8], w: Int, h: Int, scale: CGFloat, lines: [Line], pageW: Double) -> [Blank] {
  @inline(__always) func dark(_ x: Int, _ y: Int) -> Bool {
    let i = (y * w + x) * 4
    // scanned rules are often mid-grey
    return (Int(px[i]) + Int(px[i + 1]) + Int(px[i + 2])) < 3 * 175
  }
  let s = Double(scale)
  let minRun = Int(28 * s)
  // horizontal runs per pixel row (small gaps allowed: scans break lines)
  var runs: [(y: Int, x0: Int, x1: Int)] = []
  for y in 0..<h {
    var x = 0
    while x < w {
      if !dark(x, y) { x += 1; continue }
      let start = x
      var end = x
      var gap = 0
      x += 1
      while x < w {
        if dark(x, y) { end = x; gap = 0 } else { gap += 1; if gap > 2 { break } }
        x += 1
      }
      if end - start >= minRun { runs.append((y, start, end)) }
    }
  }
  // stack runs from neighbouring rows into one line
  var segs: [(y0: Int, y1: Int, x0: Int, x1: Int)] = []
  for r in runs {
    if let i = segs.lastIndex(where: { r.y - $0.y1 <= 1 && r.y >= $0.y0 && min($0.x1, r.x1) - max($0.x0, r.x0) > min(r.x1 - r.x0, $0.x1 - $0.x0) * 7 / 10 }) {
      segs[i] = (segs[i].y0, r.y, min(segs[i].x0, r.x0), max(segs[i].x1, r.x1))
    } else { segs.append((r.y, r.y, r.x0, r.x1)) }
  }
  // scans break long lines into pieces: join pieces on the same row with small gaps
  segs.sort { ($0.y0, $0.x0) < ($1.y0, $1.x0) }
  let maxGap = Int(12 * s), rowTol = Int(2 * s)
  var changed = true
  while changed {
    changed = false
    var joined: [(y0: Int, y1: Int, x0: Int, x1: Int)] = []
    for g in segs {
      if let i = joined.firstIndex(where: { abs($0.y0 - g.y0) <= rowTol && max(g.x0 - $0.x1, $0.x0 - g.x1) <= maxGap }) {
        joined[i] = (min(joined[i].y0, g.y0), max(joined[i].y1, g.y1), min(joined[i].x0, g.x0), max(joined[i].x1, g.x1))
        changed = true
      } else { joined.append(g) }
    }
    segs = joined
  }
  func verticalAt(_ x: Int, _ y0: Int, _ y1: Int) -> Bool {
    // a box edge: dark pixels going up or down from the line's end for 8+ points
    let reach = Int(8 * s)
    for dx in -2...2 {
      let xx = x + dx
      if xx < 0 || xx >= w { continue }
      var up = 0, down = 0
      var y = y0 - 1
      while y >= 0 && dark(xx, y) && up < reach { up += 1; y -= 1 }
      y = y1 + 1
      while y < h && dark(xx, y) && down < reach { down += 1; y += 1 }
      if up >= reach || down >= reach { return true }
    }
    return false
  }
  var out: [Blank] = []
  for g in segs {
    let thick = Double(g.y1 - g.y0 + 1) / s
    let x = Double(g.x0) / s, y = Double(g.y0) / s, len = Double(g.x1 - g.x0) / s
    if thick > 4 || len > pageW * 0.9 { continue }
    // box and table borders have sides
    if verticalAt(g.x0, g.y0, g.y1) && verticalAt(g.x1, g.y0, g.y1) { continue }
    // an underline under words (headings), not a blank to write on
    if lines.contains(where: { l in
      let bottom = l.y + l.h
      return y - bottom > -6 && y - bottom < 5 && x >= l.x - 4 && x + len <= l.x + l.w + 4 && !l.t.contains("__")
    }) { continue }
    out.append(Blank(x: r1(CGFloat(x)), y: r1(CGFloat(y)), w: r1(CGFloat(len)), h: r1(CGFloat(thick)), kind: "line"))
  }
  return out + boxes(dark: dark, w: w, h: h, scale: s, lines: lines)
}

/// Checkboxes: small hollow squares (top and bottom edges of the same length, two sides, light inside).
func boxes(dark: (Int, Int) -> Bool, w: Int, h: Int, scale s: Double, lines: [Line]) -> [Blank] {
  let minSide = Int(6 * s), maxSide = Int(22 * s)
  var edges: [Int: [(x0: Int, x1: Int)]] = [:]
  for y in 0..<h {
    var x = 0
    while x < w {
      if !dark(x, y) { x += 1; continue }
      let start = x
      while x < w && dark(x, y) { x += 1 }
      let len = x - start
      if len >= minSide && len <= maxSide { edges[y, default: []].append((start, x - 1)) }
    }
  }
  var out: [Blank] = []
  for y in edges.keys.sorted() {
    for top in edges[y]! {
      let side = top.x1 - top.x0
      // the bottom edge: same span, one side-length lower
      guard (y + side - 2...y + side + 2).contains(where: { yb in (edges[yb] ?? []).contains { abs($0.x0 - top.x0) <= 2 && abs($0.x1 - top.x1) <= 2 } }) else { continue }
      let yb = y + side
      var sides = 0, inside = 0, insideLight = 0
      for yy in y...min(yb, h - 1) {
        let l = (top.x0...top.x0 + 2).contains { dark($0, yy) }, r = (top.x1 - 2...top.x1).contains { dark($0, yy) }
        if l && r { sides += 1 }
      }
      let m = max(2, side / 4)
      if yb - m > y + m && top.x1 - m > top.x0 + m {
        for yy in (y + m)..<(yb - m) { for xx in (top.x0 + m)..<(top.x1 - m) { inside += 1; if !dark(xx, yy) { insideLight += 1 } } }
      }
      guard Double(sides) >= Double(side) * 0.8, inside > 0, Double(insideLight) / Double(inside) > 0.6 else { continue }
      let bx = Double(top.x0) / s, by = Double(y) / s, bw = Double(side) / s
      if out.contains(where: { abs($0.x - bx) < 4 && abs($0.y - by) < 4 }) { continue }
      // letters like "o" or "D" inside a line of text aren't boxes (text recognition may read a box at a line's start as "•")
      let cx = bx + bw / 2, cy = by + bw / 2
      if lines.contains(where: { l in
        guard cx > l.x + 2 && cx < l.x + l.w - 2 && cy > l.y && cy < l.y + l.h else { return false }
        let atStart = cx < l.x + bw + 3 && ["•", "□", "☐", "■", "o ", "O ", "0 ", "[ ]"].contains { l.t.hasPrefix($0) }
        return !atStart
      }) { continue }
      out.append(Blank(x: r1(CGFloat(bx)), y: r1(CGFloat(by)), w: r1(CGFloat(bw)), h: r1(CGFloat(bw)), kind: "box"))
    }
  }
  return out
}

func formFields(_ doc: PDFDocument) -> [Field] {
  var out: [Field] = []
  var seen = Set<String>()
  for i in 0..<doc.pageCount {
    guard let page = doc.page(at: i) else { continue }
    let box = page.bounds(for: .mediaBox)
    for a in page.annotations where a.type == "Widget" {
      guard let name = a.fieldName, !name.isEmpty else { continue }
      let key = "\(name)#\(a.buttonWidgetStateString)"
      if seen.contains(key) { continue }
      seen.insert(key)
      let type: String
      var value = a.widgetStringValue ?? ""
      var options: [String]? = nil
      switch a.widgetFieldType {
      case .button:
        if a.widgetControlType == .checkBoxControl { type = "checkbox"; value = a.buttonWidgetState == .onState ? "on" : "off" }
        else if a.widgetControlType == .radioButtonControl { type = "radio"; value = a.buttonWidgetState == .onState ? a.buttonWidgetStateString : ""; options = [a.buttonWidgetStateString] }
        else { continue }
      case .choice: type = "choice"; options = a.choices
      case .signature: type = "signature"
      default: type = "text"
      }
      let b = a.bounds
      out.append(Field(name: name, type: type, value: value, options: options, page: i + 1, x: r1(b.minX - box.minX), y: r1(box.maxY - b.maxY), w: r1(b.width), h: r1(b.height)))
    }
  }
  return out
}

func parsePages(_ spec: String?, count: Int) -> [Int] {
  guard let spec = spec else { return Array(1...max(count, 1)).filter { $0 <= count } }
  var out: [Int] = []
  for part in spec.split(separator: ",") {
    let ends = part.split(separator: "-").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
    if ends.count == 1 { out.append(ends[0]) } else if ends.count == 2 && ends[0] <= ends[1] { out.append(contentsOf: ends[0]...ends[1]) }
  }
  return out.filter { $0 >= 1 && $0 <= count }
}

func read(_ path: String, pages spec: String?) {
  let doc = open(path)
  var pages: [PageOut] = []
  for n in parsePages(spec, count: doc.pageCount) {
    guard let page = doc.page(at: n - 1) else { continue }
    let box = page.bounds(for: .mediaBox)
    let (img, px, w, h) = bitmap(page, scale: 2)
    let (lines, ocr) = textLines(page, image: img, box: box)
    let blanks = findBlanks(px, w: w, h: h, scale: 2, lines: lines, pageW: Double(box.width))
    pages.append(PageOut(n: n, width: r1(box.width), height: r1(box.height), ocr: ocr, lines: lines, blanks: blanks))
  }
  emit(ReadOut(pageCount: doc.pageCount, pages: pages, fields: formFields(doc)))
}

func fill(_ path: String, _ outPath: String, _ answersPath: String) {
  let doc = open(path)
  guard let data = FileManager.default.contents(atPath: answersPath), let answers = try? JSONDecoder().decode(Answers.self, from: data) else { fail("Couldn't read the answers.") }
  var filled = 0
  // real form fields: set their values, they stay editable
  for (name, value) in answers.fields ?? [:] {
    var hit = false
    for i in 0..<doc.pageCount {
      for a in doc.page(at: i)?.annotations ?? [] where a.fieldName == name {
        switch a.widgetFieldType {
        case .button:
          let on = ["on", "yes", "true", "x", "1", "checked"].contains(value.lowercased()) || value == a.buttonWidgetStateString
          a.buttonWidgetState = on ? .onState : .offState
        default: a.widgetStringValue = value
        }
        hit = true
      }
    }
    if hit { filled += 1 }
  }
  // anything else: text written onto the page, as annotations people can still move or fix in Preview
  for m in answers.marks ?? [] {
    guard let page = doc.page(at: m.page - 1) else { continue }
    let box = page.bounds(for: .mediaBox)
    let check = m.kind == "check"
    var size: CGFloat = check ? CGFloat(min(m.w, m.h)) * 0.9 : 10.5
    let font = { NSFont(name: "Helvetica", size: size) ?? NSFont.systemFont(ofSize: size) }
    // shrink long answers to fit the blank
    if !check && m.w > 0 {
      while size > 6.5 && (m.text as NSString).size(withAttributes: [.font: font()]).width > CGFloat(m.w) - 4 { size -= 0.5 }
    }
    let textW = (m.text as NSString).size(withAttributes: [.font: font()]).width
    let height = size * 1.35
    let rect: CGRect
    if check {
      rect = CGRect(x: box.minX + CGFloat(m.x) + CGFloat(m.w) / 2 - textW / 2 - 2, y: box.maxY - CGFloat(m.y) - CGFloat(m.h) / 2 - height / 2, width: textW + 4, height: height)
    } else {
      // sits on the line: the line's y is where the text's baseline goes
      rect = CGRect(x: box.minX + CGFloat(m.x) + 2, y: box.maxY - CGFloat(m.y) + 0.5, width: max(textW + 6, CGFloat(m.w)), height: height)
    }
    let a = PDFAnnotation(bounds: rect, forType: .freeText, withProperties: nil)
    a.contents = m.text
    a.font = font()
    a.fontColor = NSColor(calibratedRed: 0.05, green: 0.1, blue: 0.35, alpha: 1)
    a.color = .clear
    let border = PDFBorder()
    border.lineWidth = 0
    a.border = border
    a.alignment = check ? .center : .left
    a.shouldPrint = true
    page.addAnnotation(a)
    filled += 1
  }
  if !doc.write(to: URL(fileURLWithPath: outPath)) { fail("Couldn't save the filled-in PDF.") }
  emit(["filled": filled])
}

func render(_ path: String, _ pageNo: Int, _ outPath: String) {
  let doc = open(path)
  guard let page = doc.page(at: pageNo - 1) else { fail("There's no page \(pageNo).") }
  let (img, _, _, _) = bitmap(page, scale: 1.5)
  let rep = NSBitmapImageRep(cgImage: img)
  guard let png = rep.representation(using: .png, properties: [:]), (try? png.write(to: URL(fileURLWithPath: outPath))) != nil else { fail("Couldn't save the picture.") }
  emit(["ok": true])
}

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "read" where args.count >= 3:
  let i = args.firstIndex(of: "--pages")
  read(args[2], pages: i.map { args.count > $0 + 1 ? args[$0 + 1] : "" })
case "fill" where args.count >= 5: fill(args[2], args[3], args[4])
case "render" where args.count >= 5: render(args[2], Int(args[3]) ?? 1, args[4])
default: fail("usage: garth-pdf read <pdf> [--pages 1,3-5] | fill <pdf> <out.pdf> <answers.json> | render <pdf> <page> <out.png>")
}
