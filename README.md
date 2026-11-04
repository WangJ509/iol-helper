# IOL 核對小幫手

上傳 IOLMaster／A-scan／auto refraction 報告 → 依行列位置配對欄名與數值 → 左圖右清單逐項核對 → 公開公式試算＋官方網站一鍵填入。

## 啟動

**Mac**：雙擊 `啟動IOL核對小幫手.command`，瀏覽器會開啟 http://127.0.0.1:8766 。

**任何有 Python 3.8+ 的系統（含 Linux）**：

```bash
python3 server/server.py                       # 預設 127.0.0.1:8766
IOL_HOST=0.0.0.0 IOL_PORT=8766 python3 server/server.py
```

**Docker**：`docker build -t iol-helper . && docker run -p 8766:8766 iol-helper`

**GitHub Pages（不需伺服器）**：

1. 把整個資料夾推到 GitHub repo。免費帳號的 Pages 必須用公開 repo，所以程式碼與常數表都會公開。
2. 到 repo 的 Settings › Pages，Source 選 *Deploy from a branch*，Branch 選 `main`，資料夾選 `/ (root)`。
3. 網址是 `https://<帳號>.github.io/<repo>/`，會自動導向 `app/`；內建公式計算機在 `formulas/calculator.html`。

Pages 版和伺服器版功能相同，只有兩點差別：
- 不支援伺服器端 OCR（`IOL_OCR_CMD`），一律在瀏覽器內辨識。
- 無法自訂回應標頭（no-store 等），頁面內已用 meta 設定 no-referrer。

照片與病患資料只存在使用者自己瀏覽器的記憶體中，不會傳到 GitHub。`.gitignore` 已排除 PDF 與圖片檔，避免不小心把報告推上公開 repo。

部署到伺服器時請放在 HTTPS 反向代理（nginx／Caddy）後面：瀏覽器的剪貼簿 API 只在 HTTPS 或 localhost 可用，「複製資料到官網」需要它。伺服器沒有帳號系統，請限制在院內網路或加上代理層驗證。

## 架構

| 部分 | 檔案 | 說明 |
|---|---|---|
| 伺服器 | `server/server.py` | 只用標準函式庫，提供網頁；不儲存任何病患資料，日誌不記錄查詢內容 |
| OCR | `app/ocr.js` | 預設瀏覽器內 Tesseract.js（照片不上傳）；PDF 有文字層時直接讀取 |
| 配對 | `app/parse.js` | 依座標配對欄名、數值、單位、軸向；K／TK 分開；左右眼分區；不猜值 |
| 介面 | `app/index.html`、`app/app.js` | 選眼 → 上傳 → 核對 → 計算與官網 |
| 官網填入 | `app/official-fill.js` | 書籤小程式；只填欄位，不按 Calculate |
| 公式 | `formulas/iol-formulas.js` | SRK/T、Holladay 1、Hoffer Q、Haigis、Haigis-L、Toric 估算 |
| 常數 | `formulas/iol-constants.js` | 依 IOL constant.pdf，區分 A-scan／SRK/T 欄，缺值為 null |

### 換用伺服器端 OCR（例如 Linux 上的 PaddleOCR）

設定 `IOL_OCR_CMD`，前端會自動改用伺服器辨識，配對與核對程式不需修改：

```bash
IOL_OCR_CMD="python3 /opt/iol/paddle_ocr.py" python3 server/server.py
```

該指令接收影像路徑為最後一個參數，輸出 `{"boxes": [{"text", "conf", "x", "y", "w", "h"}]}`（0–1 正規化、左上原點）。

### 離線／自架 Tesseract 檔案

預設從 jsDelivr 載入 Tesseract.js 與英文字庫。若伺服器或醫院網路不能連外，把檔案放到 `app/vendor/`，並在 `index.html` 載入 `ocr.js` 前設定：

```html
<script>window.IOL_OCR_CONFIG = { workerPath: 'vendor/worker.min.js', corePath: 'vendor/', langPath: 'vendor/' };</script>
```

## iPhone 捷徑

`app/IOL小幫手填入.shortcut` 是從 Safari 分享選單執行的捷徑：讀剪貼簿 → 在官網頁面執行與書籤相同的填入程式 → 顯示摘要。修改 `app/official-fill.js` 後，要在 Mac 上重新產生並簽署（需 macOS 12+、登入 iCloud）：

```bash
python3 tools/build-shortcut.py
```

## 測試

```bash
node tests/parse-tests.js         # 或 Mac：osascript -l JavaScript tests/parse-tests.js
node formulas/formula-tests.js    # 或 Mac：osascript -l JavaScript formulas/formula-tests.js
```

## 限制

- K1／K2、TK1／TK2 以單張報告為一組，不同單子只比較、不混用；AL、ACD 等其他欄位仍是逐欄選擇來源。
- OCR 與配對結果只是候選值，必須逐項人工核對；版型不同、模糊、斜拍都可能配對失敗或漏字。
- 平台內建公式只有公開發表的公式；Barrett、Kane、EVO、Hill-RBF 等請以官網為準。
- ASCRS 計算器的欄位對應是依欄名比對，尚未在官網實測。
- 尚未經臨床驗證。
