# 01_Product_Soul_and_Business_Model.md (v1.2 - Final Hardened)

> **版本**：v1.2 (Final Hardened)
> **来源**：基于《雅典娜商业模型 V9.0》与现有后端代码逻辑整合。
> **定位**：本项目的**商业宪法**。任何代码实现不得违背本文档定义的收费模式、风控策略与用户权益。
> **技术落地指南**：涉及错误码、配置读取、事务处理的具体技术规范，请严格遵循 **`00 - AI 编码宪法与规范AI_Coding_Constitution_and_Rules.md`** 中的相关条款。

---

## 1. 产品灵魂与愿景 (Product Soul & Vision)

*   **产品名称**：雅典娜 (Athena)
*   **核心 Slogan**：“把读过的每一本书，都变成你的知识资产。”
*   **核心价值主张 (UVP)**：
    为深度阅读者提供一个集“无缝云同步”、“深度 AI 知识内化”、“极致笔记体验”于一体的知识引擎。我们将碎片化的阅读行为，转化为结构化的个人智慧。

---

## 2. 核心商业模型：The Hook & The Trap

这是雅典娜区别于普通阅读器的根本。所有功能开发必须围绕这一模型闭环。

### 2.1 The Hook（诱饵）：免费同步，有限上传
*   **策略**：多端同步功能**永久免费**，降低用户准入门槛，最大化 DAU。
*   **限制点（关键）**：同步的前提是“文件在云端”。我们不限制同步，但**限制“新书上传”**。
*   **阈值配置**：
    *   免费用户配额：**50 本** 或 **1GB** 存储空间（由 Admin 动态配置 `free_book_limit` 和 `free_storage_limit`）。
*   **逻辑闭环（AI 必须遵守）**：
    *   **新设备场景**：用户在新手机登录，虽无法上传新书，但可以**完整下载并阅读**云端已有的所有书籍、笔记和 AI 记录。体验无损。
    *   **旧设备场景**：已上传的书籍可继续阅读、做笔记，但无法再添加新书。

### 2.2 The Trap（熔断）：只读锁 (Read-Only Lock)
*   **触发条件**：当用户达到存储或数量阈值（50本/1GB），且未升级 Pro 时。
*   **业务表现（Soft Lock）**：
    1.  **上传阻断**：禁止新书上传请求。
    2.  **写操作阻断**：禁止笔记、高亮、书架修改等同步请求。
    3.  **前端体验**：
        *   必须给予明确的 UI 提示（文案配置于 `msg_storage_full`）。
        *   **错误码**：前端需处理 `QUOTA_EXCEEDED`。
        *   **严禁**弹窗阻断用户的**阅读**行为。已下载的书籍必须可以继续阅读。
    4.  **AI 豁免**：只要用户账户内有 Credits（信用点），**允许**继续使用 AI 对话和翻译，不受存储空间限制。

**典型场景示例：**
*   用户超额上传 → 后端返回 403 `QUOTA_EXCEEDED` → 前端弹出“购买加油包/升级Pro”引导。
*   免费用户尝试 OCR 1200 页书 → 后端返回 400 `OCR_MAX_PAGES_EXCEEDED`。

---

## 3. 资源与货币体系 (Resources & Currency)

本项目实行**全配置化**的货币体系，所有数值严禁硬编码。具体读取方式请参考 `00` 号文档“配置读取铁律”。

### 3.1 核心货币：Credits（通用信用点）
*   **定义**：平台内的硬通货，用于消耗算力资源。
*   **用途**：AI 对话（RAG 问答 / 闲聊）、AI 语境翻译、OCR 额度兑换（当免费 OCR 次数用尽时）。
*   **汇率**：由 Admin 后台配置（例如：`wallet_exchange_rate`: ¥1 = 400 Credits）。
*   **精度**：所有 Credits 计算必须使用整数（避免浮点误差）。

### 3.2 钱包余额 (Wallet Balance)
*   **定义**：用户充值的法币余额（CNY/USD），存储在 `credit_accounts` 表。
*   **用途**：购买加油包、支付微小额度的服务费（如单次 OCR）。

### 3.3 算力底线与风控 (The Cost)

#### OCR 额度控制（阶梯计费）
*   **数据源**：依据 `books` 表中的 `meta.page_count` 字段（必须准确）。
*   **阶梯规则（AI 必须严格实现此逻辑）**：
    | 书籍页数 (P) | 消耗策略 | 说明 |
    | :--- | :--- | :--- |
    | **P ≤ 600** | 1 个“标准单位” | 优先扣免费额度，用完扣加油包/Credits |
    | **600 < P ≤ 1000** | 2 个“标准单位” | **强制扣除**付费额度（加油包/Credits），不可用免费额度 |
    | **1000 < P ≤ 2000** | 3 个“标准单位” | **强制扣除**付费额度（加油包/Credits），不可用免费额度 |
    | **P > 2000** | **拒绝服务** | 直接报错 `OCR_MAX_PAGES_EXCEEDED` |

