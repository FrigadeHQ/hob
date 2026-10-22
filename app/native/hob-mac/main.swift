// Hob's Mac helper for Calendar: the calendars this Mac already has (iCloud, Google, Exchange… added in
// System Settings → Internet Accounts), through EventKit. Prints JSON; errors go to stderr with exit 1.
//   hob-mac calendar-status                → {"status":"granted"|"denied"|"notDetermined"}
//   hob-mac calendar-auth                  → asks once (the system's own prompt), then the status
//   hob-mac calendars                      → [{"name","account","writable","color"}]
//   hob-mac events FROM TO [QUERY]         → events between two ISO dates, optionally matching words
//   hob-mac add-event JSON                 → {"title","start","end","calendar"?,"location"?,"notes"?,"allDay"?}
//   hob-mac mail-status | mail-auth        → may Hob talk to the Mail app? (mail-auth opens Mail and asks once)
import AppKit
import EventKit
import Foundation

let store = EKEventStore()
let iso = ISO8601DateFormatter()
iso.formatOptions = [.withInternetDateTime]
let dayIso = ISO8601DateFormatter()
dayIso.formatOptions = [.withFullDate]

func out(_ v: Any) { FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: v, options: [.sortedKeys])); print() }
func fail(_ msg: String) -> Never { FileHandle.standardError.write((msg + "\n").data(using: .utf8)!); exit(1) }
func date(_ s: String) -> Date {
  if let d = iso.date(from: s) { return d }
  if let d = dayIso.date(from: s) { return d }
  // local time without a zone: "2026-10-21T15:00:00"
  let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = .current
  for p in ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd HH:mm"] { f.dateFormat = p; if let d = f.date(from: s) { return d } }
  fail("Couldn't read the date \"\(s)\". Use a form like 2026-10-21T15:00:00.")
}

func status() -> String {
  let s = EKEventStore.authorizationStatus(for: .event)
  if #available(macOS 14.0, *) { if s == .fullAccess { return "granted" } }
  switch s {
  case .authorized: return "granted"
  case .notDetermined: return "notDetermined"
  default: return "denied"
  }
}

func needAccess() { if status() != "granted" { fail("Hob doesn't have access to Calendar yet. Allow it in System Settings → Privacy & Security → Calendars.") } }

let args = Array(CommandLine.arguments.dropFirst())
switch args.first {
case "calendar-status":
  out(["status": status()])
case "calendar-auth":
  let done = DispatchSemaphore(value: 0)
  if #available(macOS 14.0, *) { store.requestFullAccessToEvents { _, _ in done.signal() } }
  else { store.requestAccess(to: .event) { _, _ in done.signal() } }
  _ = done.wait(timeout: .now() + 120)
  out(["status": status()])
case "calendars":
  needAccess()
  out(store.calendars(for: .event).map { c in
    ["name": c.title, "account": c.source.title, "writable": c.allowsContentModifications] as [String: Any]
  })
case "events":
  needAccess()
  guard args.count >= 3 else { fail("events FROM TO [QUERY]") }
  let from = date(args[1]), to = date(args[2])
  let words = args.count > 3 ? args[3].lowercased().split(separator: " ").map(String.init) : []
  let found = store.events(matching: store.predicateForEvents(withStart: from, end: to, calendars: nil))
    .filter { e in words.isEmpty || words.allSatisfy { w in [e.title, e.location, e.notes].compactMap { $0?.lowercased() }.contains { $0.contains(w) } } }
    .sorted { $0.startDate < $1.startDate }
    .prefix(200)
  out(found.map { e in
    var o: [String: Any] = ["title": e.title ?? "(no title)", "start": iso.string(from: e.startDate), "end": iso.string(from: e.endDate), "allDay": e.isAllDay, "calendar": e.calendar.title]
    if let l = e.location, !l.isEmpty { o["location"] = l }
    if let n = e.notes, !n.isEmpty { o["notes"] = String(n.prefix(500)) }
    if let a = e.attendees, !a.isEmpty { o["attendees"] = a.compactMap { $0.name }.prefix(20).map { $0 } }
    return o
  })
case "add-event":
  needAccess()
  guard args.count >= 2, let data = args[1].data(using: .utf8), let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let title = j["title"] as? String, let start = j["start"] as? String else { fail("add-event needs a title and a start") }
  let e = EKEvent(eventStore: store)
  e.title = title
  e.startDate = date(start)
  e.isAllDay = (j["allDay"] as? Bool) ?? false
  e.endDate = (j["end"] as? String).map(date) ?? e.startDate.addingTimeInterval(3600)
  if let l = j["location"] as? String { e.location = l }
  if let n = j["notes"] as? String { e.notes = n }
  let name = j["calendar"] as? String
  let writable = store.calendars(for: .event).filter { $0.allowsContentModifications }
  guard let cal = (name.flatMap { n in writable.first { $0.title.lowercased() == n.lowercased() } }) ?? store.defaultCalendarForNewEvents ?? writable.first else {
    fail("There's no calendar Hob can add events to.")
  }
  e.calendar = cal
  do { try store.save(e, span: .thisEvent, commit: true) } catch { fail("Couldn't add the event: \(error.localizedDescription)") }
  out(["title": title, "start": iso.string(from: e.startDate), "end": iso.string(from: e.endDate), "calendar": cal.title])
case "mail-status", "mail-auth":
  let ask = args.first == "mail-auth"
  let bundle = "com.apple.mail"
  if ask, NSRunningApplication.runningApplications(withBundleIdentifier: bundle).isEmpty, let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle) {
    let started = DispatchSemaphore(value: 0)
    let cfg = NSWorkspace.OpenConfiguration(); cfg.activates = false
    NSWorkspace.shared.openApplication(at: url, configuration: cfg) { _, _ in started.signal() }
    _ = started.wait(timeout: .now() + 20)
    Thread.sleep(forTimeInterval: 1.5)
  }
  var target = AEAddressDesc()
  let id = bundle.data(using: .utf8)!
  _ = id.withUnsafeBytes { AECreateDesc(typeApplicationBundleID, $0.baseAddress, id.count, &target) }
  let r = AEDeterminePermissionToAutomateTarget(&target, typeWildCard, typeWildCard, ask)
  AEDisposeDesc(&target)
  out(["status": r == noErr ? "granted" : r == OSStatus(errAEEventNotPermitted) ? "denied" : r == OSStatus(procNotFound) ? "notRunning" : "notDetermined"])
default:
  fail("usage: hob-mac calendar-status | calendar-auth | calendars | events FROM TO [QUERY] | add-event JSON | mail-status | mail-auth")
}
