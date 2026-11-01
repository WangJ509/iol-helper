#!/usr/bin/env python3
"""產生 iPhone 捷徑「IOL 小幫手填入」。

捷徑流程（從 Safari 分享選單執行）：
  取得剪貼簿 → URL 編碼（避免引號破壞 JavaScript）→ 在網頁上執行 JavaScript（內含 official-fill.js）→ 顯示結果

用法（需 macOS 12+ 並登入 iCloud，簽署才能讓 iPhone 匯入）：
  python3 tools/build-shortcut.py
輸出 app/IOL小幫手填入.shortcut；official-fill.js 修改後要重新執行並重新安裝捷徑。
"""
import plistlib
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "app" / "official-fill.js"
OUT = ROOT / "app" / "IOL小幫手填入.shortcut"
OBJ = "￼"  # 捷徑文字中變數的佔位字元


def fill_function_source():
    text = SRC.read_text(encoding="utf-8")
    start = text.index("async function (preset)")
    end = text.rindex("};") + 1
    src = text[start:end]
    # 與書籤相同：去掉縮排與整行註解
    return "\n".join(l.strip() for l in src.split("\n") if l.strip() and not l.strip().startswith("//"))


def utf16_len(s):
    return len(s.encode("utf-16-le")) // 2


def token_string(parts):
    """parts：字串或 {'uuid','name'}（前一個動作的輸出）。"""
    string, attachments = "", {}
    for p in parts:
        if isinstance(p, str):
            string += p
        else:
            attachments["{%d, 1}" % utf16_len(string)] = {"OutputUUID": p["uuid"], "OutputName": p["name"], "Type": "ActionOutput"}
            string += OBJ
    return {"Value": {"string": string, "attachmentsByRange": attachments}, "WFSerializationType": "WFTextTokenString"}


def attachment(value):
    return {"Value": value, "WFSerializationType": "WFTextTokenAttachment"}


def build():
    clip, enc, js = (str(uuid.uuid4()).upper() for _ in range(3))
    code_head = "var IOL_DATA = decodeURIComponent(\""
    code_tail = ("\".replace(/\\+/g, ' '));\n(" + fill_function_source() + ")(IOL_DATA).then("
                 "function (r) { completion(r || '完成'); }, "
                 "function (e) { completion('IOL 小幫手發生錯誤：' + e); });")
    actions = [
        {"WFWorkflowActionIdentifier": "is.workflow.actions.getclipboard",
         "WFWorkflowActionParameters": {"UUID": clip}},
        {"WFWorkflowActionIdentifier": "is.workflow.actions.urlencode",
         "WFWorkflowActionParameters": {"UUID": enc, "WFEncodeMode": "Encode",
                                        "WFInput": token_string([{"uuid": clip, "name": "Clipboard"}])}},
        {"WFWorkflowActionIdentifier": "is.workflow.actions.runjavascriptonwebpage",
         "WFWorkflowActionParameters": {"UUID": js,
                                        "WFInput": attachment({"Type": "ExtensionInput"}),
                                        "WFJavaScript": token_string([code_head, {"uuid": enc, "name": "URL Encoded Text"}, code_tail])}},
        {"WFWorkflowActionIdentifier": "is.workflow.actions.showresult",
         "WFWorkflowActionParameters": {"Text": token_string([{"uuid": js, "name": "Result of JavaScript"}])}},
    ]
    return {
        "WFWorkflowClientVersion": "2302.0.4",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4282601983, "WFWorkflowIconGlyphNumber": 59511},
        "WFWorkflowTypes": ["ActionExtension"],
        "WFWorkflowInputContentItemClasses": ["WFSafariWebPageContentItem"],
        "WFWorkflowHasShortcutInputVariables": True,
        "WFWorkflowImportQuestions": [],
        "WFWorkflowActions": actions,
    }


def main():
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "IOL小幫手填入.shortcut"
        with raw.open("wb") as f:
            plistlib.dump(build(), f, fmt=plistlib.FMT_BINARY)
        r = subprocess.run(["shortcuts", "sign", "--mode", "anyone", "--input", str(raw), "--output", str(OUT)],
                           capture_output=True, text=True)
        if r.returncode != 0 or not OUT.exists():
            sys.exit("簽署失敗（需 macOS 12+ 並登入 iCloud）：\n" + r.stderr)
    print(f"已輸出 {OUT.relative_to(ROOT)}（{OUT.stat().st_size // 1024} KB）")


if __name__ == "__main__":
    main()