#### OCR 调用统一流程（Transaction Flow）
**此流程涉及资金安全，必须严格执行：**
1.  **读取页数**：检查 `meta.page_count`。
2.  **缺失探测**：若为空，触发轻量探测；若仍为空，返回 `OCR_NEEDS_MANUAL_CHECK`。
3.  **开启事务**：
    *   **扣费**：写入 `credit_transactions` 表，状态为 `Pending`。
    *   **记录任务**：写入 `ocr_jobs` 表。
4.  **调用 Worker**：提交 OCR 任务。
5.  **结果处理**：
    *   **成功**：更新 `credit_transactions` 状态为 `Confirmed`。
    *   **失败**：更新状态为 `Failed`，并**回滚扣费**（退还 Credits）。
6.  **提交事务**。

---

## 4. 会员权益体系 (Membership Tiers)

### 4.1 免费用户 (Free Tier)
*   **权益**：全端同步（在 50本/1GB 阈值内）、基础阅读功能。
*   **裂变奖励（邀请码）**：
    *   **机制**：邀请奖励发放必须在**事务**中完成（写入 `invites` 和 `user_stats`），防止重复领取。
    *   **奖励**：双方同时获得 `invite_bonus_storage` 和 `invite_bonus_books`。

### 4.2 Pro 会员 (Pro Membership)
*   **定价**：`price_membership_yearly_first` / `price_membership_yearly_renew`。
*   **权益核心**：
    1.  **解除只读锁**。
    2.  **月度赠礼 (Monthly Gift)**：赠送 Credits 和 OCR 额度，**月底清零，不可累计**。
    3.  **优先队列**：享受 P0/P1 级调度优先级。

### 4.3 加油包 (Add-ons)
AI 加油包：购买额外的 Credits（如 ¥9.9 买 4000 点）。
OCR 加油包：购买额外的 OCR 次数（如 ¥8.8 买 10 次）。
特性：加油包额度永久有效，不会随月度清零。

---

## 5. 运营配置化要求 (Admin Requirements)

为了保证商业灵活性，**以下所有参数必须对接 `system_settings` 表**。代码实现时需遵循 `00 - AI 编码宪法与规范AI_Coding_Constitution_and_Rules.md` 号文档的“配置读取铁律”。

配置项 Key	说明	默认值示例	适用范围	DB 映射
free_book_limit	免费书籍数量上限	50	全局	system_settings
free_storage_limit	免费存储空间上限 (MB)	1024	全局	system_settings
ocr_page_thresholds	OCR 页数阶梯定义	JSON	OCR 服务	system_settings
ocr_concurrency_limit	OCR 全局并发数	1	任务调度	system_settings
wallet_exchange_rate	钱包余额兑换 Credits 汇率	400	计费	system_settings
pricing_rules	多平台定价策略	JSON	收银台	pricing_rules 表
invite_bonus_storage	邀请奖励空间	500	裂变	system_settings
invite_bonus_books	邀请奖励书籍	10	裂变	system_settings



---

## 6. 多平台支付策略 (Multi-Platform Payment)
Web 端：直接对接 Stripe/WeChat Pay，使用标准价格。
移动端 (iOS/Android)：
必须使用 IAP (In-App Purchase)。
“苹果税”处理：在 Admin 后台为 iOS 平台配置独立的价格（如 ¥78），以覆盖 30% 的佣金成本。
合规红线：App 内严禁出现任何引导用户去 Web 端充值的链接或文案。

---

## 7. 度量与监控 KPI (Metrics & Monitoring)

运营与技术团队需共同关注以下核心指标：
*   **athena_user_dau**：日活跃用户数。
*   **athena_users_in_readonly**：处于只读锁状态的用户数。
*   **ocr_deduction_failures_total**：OCR 扣费失败次数。
*   **credit_transactions_failed_total**：通用交易失败次数。

---

**[AI 指令总结]**
1.  **数值来源**：本文档中提到的所有数字仅为示例。在编写代码时，**严禁硬编码**，必须使用配置项 Key。
2.  **逻辑实现**：OCR、上传、邀请功能必须严格对照本文档的逻辑流程。
3.  **技术底线**：实现上述逻辑时，必须严格遵守 `00 - AI 编码宪法与规范AI_Coding_Constitution_and_Rules.md` 文档中的事务、错误码和安全规范。