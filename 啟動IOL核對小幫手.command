#!/bin/zsh
# Mac 本機啟動：雙擊即可。這個視窗要保持開著；關閉視窗即停止服務。
cd "${0:A:h}" || { print "無法進入程式資料夾"; read "?按 Enter 結束"; exit 1; }
export IOL_HOST=127.0.0.1 IOL_PORT=${IOL_PORT:-8766}
URL="http://127.0.0.1:$IOL_PORT/"
LOG=$(mktemp -t iol-helper)

fail() {
  print "\n❌ $1"
  [[ -s "$LOG" ]] && { print "\n--- 錯誤訊息 ---"; cat "$LOG"; }
  read "?按 Enter 結束"; exit 1
}

# 已經有小幫手在執行 → 直接開瀏覽器
if /usr/bin/curl -fsS --max-time 1 "${URL}api/config" >/dev/null 2>&1; then
  print "小幫手已在執行中，開啟 $URL"
  /usr/bin/open "$URL"; exit 0
fi
# 連接埠被其他程式占用
if /usr/sbin/lsof -nP -iTCP:$IOL_PORT -sTCP:LISTEN >/dev/null 2>&1; then
  fail "連接埠 $IOL_PORT 已被其他程式占用。可改用：IOL_PORT=8777 ./啟動IOL核對小幫手.command"
fi
# 檢查能否讀取程式檔（macOS 隱私權限）
if ! head -c 1 server/server.py >/dev/null 2>&1; then
  fail "「終端機」沒有讀取「文件」資料夾的權限。
請到：系統設定 › 隱私權與安全性 › 檔案與資料夾 › 終端機，開啟「文件資料夾」，
然後關閉這個視窗、重新雙擊啟動檔。"
fi

print "啟動 IOL 核對小幫手…"
/usr/bin/python3 server/server.py 2>"$LOG" &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; rm -f "$LOG"' EXIT INT TERM
for i in {1..50}; do
  if /usr/bin/curl -fsS --max-time 1 "${URL}api/config" >/dev/null 2>&1; then
    print "✅ 已啟動：$URL"
    print "   這個視窗請保持開著；關閉視窗即停止服務。"
    /usr/bin/open "$URL"
    wait $SERVER_PID
    exit
  fi
  kill -0 $SERVER_PID 2>/dev/null || fail "伺服器啟動失敗。"
  sleep 0.2
done
fail "啟動逾時。"
