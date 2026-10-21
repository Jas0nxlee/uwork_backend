// Private clipboard bytes stay in this process. Only verification booleans leave it.
import AppKit
import CoreServices
import Foundation

struct ClipboardSnapshot {
    let items: [[(NSPasteboard.PasteboardType, Data)]]
    let complete: Bool
    init(_ board: NSPasteboard) {
        var ok = true
        items = (board.pasteboardItems ?? []).map { item in
            item.types.compactMap { type in
                guard let data = item.data(forType: type) else { ok = false; return nil }
                return (type, data)
            }
        }
        complete = ok
    }
    func matches(_ board: NSPasteboard) -> Bool {
        let current = ClipboardSnapshot(board)
        guard complete && current.complete && items.count == current.items.count else { return false }
        return zip(items, current.items).allSatisfy { left, right in
            let a = Dictionary(uniqueKeysWithValues: left.map { ($0.0.rawValue, $0.1) })
            let b = Dictionary(uniqueKeysWithValues: right.map { ($0.0.rawValue, $0.1) })
            return a == b
        }
    }
    func restore(_ board: NSPasteboard) -> Bool {
        guard complete else { return false }
        let values = items.map { row -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (type, data) in row { item.setData(data, forType: type) }
            return item
        }
        board.clearContents()
        if !values.isEmpty && !board.writeObjects(values) { return false }
        return matches(board)
    }
}

func emit(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
    fflush(stdout)
}

func ownedShareVariants(_ canonical: String, expected: String) -> Set<String>? {
    guard let parts = URLComponents(string: canonical), parts.scheme == "https",
          parts.host == "127.0.0.1", let port = parts.port, port > 0 && port < 65536,
          parts.user == nil && parts.password == nil && parts.query == nil && parts.fragment == nil,
          parts.path.hasPrefix("/share/") else { return nil }
    let code = String(parts.path.dropFirst("/share/".count))
    guard !code.isEmpty && code.count <= 200 && code.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else { return nil }
    var localized = parts
    localized.path = "/cn/share/" + code
    guard let local = localized.string else { return nil }
    let values: Set<String> = [canonical, local]
    return values.contains(expected) ? values : nil
}

func restoreOwnedClipboard(_ board: NSPasteboard, saved: ClipboardSnapshot,
                           ownedTexts: Set<String>, copiedCount: Int?) -> String {
    if saved.matches(board) { return "unchanged" }
    if let text = board.string(forType: .string), ownedTexts.contains(text),
       copiedCount == nil || board.changeCount == copiedCount! {
        return saved.restore(board) ? "restored" : "restore-failed"
    }
    return "later-user-change-preserved"
}

if CommandLine.arguments.contains("--self-test") {
    let board = NSPasteboard.withUniqueName()
    let first = NSPasteboardItem(), second = NSPasteboardItem()
    first.setString("original-owned-text", forType: .string)
    first.setData(Data([0, 1, 2, 255]), forType: NSPasteboard.PasteboardType("com.uwork.test.bytes"))
    second.setString("second-owned-item", forType: .string)
    board.writeObjects([first, second])
    let saved = ClipboardSnapshot(board)
    precondition(saved.complete && saved.items.count == 2)
    board.clearContents(); board.setString("test-url", forType: .string)
    precondition(saved.restore(board))
    let canonical = "https://127.0.0.1:1234/share/owned-test"
    let localized = "https://127.0.0.1:1234/cn/share/owned-test"
    let variants = ownedShareVariants(canonical, expected: localized)!
    board.clearContents(); board.setString(localized, forType: .string)
    // 即使主断言误把中文链接与规范链接比较，清理仍必须识别同一测试分享并恢复原多格式内容。
    precondition(board.string(forType: .string) != canonical)
    precondition(restoreOwnedClipboard(board, saved: saved, ownedTexts: variants, copiedCount: nil) == "restored")
    precondition(saved.matches(board))
    board.clearContents(); board.setString("owned-copy", forType: .string)
    let ownedCount = board.changeCount
    board.clearContents(); board.setString("later-user-copy", forType: .string)
    precondition(board.changeCount != ownedCount && board.string(forType: .string) == "later-user-copy")
    precondition(restoreOwnedClipboard(board, saved: saved, ownedTexts: ["owned-copy"], copiedCount: ownedCount) == "later-user-change-preserved")
    precondition(board.string(forType: .string) == "later-user-copy")
    board.releaseGlobally()
    emit(["passed": true, "multipleItemsAndFormatsRestored": true, "localeMismatchStillRestores": true, "concurrentChangePreserved": true])
    exit(0)
}

let protocolOnly = CommandLine.arguments.contains("--protocol-only")
let board = protocolOnly ? NSPasteboard.withUniqueName() : NSPasteboard.general
var initialCount = board.changeCount
var saved = ClipboardSnapshot(board)
let originalHandler = LSCopyDefaultHandlerForURLScheme("zcode" as CFString)?.takeRetainedValue()
var copiedCount: Int? = nil
var expectedText: String? = nil
var ownedTexts: Set<String> = []
var finished = false

func finish() {
    if finished { return }
    finished = true
    let clipboard = restoreOwnedClipboard(board, saved: saved, ownedTexts: ownedTexts, copiedCount: copiedCount)
    var protocolRestored = false
    if let original = originalHandler {
        let now = LSCopyDefaultHandlerForURLScheme("zcode" as CFString)?.takeRetainedValue()
        // 只回滚本预览包造成的关联变更；用户在期间主动改到第三个应用时保留其选择。
        if now == ("dev.zcode.app.preview" as CFString) && now != original {
            _ = LSSetDefaultHandlerForURLScheme("zcode" as CFString, original)
        }
        for _ in 0..<40 {
            if LSCopyDefaultHandlerForURLScheme("zcode" as CFString)?.takeRetainedValue() == original {
                protocolRestored = true; break
            }
            Thread.sleep(forTimeInterval: 0.05)
        }
    }
    if protocolOnly { board.releaseGlobally() }
    emit(["event": "restored", "clipboard": clipboard, "protocolRestored": protocolRestored,
          "usesSystemClipboard": !protocolOnly])
}

emit(["event": "ready", "clipboardComplete": saved.complete && board.changeCount == initialCount,
      "clipboardItemCount": saved.items.count, "hasProtocolHandler": originalHandler != nil,
      "usesSystemClipboard": !protocolOnly])
while let line = readLine() {
    guard let data = line.data(using: .utf8),
          let command = try? JSONSerialization.jsonObject(with: data) as? [String: String],
          let op = command["op"] else { emit(["error": "invalid-command"]); continue }
    switch op {
    case "arm-copy":
        guard expectedText == nil, let text = command["text"], let canonical = command["canonical"],
              let variants = ownedShareVariants(canonical, expected: text) else {
            emit(["error": "owned-url-required"]); continue
        }
        initialCount = board.changeCount
        saved = ClipboardSnapshot(board)
        let ok = saved.complete && board.changeCount == initialCount
        if ok { expectedText = text; ownedTexts = variants }
        emit(["ok": ok])
    case "before-copy":
        emit(["ok": saved.complete && board.changeCount == initialCount])
    case "expect-copy":
        guard let text = command["text"], text == expectedText else {
            emit(["error": "owned-url-required"]); continue
        }
        let matches = board.string(forType: .string) == text
        if matches { copiedCount = board.changeCount; expectedText = text }
        emit(["clipboardMatches": matches])
    case "restore": finish()
    default: emit(["error": "unsupported-command"])
    }
}
finish()
