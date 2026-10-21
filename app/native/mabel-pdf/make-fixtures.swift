// Makes the test PDFs in test/fixtures: a scanned-looking form (one image per page, no text) and a fillable form.
//   swiftc native/mabel-pdf/make-fixtures.swift -o /tmp/mk && /tmp/mk test/fixtures
import AppKit
import PDFKit

let dir = CommandLine.arguments[1]
let W: CGFloat = 612, H: CGFloat = 792

func drawForm(_ ctx: CGContext) {
  NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
  let font = NSFont(name: "Helvetica", size: 12)!, small = NSFont(name: "Helvetica", size: 10)!, bold = NSFont(name: "Helvetica-Bold", size: 14)!
  func text(_ s: String, _ x: CGFloat, _ yTop: CGFloat, _ f: NSFont = font) { (s as NSString).draw(at: CGPoint(x: x, y: H - yTop - f.ascender), withAttributes: [.font: f]) }
  func line(_ x: CGFloat, _ yTop: CGFloat, _ w: CGFloat, _ t: CGFloat = 1) { ctx.setFillColor(gray: 0.1, alpha: 1); ctx.fill(CGRect(x: x, y: H - yTop - t, width: w, height: t)) }
  ctx.setFillColor(.white); ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
  text("LEAVE REQUEST FORM", 200, 60, bold)
  text("Section A", 60, 110, bold); line(60, 127, 68)            // underlined heading: not a blank
  text("Name", 60, 160); line(130, 172, 180); line(340, 172, 180)  // two blanks on one row
  text("Last name", 130, 176, small); text("First name", 340, 176, small)
  text("Phone", 60, 215); line(130, 227, 180)
  // a box around a table: its edges aren't blanks
  ctx.setStrokeColor(gray: 0.45, alpha: 1); ctx.setLineWidth(1); ctx.stroke(CGRect(x: 50, y: H - 380, width: 510, height: 110))
  text("Date Leave to Begin", 230, 285, small); text("Date Leave to End", 390, 285, small)
  text("Medical Leave", 60, 320); line(230, 332, 110); line(390, 332, 110)
  text("Intermittent", 60, 352); line(230, 364, 110); line(390, 364, 110)
  // a checkbox with its label to the right
  ctx.setStrokeColor(gray: 0.1, alpha: 1); ctx.stroke(CGRect(x: 60, y: H - 432, width: 11, height: 11))
  text("I agree to the terms", 80, 420)
  line(60, 500, 200); text("Employee Signature", 60, 504, small); line(340, 500, 180); text("Date", 340, 504, small)
}

// scanned: render to pixels, then a PDF page that only holds that picture
let scale: CGFloat = 2.5
let bmp = CGContext(data: nil, width: Int(W * scale), height: Int(H * scale), bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
bmp.scaleBy(x: scale, y: scale)
drawForm(bmp)
let image = bmp.makeImage()!
var media = CGRect(x: 0, y: 0, width: W, height: H)
let scanned = CGContext(URL(fileURLWithPath: "\(dir)/form-scanned.pdf") as CFURL, mediaBox: &media, nil)!
scanned.beginPDFPage(nil); scanned.draw(image, in: media); scanned.endPDFPage(); scanned.closePDF()

// fillable: real text and form fields
let plainURL = URL(fileURLWithPath: "\(dir)/form-fields.pdf")
let pdf = CGContext(plainURL as CFURL, mediaBox: &media, nil)!
pdf.beginPDFPage(nil)
NSGraphicsContext.current = NSGraphicsContext(cgContext: pdf, flipped: false)
("Club Membership Form" as NSString).draw(at: CGPoint(x: 60, y: 720), withAttributes: [.font: NSFont(name: "Helvetica-Bold", size: 16)!])
("Full name" as NSString).draw(at: CGPoint(x: 60, y: 670), withAttributes: [.font: NSFont(name: "Helvetica", size: 12)!])
("Send me the newsletter" as NSString).draw(at: CGPoint(x: 80, y: 630), withAttributes: [.font: NSFont(name: "Helvetica", size: 12)!])
pdf.endPDFPage(); pdf.closePDF()
let doc = PDFDocument(url: plainURL)!
let page = doc.page(at: 0)!
let name = PDFAnnotation(bounds: CGRect(x: 140, y: 665, width: 220, height: 20), forType: .widget, withProperties: nil)
name.widgetFieldType = .text; name.fieldName = "full_name"
page.addAnnotation(name)
let box = PDFAnnotation(bounds: CGRect(x: 60, y: 628, width: 14, height: 14), forType: .widget, withProperties: nil)
box.widgetFieldType = .button; box.widgetControlType = .checkBoxControl; box.fieldName = "newsletter"
page.addAnnotation(box)
doc.write(to: plainURL)
print("ok")
