# IOL 核對小幫手

上傳 IOLMaster／A-scan／auto refraction 報告 → 依行列位置配對欄名與數值 → 左圖右清單逐項核對 → 公開公式試算＋四公式遠端結果＋官方網站一鍵填入。

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

Pages 版和伺服器版功能相同，主要差別：
- 遠端公式查詢需要 Python／Docker 後端；GitHub Pages 靜態版不顯示此區塊。
- 不支援伺服器端 OCR（`IOL_OCR_CMD`），一律在瀏覽器內辨識。
- 無法自訂回應標頭（no-store 等），頁面內已用 meta 設定 no-referrer。

照片、PDF 與核對紀錄預設留在瀏覽器記憶體，不會傳到 GitHub。「記住這片鏡片的設定」是選用功能，只在此瀏覽器保存鏡片對應的公式模型與常數，不保存病患或量測資料。按遠端查詢時，已核對的測量值會經自架後端送至所選作者網站；不傳送 PDF、影像、病歷號、姓名或檔名，後端不保存請求或結果。`.gitignore` 已排除 PDF 與圖片檔，避免不小心把報告推上公開 repo。

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

- K1／K2、TK1／TK2 以單張報告為一組，不混用。每組 K 可在計算頁分別計算與送到官網；AL、ACD 等其他欄位逐欄選擇後沿用。
- OCR 與配對結果只是候選值，必須逐項人工核對；版型不同、模糊、斜拍都可能配對失敗或漏字。
- 平台內建公式只有公開發表的公式；四個遠端公式的作者網站結果另列。Barrett、Kane、Hill-RBF 仍使用官網填入流程。
- ASCRS 計算器的欄位對應是依欄名比對，尚未在官網實測。
- 尚未經臨床驗證。

## 遠端公式結果

在核對頁選鏡片，進入「計算與官網」後會依同一片鏡片帶入各公式的模型／家族及官網預設常數。儀器類別依所選眼軸報告帶入：IOLMaster → Other、Lenstar → Lenstar、Argos → Argos；未知儀器保持空白。完成必要人工核對、確認無角膜屈光手術、使用光學量測後，再同意傳送資料並按查詢。標準 SE 不含 Toric 柱鏡及屈光術後計算。

鏡片對照以製造商及型號精確配對，資料在 `app/lens-presets.js`，來源快照雜湊及對照值在 `tests/fixtures/lens-source-evidence.json`，2026-11-10 直接核對作者網站的公開預設值：

- [Cooke](https://cookeformula.com/)：公開前端 `getDefault` 中各鏡片的家族與 A 常數。
- [Hoffer QST](https://hofferqst.com/)：公開前端 `options_SE_IOLS` 中的 pACD。
- [PEARL-DGS](https://iolsolver.com/regular)：公開前端 `IOLModelItems` 中的模型及 A 常數。
- [EVO](https://www.evoiolcalculator.com/Calculator.aspx)：正常 GET 表單後選擇該型號、POST 選單事件，由回傳表單讀取預設 A 常數；不進行 CAPTCHA 繞過。

目前精確對照包含 AAB00、ICB00、MX60、MA60AC、MA60MA、SN60WF、ZCB00、SA60AT；其中 SN60WF、ZCB00、SA60AT 具四公式完整預設。另外新增這三種鏡片到上方選單，其光學 A 參考 EVO 官網，明確標示不是院內原表，A-scan 值保持空白。未列型號或名稱不完整的鏡片維持手動設定，不能由相似名稱猜測；例如 ICB00 不會誤套 PEARL 的 PCB00/ZCB00。

缺少常數時會顯示待補，未完成的公式不會送出；其他完成的公式仍可查詢。A 常數可按「沿用上方光學 A」明確選用院內／使用者的光學 SRK/T 常數，畫面標示來源且隨上方數值連動；Hoffer 不提供此按鈕，也不從 A 常數推算 pACD。選擇另一模型會清空原模型常數，避免不相符設定。

手動修正後可選「記住這片鏡片的設定」，只儲存有效公式的模型與常數。下次選相同鏡片會帶入，換鏡片不沿用；「恢復官網預設值」只更改目前畫面，「清除已記住的設定」刪除此鏡片的瀏覽器偏好。瀏覽器不允許儲存時仍能完成本次查詢。新個案重新取得資料傳送同意；更換鏡片會中止舊查詢並清除結果，慢回應無法覆蓋新設定。

- Cooke K6 2024.01：JSON 術前 API，使用自己的 A-constant 與鏡片家族。
- Hoffer QST：`/compute`，使用 pACD，不能用 A-constant 代填。
- PEARL-DGS：GraphQL `solve`，使用自己的 A-constant 與 IOL model。
- EVO：每次正常 GET 取得新 ASP.NET 表單狀態，再 POST；姓名欄固定為 `Anonymous`，不使用個案姓名。

來源各自回報成功、錯誤或逾時；某站失敗不影響其他站。表格 — 不代表零。變更數值、鏡片、常數或新個案後舊結果失效，較慢的舊回應不會覆蓋新資料。實際鏡片供應度數需另外核對，常數不會自動猜測或全部套用平台的 A 常數。

`POST /api/calculations` 接受 `{formula, measurements, settings}`；只允許四個固定來源與白名單測量欄位，不提供任意 URL 代理，不接受病歷號等額外欄位。請求上限 16 KB，同時最多四個來源請求。各次查詢有獨立 session，不取用瀏覽器 Cookie 或 CAPTCHA token。來源要求驗證或改版時改顯示錯誤及官網連結。

部署仍需使用原有的院內網路／反向代理驗證；這次沒有新增帳號系統。作者介面可能改版或限制存取，成功實測不等於取得第三方提供服務的授權，正式服務前需確認各來源使用範圍。

新增測試（標準函式庫／Node，離線測試不連作者網站）：

```bash
python3 tests/calculation-tests.py
python3 tests/server-tests.py
node tests/remote-tests.js
```

## NAS 部署

正式服務使用 Portainer 的 `iol-helper` stack，Compose 範本在 `deploy/nas.compose.yml`，原始碼先同步到 `/volume1/jason/projects/iol-helper`。網站為 `https://iol.wombatwang.com/`，沿用 Traefik 的 HTTPS 與 Authelia；帳號允許規則維護在 NAS 的 Authelia 設定，不放在此 repo。

容器非 root、根檔案系統唯讀、不掛載病患資料，HTTP 只在容器網路對 Traefik 開放。復原埠 `127.0.0.1:8793` 僅 NAS 本機可用，不對 LAN／WAN 直接開放。Synology 舊核心不支援 CPU CFS 與 PID 配額，改用支援的 CPU shares 與 256 MB 記憶體限制。Dockerfile 固定 Python Bookworm 版本，並在映像內設定程式檔讀取權限，避免 SMB／NAS ACL 被帶入後讓 nobody 無法啟動。

更新時使用新映像標籤，保留前一版映像及 Compose；只更新此 stack，不刪除資料。若停用此服務，保留 Authelia 的預設拒絕原則，不能移除 middleware 來排除登入問題。
