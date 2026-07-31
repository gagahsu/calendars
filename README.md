# 行事曆助理 (Calendars)

以行事曆為核心的個人助理，可安裝成手機 App（PWA），也能完全透過 LINE 操作。

**主要功能是信用卡繳費提醒**，其次是待辦事項，並串接 OpenRouter 的免費模型分析每月消費、給出節省建議。

---

## 功能

### 💳 信用卡繳費提醒（主要）

- 為每張卡設定「每月幾號結帳、次月（或當月）幾號繳費」，系統自動推算每一期的繳款日。
- 繳款日會自動出現在行事曆上，金額登記後標題同步顯示金額。
- 可自訂提醒時機（到期前 14/7/5/3/1 天、當天），到期前透過 LINE 主動推播；逾期則每天提醒。
- 月底日期自動處理：設定 31 號繳費時，2 月會自動改成 28（或閏年 29）號。
- 剛新增卡片時，已經過去的繳款日會直接標為已繳，不會謊報你欠款。

### ✅ 待辦事項

- 期限、重要標記、逾期天數統計。
- 每天早上推播「今天到期 ＋ 已逾期」的待辦。

### 🗓 行事曆

- 月曆檢視，一格內同時顯示帳單、行程、待辦與當日有無消費。
- 點日期看當天明細（行程 / 待辦 / 消費）。

### 📊 AI 消費分析

- 統計本月支出、分類佔比、與上月比較、平均每日、月底預估、預算使用率。
- 自動偵測「連續 3 個月以上出現的店家」＝疑似固定訂閱，這通常是最容易省下來的錢。
- 呼叫 OpenRouter 免費模型產生總結、觀察與 3-5 條節省建議（含預估每月可省金額）。
- 分析結果會快取；資料沒變就不會重複呼叫模型。每月 1 號自動推播上個月的分析報告。
- 沒有設定 API key，或免費模型全部被限流時，會自動退回規則式分析，不會開天窗。

### 📱 PWA

- 可加到手機主畫面，全螢幕執行，含 App 圖示與捷徑（記帳 / 信用卡 / 分析）。
- 離線時顯示離線頁面；財務資料本身不快取。

### 🤖 LINE Bot

用聊天就能操作，不用開網站：

| 你打 | 結果 |
| --- | --- |
| `記 120 午餐` | 記一筆消費，自動歸類「餐飲」 |
| `花 350 星巴克 昨天` | 指定日期記帳 |
| `記 1200 家樂福 7/20 刷國泰` | 指定日期與卡片 |
| `120 停車費` | 直接打數字也可以 |
| `記 450 #health 看牙醫` | 用 `#分類` 強制指定分類 |
| `待辦 繳水電費 明天` | 新增待辦 |
| `完成 1` / `完成 繳水電費` | 勾掉待辦 |
| `行程 3/5 14:00 看牙醫` | 新增行程 |
| `提醒 下週三 早上9點 開會` | 支援「下週三」「早上9點」「9點半」 |
| `帳單` | 列出未繳帳單與倒數天數 |
| `帳單 國泰 3200` | 登記這期帳單金額 |
| `已繳 國泰` | 標記已繳 |
| `新增卡片 國泰CUBE 結帳15 繳費5` | 新增卡片 |
| `今天` / `明天` / `本週` / `總覽` | 查詢 |
| `分析` / `分析 上月` / `分析 2026-06` | AI 消費分析 |
| `說明` | 完整指令列表 |

指令解析是純規則式的（不呼叫模型），所以記帳永遠是秒回，也不會因為模型被限流而失效。

---

## 技術架構

| 層 | 選擇 |
| --- | --- |
| 前端 / 後端 | Next.js 15 App Router（React 19） |
| 資料庫 | PostgreSQL + Prisma |
| 部署 | Vercel（含 Vercel Cron 排程推播） |
| 登入 | 單一使用者密碼 ＋ HMAC 簽章 Cookie |
| 通知 | LINE Messaging API（webhook 接收 ＋ push 推播） |
| AI | OpenRouter 免費模型，多模型 fallback |
| 樣式 | 手寫 CSS（無框架），深色 / 淺色自動切換 |

