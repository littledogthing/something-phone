# 兔K機 v26 優化紀錄

這次優化的對象是這個 zip 裡實際包含的檔案。main-app.js、game-hall.js、forum.js、
lovers-space.js、taobao.js、weibo.js、date.js、studio.js、tukey-accounting.js、
kk-checkin.js、avatar-frames.js 等 index.html 用 `<script src>` 引入的核心邏輯檔案
**不在這個 zip 裡**，所以沒有動到，也沒辦法一起優化。

## 做了什麼

### 1. index.html：抽出巨大的內嵌 `<script>`（2.5MB → 544KB）
原本 index.html 裡有一段**單一、內嵌在 HTML 裡的 `<script>`**，長達 47,681 行、
約 1.75MB，佔了整個檔案體積的九成以上。這段已經抽成獨立檔案 `ephone-app-core.js`，
index.html 改用 `<script src="ephone-app-core.js"></script>` 在原本的位置載入，
執行順序完全不變。

好處：
- index.html 從 2.5MB 降到約 544KB，瀏覽器每次載入頁面要解析的 HTML 少很多。
- `ephone-app-core.js` 可以被瀏覽器快取，之後改 HTML（例如版面調整）不會讓使用者
  重新下載整包邏輯。
- 之後要看/改核心邏輯，直接開一個 .js 檔案，不用在 6 萬多行的 HTML 裡找。

### 2. 清掉在同一層作用域裡被「重複宣告」蓋掉的死程式碼
在那段巨大的內嵌 script 裡，幾乎所有函式都宣告在同一層（同一個外層函式）裡。
JavaScript 的規則是：同一層裡後面宣告的同名函式，會直接蓋掉前面的，前面那份永遠
不會被執行到——純粹佔位置、也容易讓人改錯份。這次清掉了 14 組這樣的重複宣告
（保留最後、實際生效的那份，執行結果完全不變）：

`toggleTheme`、`applyTheme`、`restoreBackupFromGitHubStream`、
`renderHomeScreenProfileFrame`、`renderBranchList`、`parseDurationToMinutes`、
`openBranchingModal`、`hexToRgb`、`handleWaimaiResponse`、
`filterVisiblePostsForAI`、`deleteCategory`、`createWorldBookGroup`、
`buildCommentsContextForAI`、`handleCharacterDataDeletion`

### 3. 抓到一個真的 bug：`handleCharacterDataDeletion` 整段被複製貼上兩次
「查手機」單條刪除功能那段（含註解、函式本體）被原封不動複製貼上了兩次，
黏在一起。雖然只掛了一個點擊事件監聽器（沒有重複綁定），但兩份函式定義中
第一份完全是死碼。已經移除多餘的一份，只保留一份。

以上總共刪掉約 748 行重複／死程式碼，並確認移除後 `ephone-app-core.js` 語法
仍然正確（`node -c` 驗證通過）。

## 檢查過、但**沒有動**的部分（風險考量）

- **ephone-modern.js / ephone-modern.css**（您的字卡層）：程式碼本身已經算乾淨
  （沒有重複函式、沒有 `var`、沒有殘留 `console.log`）。但 CSS 裡有大量針對不同
  尺寸／情境疊加的 `!important` 覆寫規則（例如 `#desktop-dock` 被定義了 18 次），
  這比較像是多次疊代留下的技術債，而不是單純複製貼上錯誤。因為沒辦法實際跑起來
  看畫面，貿然合併這些規則有改壞版面的風險，這次沒有動，只記錄下來供您參考。
- **ephone/ 獨立 Core**（年齡／天氣／紀念日）：檢查過，沒有發現重複函式或明顯
  的程式碼異味，維持原樣。
- **main-app.js 等核心邏輯檔案**：不在這個 zip 裡，無法檢查或優化。

## 追加修復：「雙人／多人狀態」App 名稱與 Icon 改了不會保存

**根本原因找到了**：外觀設定畫面（`renderWallpaperScreen()`）每次打開時，只呼叫
`syncEPhoneThemeControls()` 去刷新顏色、壁紙等控制項，卻從來沒有呼叫負責把
「共用行事曆／字卡／雙人狀態」這三個 App 名稱**寫回輸入框**的 `applyEPhoneUserTheme()`。
所以每次打開這個設定畫面，名稱欄位一定顯示空白（只剩下 placeholder 灰字「雙人狀態」），
讓人以為改過的名稱又被重置了——但實際上多數情況下資料早就正確存進
`state.globalSettings.ephoneUserTheme.thirdApps`，只是**畫面沒有把它顯示出來**。
另外原本 Icon 按鈕旁完全沒有任何縮圖，換了 Icon 後也無從肉眼確認到底存了沒有，
更加深了「沒有存檔」的錯覺。

修復方式：
1. `renderWallpaperScreen()` 現在會在畫面渲染時多呼叫一次 `applyEPhoneUserTheme()`，
   確保三個 App 名稱輸入框每次打開都正確顯示已保存的值。
2. 新增 `refreshThirdAppIconPreviews()`，在三個 Icon 按鈕旁加上一個小縮圖預覽
   （HTML 新增 `.ep-third-icon-preview` 元素，CSS 定義在 `ephone-modern.css`）。
   沒設定自訂 Icon 時顯示「預設」文字，設定後即時顯示縮圖，並且在存檔／清除／重置
   之後都會同步刷新，這樣換了 Icon 之後可以馬上肉眼確認有沒有存到。

這次沒有改動 `saveEPhoneUserTheme()` 本身的存檔邏輯（它原本讀寫
`state.globalSettings.ephoneUserTheme` 並呼叫 `db.globalSettings.put()` 這條路徑是對的），
純粹是「畫面沒有把已存的資料讀回來顯示」的問題，修完後不影響其他外觀設定。

（附註：`ephone/`資料夾裡那個獨立 iframe 版本的「雙人狀態」App 名稱/Icon 設定
是另一條完全獨立的資料路徑，存在自己的 `localStorage: EPhoneCore.v2`，透過
postMessage 跟這裡的設定互相同步；這次沒有改動那一份，如果您用的是那個獨立頁面
改名稱/Icon 卻也遇到類似狀況，麻煩告訴我，我再檢查那一條路徑。）

## 建議下一步

如果方便的話，把 `main-app.js`、`game-hall.js` 等核心檔案也一起打包給我，
就能做同樣程度的重複程式碼／死碼檢查；也可以之後專門花一輪測試
`ephone-modern.css` 的響應式規則，把疊加的 `!important` 覆寫收斂成一份乾淨的規則。