沒有使用 CSS 框架或 UI 套件，前端 First Load JS 約 106 kB。

---

## 安裝與部署

### 1. 取得程式碼與安裝套件

```bash
git clone <this-repo>
cd calendars
npm install
cp .env.example .env
```

### 2. 準備資料庫

任一個 PostgreSQL 都可以（Vercel Postgres、Neon、Supabase、自架）。把連線字串填進 `.env` 的 `DATABASE_URL`，然後建表：

```bash
npx prisma db push
```

### 3. 設定網站密碼

```bash
# 產生 session 簽章用的秘密
openssl rand -hex 32
```

填入 `.env`：

```
APP_PASSWORD="你要用的密碼"
SESSION_SECRET="上面產生的 hex 字串"
```

### 4. 設定 LINE Bot

1. 到 [LINE Developers](https://developers.line.biz/console/) 建立 **Messaging API** channel。
2. 複製 **Channel secret** → `LINE_CHANNEL_SECRET`。
3. 發行 **Channel access token (long-lived)** → `LINE_CHANNEL_ACCESS_TOKEN`。
4. 在 channel 設定裡：
   - **Webhook URL** 填 `https://你的網域/api/line/webhook`，並開啟 *Use webhook*。
   - 關閉 *Auto-reply messages* 與 *Greeting messages*（否則官方罐頭訊息會蓋掉機器人的回覆）。
5. 用手機加機器人為好友，隨便傳一句話。機器人會回覆你的 `userId`，把它填進 `LINE_USER_ID` 後重新部署。

> `LINE_USER_ID` 同時是白名單：只有這個帳號能操作機器人，提醒也只推給它。

### 5. 設定 AI 分析（可選但建議）

1. 到 [openrouter.ai/keys](https://openrouter.ai/keys) 申請免費 API key → `OPENROUTER_API_KEY`。
2. `OPENROUTER_MODELS` 用逗號分隔，會依序嘗試，前面的被限流就換下一個。預設第一個是 `openrouter/free`——OpenRouter 自己的路由端點，會在免費模型池裡自動挑一個可用的，不用自己追蹤哪些模型還在免費：

```
OPENROUTER_MODELS="openrouter/free,deepseek/deepseek-chat-v3-0324:free,meta-llama/llama-3.3-70b-instruct:free,google/gemma-3-27b-it:free"
```

`openrouter/free` 後面留的是備援：萬一路由端點本身出狀況，才會退回逐一嘗試固定模型。免費模型的可用清單會變動，可到 OpenRouter 網站上篩選 `:free` 後更新備援清單。
若想改用其他 OpenAI 相容服務，設定 `OPENROUTER_BASE_URL` 即可。

沒有設定 key 也能用，只是分析會退回規則式版本。

### 6. 部署到 Vercel

```bash
npx vercel
```

把 `.env` 裡所有變數加到 Vercel 專案的 Environment Variables，其中 `CRON_SECRET` 是排程用的密碼（Vercel 會自動帶 `Authorization: Bearer $CRON_SECRET`）。

`vercel.json` 已經設好兩個排程（cron 時間為 UTC，對應台北時間）：

| 排程 | 台北時間 | 內容 |
| --- | --- | --- |
| `0 1 * * *` | 09:00 | 帳單提醒、今天的行程、該處理的待辦；每月 1 號附上上月分析 |
| `0 13 * * *` | 21:00 | 帳單提醒、明天的行程預告 |

> Vercel Hobby 方案的 Cron 每天只跑一次、最多兩個排程，所以設計成「一天兩次摘要」而不是逐筆到點提醒。
> 想要更即時的話，可改用外部排程服務打
> `https://你的網域/api/cron/reminders?slot=morning&key=$CRON_SECRET`。

每次推播都會寫一筆 `ReminderLog`，同一件事不會重複通知，手動多打幾次排程端點也安全。

### 7. 設定 LINE 圖文選單

聊天室下方的六格選單。圖是用程式畫的（`scripts/richmenu-layout.mjs` 定義版面，
sharp 算圖），所以改按鈕就是改一個檔案再重跑兩個指令，不用開設計軟體：

```bash
npm run richmenu:image                                          # 產生 public/richmenu.png
RICHMENU_APP_URL=https://你的網域 npm run richmenu:install       # 上傳並設為預設選單
```

版面和點擊區共用同一份定義，不會對不準。安裝是冪等的，重跑會先砍掉舊的那個。

| 按鈕 | 行為 |
| --- | --- |
| 記帳 | 打開鍵盤並預先填好 `記 `，接著只要打「120 午餐」 |
| 帳單 / 待辦 / 今天 / 分析 | 送出對應指令 |
| 網站 | 開啟完整版網頁 |

> 記帳那格用的是 postback + `fillInText`，只有走 API 才做得到；LINE 官方帳號後台
> 的選單編輯器只支援純文字和連結。需要 LINE 12.6.0 以上。
>
> 建立選單打 `api.line.me`，但上傳圖片要打 `api-data.line.me`，兩個 host 不一樣。

### 8. 安裝到手機

用手機瀏覽器開啟網站 → 加到主畫面。

- iOS：Safari →「分享」→「加入主畫面」
- Android：Chrome →「安裝應用程式」

---

## 本機開發

```bash
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit
npm run build      # 生產建置
npm run db:push    # 同步 schema 到資料庫
```

重新產生 PWA 圖示（純 stdlib，不需要額外套件）：

```bash
python3 scripts/generate-icons.py
```

本機測試 LINE webhook 時，用 `ngrok http 3000` 之類的工具取得公開網址填進 LINE console。
若想在本機攔截對外請求，可設 `LINE_API_BASE` / `OPENROUTER_BASE_URL` 指向自己的測試伺服器。

---

## 專案結構

```
prisma/schema.prisma          資料模型
scripts/
  generate-icons.py           PWA 圖示產生器
  richmenu-layout.mjs         LINE 圖文選單版面（圖與點擊區共用）
  generate-richmenu.mjs       選單底圖產生器
  setup-richmenu.mjs          選單上傳與安裝
public/
  richmenu.png                LINE 圖文選單底圖（產生物）
  manifest.webmanifest        PWA manifest
  sw.js                       Service worker
  offline.html                離線頁面
src/
  lib/
    date.ts                   台北時區（UTC+8）日期運算
    billing.ts                結帳日／繳款日推算、帳單與行事曆同步
    reminders.ts              排程提醒與去重
    line.ts                   LINE 簽章驗證與訊息推送
    parser.ts                 LINE 中文指令解析
    insights.ts               月度統計與 AI 分析
    openrouter.ts             OpenRouter 客戶端（多模型 fallback）
    agenda.ts                 共用的文字排版（LINE 與排程共用）
    auth.ts                   密碼驗證與 Cookie session
  app/
    (app)/                    需登入的頁面（行事曆／信用卡／待辦／記帳／分析）
    login/                    登入頁
    api/                      REST API、LINE webhook、cron
  components/                 前端畫面元件
```

---

## 設計上的幾個取捨

- **時區固定 UTC+8。** 台灣自 1980 年後沒有日光節約時間，所以用固定 offset 而不是引入 tz 資料庫。所有資料存 UTC，顯示與運算時才轉台北時間。
- **指令解析不用模型。** 記帳要秒回，也不能因為免費模型被限流就壞掉，所以 `parser.ts` 是純規則式的；模型只用在真正需要推理的月度分析。
- **日期偏好依指令而定。** 記帳的 `7/20` 往過去解讀，行程的 `3/5` 往未來解讀——同一段文字在不同指令下年份不同。
- **帳單事件由帳單擁有。** 行事曆上的繳費事件是帳單的鏡像，不能單獨手動刪除（會被下次同步重建），只能在信用卡頁面調整。
- **Service worker 不快取財務資料。** 只快取 build 產物與離線頁；API 與頁面一律走網路，避免顯示過期金額。
- **AI 失敗不開天窗。** 模型全部失敗時退回規則式分析（仍會抓出訂閱、暴增類別、超預算與逾期帳單），並保留上一次的快取結果。
